import type { DatabaseSync } from "node:sqlite";
import {
  parseRewardDraft,
  type Reward,
  type RewardAdminCommand,
  type RewardGoal,
  type RewardSpend,
  type RewardsCommand,
} from "./types";

export class RewardConflict extends Error {}
/** The route supplies the household task database so Spend and its balance change commit together. */
export function rewardsStore(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rewards (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
      cost INTEGER NOT NULL CHECK(cost > 0 AND cost <= 9007199254740991), icon TEXT NOT NULL,
      revision INTEGER NOT NULL, retired_at TEXT
    );
    CREATE TABLE IF NOT EXISTS reward_edits (
      reward TEXT NOT NULL, revision INTEGER NOT NULL,
      name TEXT NOT NULL, description TEXT NOT NULL, cost INTEGER NOT NULL, icon TEXT NOT NULL,
      PRIMARY KEY (reward, revision)
    );
    CREATE TRIGGER IF NOT EXISTS reward_edits_no_update BEFORE UPDATE ON reward_edits
      BEGIN SELECT RAISE(ABORT, 'Reward edit receipts are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS reward_edits_no_delete BEFORE DELETE ON reward_edits
      BEGIN SELECT RAISE(ABORT, 'Reward edit receipts are immutable'); END;
    CREATE TABLE IF NOT EXISTS reward_goals (member TEXT PRIMARY KEY, reward TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reward_spends (
      id TEXT PRIMARY KEY, member TEXT NOT NULL, reward TEXT NOT NULL,
      revision INTEGER NOT NULL, name TEXT NOT NULL, cost INTEGER NOT NULL, at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS reward_spends_no_update BEFORE UPDATE ON reward_spends
      BEGIN SELECT RAISE(ABORT, 'Reward Spends are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS reward_spends_no_delete BEFORE DELETE ON reward_spends
      BEGIN SELECT RAISE(ABORT, 'Reward Spends are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS rewards_no_delete BEFORE DELETE ON rewards
      BEGIN SELECT RAISE(ABORT, 'Retire rewards instead of deleting'); END;
  `);
  function transaction<T>(write: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = write();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function rewards(): Reward[] {
    return db
      .prepare("SELECT * FROM rewards ORDER BY rowid")
      .all()
      .map((row) => {
        const draft = parseRewardDraft(row);
        if (!draft) throw new Error("Invalid stored Reward");
        return {
          ...draft,
          id: String(row.id),
          revision: Number(row.revision),
          retiredAt: row.retired_at === null ? null : String(row.retired_at),
        };
      });
  }
  function active(id: string, revision?: number) {
    const reward = rewards().find((row) => row.id === id && !row.retiredAt);
    if (!reward || (revision !== undefined && revision !== reward.revision))
      throw new RewardConflict(
        "This reward changed or was retired. Refresh and choose again.",
      );
    return reward;
  }
  function snapshot() {
    return {
      rewards: rewards(),
      goals: db
        .prepare("SELECT member, reward FROM reward_goals ORDER BY member")
        .all()
        .map(
          (row) =>
            ({
              member: String(row.member),
              reward: String(row.reward),
            }) satisfies RewardGoal,
        ),
      balances: db
        .prepare("SELECT member, balance FROM star_balances ORDER BY member")
        .all()
        .map((row) => ({
          member: String(row.member),
          balance: Number(row.balance),
        })),
    };
  }
  function administer(command: RewardAdminCommand) {
    return transaction(() => {
      if (command.kind === "create") {
        const existing = rewards().find((row) => row.id === command.id);
        if (existing) {
          if (
            existing.name !== command.draft.name ||
            existing.description !== command.draft.description ||
            existing.cost !== command.draft.cost ||
            existing.icon !== command.draft.icon ||
            existing.retiredAt
          )
            throw new RewardConflict(
              "That request already created a different reward.",
            );
          return;
        }
        const { name, description, cost, icon } = command.draft;
        db.prepare("INSERT INTO rewards VALUES (?, ?, ?, ?, ?, 1, NULL)").run(
          command.id,
          name,
          description,
          cost,
          icon,
        );
        return;
      }
      // A reward revision can be edited successfully only once. Check its
      // immutable receipt before current state so a lost response can be retried
      // even after later edits or retirement, without replaying the mutation.
      if (command.kind === "edit") {
        const previous = db
          .prepare("SELECT * FROM reward_edits WHERE reward=? AND revision=?")
          .get(command.id, command.revision);
        if (previous) {
          if (
            previous.name !== command.draft.name ||
            previous.description !== command.draft.description ||
            previous.cost !== command.draft.cost ||
            previous.icon !== command.draft.icon
          ) {
            throw new RewardConflict(
              "This revision was already used for a different edit. Refresh before editing again.",
            );
          }
          return;
        }
      }
      active(command.id, command.revision);
      if (command.kind === "edit") {
        const { name, description, cost, icon } = command.draft;
        db.prepare(
          "UPDATE rewards SET name=?, description=?, cost=?, icon=?, revision=revision+1 WHERE id=?",
        ).run(name, description, cost, icon, command.id);
        db.prepare(
          "INSERT INTO reward_edits (reward, revision, name, description, cost, icon) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(command.id, command.revision, name, description, cost, icon);
      } else {
        db.prepare(
          "UPDATE rewards SET retired_at=?, revision=revision+1 WHERE id=?",
        ).run(new Date().toISOString(), command.id);
        db.prepare("DELETE FROM reward_goals WHERE reward=?").run(command.id);
      }
    });
  }
  function apply(command: RewardsCommand): RewardSpend | null {
    return transaction(() => {
      if (command.kind === "goal") {
        if (command.reward === null)
          db.prepare("DELETE FROM reward_goals WHERE member=?").run(
            command.member,
          );
        else {
          active(command.reward);
          db.prepare(
            "INSERT INTO reward_goals VALUES (?, ?) ON CONFLICT(member) DO UPDATE SET reward=excluded.reward",
          ).run(command.member, command.reward);
        }
        return null;
      }
      const previous = db
        .prepare("SELECT * FROM reward_spends WHERE id=?")
        .get(command.id);
      if (previous) {
        if (
          previous.member !== command.member ||
          previous.reward !== command.reward ||
          previous.revision !== command.revision
        )
          throw new RewardConflict(
            "That request already spent stars on another choice.",
          );
        return {
          id: String(previous.id),
          member: String(previous.member),
          reward: String(previous.reward),
          revision: Number(previous.revision),
          name: String(previous.name),
          cost: previous.cost as RewardSpend["cost"],
          at: String(previous.at),
        };
      }
      const reward = active(command.reward, command.revision);
      const balance = Number(
        db
          .prepare("SELECT balance FROM star_balances WHERE member=?")
          .get(command.member)?.balance ?? 0,
      );
      if (balance < reward.cost)
        throw new RewardConflict(
          "Not enough stars. Refresh to see the current balance.",
        );
      if (
        db.prepare("SELECT id FROM star_adjustments WHERE id=?").get(command.id)
      )
        throw new RewardConflict(
          "That request was already used for a star adjustment.",
        );
      const spend: RewardSpend = {
        id: command.id,
        member: command.member,
        reward: reward.id,
        revision: reward.revision,
        name: reward.name,
        cost: reward.cost,
        at: new Date().toISOString(),
      };
      // Existing star_adjustments trigger applies the negative delta exactly once.
      db.prepare(
        "INSERT INTO star_adjustments (id,member,delta,reason,at) VALUES (?,?,?,?,?)",
      ).run(spend.id, spend.member, -spend.cost, spend.name, spend.at);
      db.prepare("INSERT INTO reward_spends VALUES (?,?,?,?,?,?,?)").run(
        spend.id,
        spend.member,
        spend.reward,
        spend.revision,
        spend.name,
        spend.cost,
        spend.at,
      );
      return spend;
    });
  }
  return { snapshot, administer, apply };
}
