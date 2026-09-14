"use client";

import Link from "next/link";
import { type CSSProperties, useRef, useState } from "react";
import {
  type ActiveMember,
  type MemberId,
  type MemberTaskPalette,
  memberTaskPalette,
  onFillInk,
} from "@/members/members";
import { Avatar } from "@/shared/ui/Avatar";
import { Icon } from "@/shared/ui/Icon";
import { TaskRow, type TaskRowStatus } from "./TaskRow";
import styles from "./TasksBoard.module.css";
import {
  type AvailableBounty,
  type ClaimedBounty,
  type ClaimId,
  isUnfinishedBountyClaim,
  type Occurrence,
  type OfferingId,
  type TasksViewRead,
} from "./types";
import { occurrencesForColumn } from "./view";

type BoardLocation =
  | { kind: "board" }
  | { kind: "member"; member: MemberId }
  | { kind: "household" }
  | { kind: "bounties" };

type TaskGroup = {
  location: Extract<BoardLocation, { kind: "member" | "household" }>;
  key: string;
  name: string;
  palette: MemberTaskPalette;
  done: number;
  total: number;
  rows: Occurrence[];
  bounties: ClaimedBounty[];
};

type ClaimSelection = {
  occurrence: Occurrence;
  onPick: (member: MemberId) => void;
  onCancel: () => void;
};

type TaskActions = {
  onComplete: (row: Occurrence) => void;
  onClaim: (row: Occurrence) => void;
  onSkip: (row: Occurrence) => void;
  onEdit: (row: Occurrence) => void;
  onCompleteBounty: (row: ClaimedBounty) => void;
  onReleaseBounty: (row: ClaimedBounty) => void;
  onClaimBounty: (row: AvailableBounty) => void;
  onAddBounty: () => void;
  mutatingBountyClaims: ReadonlySet<ClaimId>;
  mutatingBountyOfferings: ReadonlySet<OfferingId>;
};

const HOUSEHOLD_PALETTE = memberTaskPalette("#85958c");
const BOARD_PREVIEW_COUNT = 3;

function paletteStyle(palette: MemberTaskPalette): CSSProperties {
  return {
    "--task-accent": palette.accent,
    "--task-panel": palette.panel,
    "--task-header": palette.header,
    "--task-ink": palette.ink,
    "--task-control": palette.control,
    "--task-on-control": palette.onControl,
  } as CSSProperties;
}

function statusFor(row: Occurrence): TaskRowStatus {
  switch (row.state) {
    case "done":
      return { kind: "done" };
    case "skipped":
      return { kind: "skipped", reason: row.reason };
    default:
      return { kind: "open" };
  }
}

function Progress({ group }: { group: TaskGroup }) {
  return (
    <progress
      className={styles.progress}
      aria-label={`${group.name} completed tasks`}
      max={group.total || 1}
      value={group.done}
    />
  );
}

function GroupAvatar({ group }: { group: TaskGroup }) {
  return (
    <Avatar
      name={group.name}
      size={48}
      ring={false}
      surface={{
        soft: group.palette.accent,
        ink: onFillInk(group.palette.accent),
      }}
    />
  );
}

function GroupTasks({
  group,
  claimSelection,
  onOpen,
  onComplete,
  onClaim,
  onSkip,
  onEdit,
  onCompleteBounty,
  onReleaseBounty,
  mutatingBountyClaims,
}: TaskActions & {
  group: TaskGroup;
  claimSelection: ClaimSelection | null;
  onOpen?: () => void;
}) {
  const preview = onOpen !== undefined;
  const remaining = group.rows.filter(
    (row) => row.state !== "done" && row.state !== "skipped",
  );
  const finished = group.rows.filter(
    (row) => row.state === "done" || row.state === "skipped",
  );
  const unfinishedBounties = group.bounties.filter(isUnfinishedBountyClaim);
  const completedBounties = group.bounties.filter(
    (row) => row.state.kind === "completed",
  );
  const remainingWork = [
    ...unfinishedBounties.map((row) => ({ kind: "bounty" as const, row })),
    ...remaining.map((row) => ({ kind: "assigned" as const, row })),
  ];
  const visibleWork = preview
    ? remainingWork.slice(0, BOARD_PREVIEW_COUNT)
    : remainingWork;
  const taskRow = (row: Occurrence) => (
    <TaskRow
      key={`${row.task}:${row.window}`}
      label={row.title}
      time={row.time}
      status={statusFor(row)}
      onComplete={row.assignee !== null ? () => onComplete(row) : undefined}
      onClaim={
        row.assignee === null && row.state === "pending"
          ? () => onClaim(row)
          : undefined
      }
      onCancelClaim={
        claimSelection?.occurrence.task === row.task &&
        claimSelection.occurrence.window === row.window
          ? claimSelection.onCancel
          : undefined
      }
      onSkip={
        !preview && (row.state === "pending" || row.state === "claimed")
          ? () => onSkip(row)
          : undefined
      }
      onEdit={!preview ? () => onEdit(row) : undefined}
    />
  );
  return (
    <div className={styles.groupTasks}>
      {remaining.length === 0 && unfinishedBounties.length === 0 ? (
        <div className={styles.empty}>
          <Icon name="check" size={32} />
          <p>
            {group.total > 0 && group.done === group.total
              ? "All done for today"
              : group.rows.length > 0 || group.bounties.length > 0
                ? "Nothing left to do"
                : "No tasks today"}
          </p>
        </div>
      ) : (
        visibleWork.map((work) =>
          work.kind === "assigned" ? (
            taskRow(work.row)
          ) : (
            <TaskRow
              key={work.row.claim.id}
              label={work.row.claim.title}
              stars={work.row.claim.stars}
              status={{ kind: "open" }}
              mutationPending={mutatingBountyClaims.has(work.row.claim.id)}
              onComplete={() => onCompleteBounty(work.row)}
              onRelease={!preview ? () => onReleaseBounty(work.row) : undefined}
            />
          ),
        )
      )}
      <div className={styles.taskFooter}>
        {preview && remainingWork.length > visibleWork.length ? (
          <button type="button" className={styles.more} onClick={onOpen}>
            {remainingWork.length - visibleWork.length} more{" "}
            {remainingWork.length - visibleWork.length === 1 ? "task" : "tasks"}
            <Icon name="chevron-right" size={20} />
          </button>
        ) : null}
        {finished.length + completedBounties.length > 0 ? (
          <details className={styles.finished}>
            <summary>
              {finished.length + completedBounties.length} completed or skipped
              <Icon name="chevron-right" size={20} />
            </summary>
            {finished.map(taskRow)}
            {completedBounties.map((row) => (
              <TaskRow
                key={row.claim.id}
                label={row.claim.title}
                stars={row.claim.stars}
                status={{ kind: "done" }}
              />
            ))}
          </details>
        ) : null}
      </div>
    </div>
  );
}

export function TasksBoard({
  members,
  tasks,
  claimSelection,
  ...actions
}: TaskActions & {
  members: ActiveMember[];
  tasks: TasksViewRead;
  claimSelection: ClaimSelection | null;
}) {
  const [location, setLocation] = useState<BoardLocation>({ kind: "board" });
  const scrollRef = useRef<HTMLDivElement>(null);
  const boardScroll = useRef(0);
  const returnKey = useRef<string | null>(null);
  const boardHeaders = useRef(new Map<string, HTMLButtonElement>());
  const backRef = useRef<HTMLButtonElement>(null);
  const groups: TaskGroup[] = members.map((member) => {
    const progress = tasks.progress.find((row) => row.member === member.id);
    return {
      key: `member:${member.id}`,
      location: { kind: "member", member: member.id },
      name: member.name,
      palette: memberTaskPalette(member.color),
      done: progress?.done ?? 0,
      total: progress?.total ?? 0,
      rows: occurrencesForColumn(
        tasks.occurrences.filter(
          (row) => row.assignee === member.id && row.state !== "expired",
        ),
      ),
      bounties: tasks.bountyClaims.filter(
        (row) => row.claim.member === member.id,
      ),
    };
  });
  const householdRows = occurrencesForColumn(
    tasks.occurrences.filter(
      (row) =>
        row.assignee === null &&
        (row.state === "pending" || row.state === "skipped"),
    ),
  );
  if (householdRows.length > 0 || location.kind === "household") {
    groups.push({
      key: "household",
      location: { kind: "household" },
      name: "Household",
      palette: HOUSEHOLD_PALETTE,
      done: 0,
      total: householdRows.length,
      rows: householdRows,
      bounties: [],
    });
  }
  const selected = groups.find((group) =>
    location.kind === "member"
      ? group.location.kind === "member" &&
        group.location.member === location.member
      : location.kind === "household" && group.location.kind === "household",
  );
  const bountySelected = location.kind === "bounties";

  function open(group: TaskGroup) {
    if (!selected && !bountySelected) {
      boardScroll.current = scrollRef.current?.scrollTop ?? 0;
      returnKey.current = group.key;
    }
    setLocation(group.location);
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      backRef.current?.focus({ preventScroll: true });
    });
  }

  function openBounties() {
    if (!selected && !bountySelected) {
      boardScroll.current = scrollRef.current?.scrollTop ?? 0;
    }
    setLocation({ kind: "bounties" });
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      backRef.current?.focus({ preventScroll: true });
    });
  }

  function back() {
    setLocation({ kind: "board" });
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = boardScroll.current;
      if (returnKey.current) {
        boardHeaders.current
          .get(returnKey.current)
          ?.focus({ preventScroll: true });
      }
    });
  }

  const claimButton = (group: TaskGroup) =>
    claimSelection && group.location.kind === "member" ? (
      <button
        type="button"
        className={styles.claimFor}
        onClick={() => {
          if (group.location.kind === "member") {
            claimSelection.onPick(group.location.member);
          }
        }}
      >
        <Icon name="user-plus" size={20} />
        Claim for {group.name}
      </button>
    ) : null;

  return (
    <div className={styles.boardScreen}>
      {selected || bountySelected ? (
        <div className={styles.focusNavigation}>
          <button
            ref={backRef}
            type="button"
            className={styles.back}
            onClick={back}
          >
            <Icon name="chevron-left" size={22} /> Family Board
          </button>
          <nav className={styles.memberPicker} aria-label="Member tasks">
            {groups.map((group) => (
              <div key={group.key} style={paletteStyle(group.palette)}>
                <button
                  type="button"
                  className={styles.memberChoice}
                  aria-label={`View tasks for ${group.name}`}
                  aria-pressed={selected?.key === group.key}
                  onClick={() => open(group)}
                >
                  <GroupAvatar group={group} />
                  <span>{group.name}</span>
                </button>
                {claimButton(group)}
              </div>
            ))}
            <button
              type="button"
              className={styles.memberChoice}
              aria-label="Bounties"
              aria-pressed={bountySelected}
              onClick={openBounties}
            >
              <Icon name="star" size={22} />
              <span>Bounties</span>
            </button>
          </nav>
        </div>
      ) : (
        <div className={styles.boardHeading}>
          <h2>Family Board</h2>
          <button
            type="button"
            className={styles.bountiesEntry}
            onClick={openBounties}
          >
            <Icon name="star" size={22} /> Bounties
          </button>
        </div>
      )}
      {claimSelection ? (
        <div className={styles.claimPrompt}>
          <output>
            Claim {claimSelection.occurrence.title} for a household member
          </output>
          <button
            type="button"
            className={styles.back}
            onClick={claimSelection.onCancel}
          >
            Cancel claim
          </button>
        </div>
      ) : null}
      <div ref={scrollRef} className={styles.scroll}>
        {!selected && !bountySelected ? (
          <div className={styles.board}>
            {groups.map((group) => (
              <section
                key={group.key}
                className={styles.memberCard}
                style={paletteStyle(group.palette)}
                aria-label={`${group.name} tasks`}
              >
                <header className={styles.cardHeader}>
                  <h2 aria-label={group.name}>
                    <button
                      ref={(node) => {
                        if (node) boardHeaders.current.set(group.key, node);
                        else boardHeaders.current.delete(group.key);
                      }}
                      type="button"
                      className={styles.memberHeader}
                      aria-label={`View tasks for ${group.name}`}
                      onClick={() => open(group)}
                    >
                      <GroupAvatar group={group} />
                      <span>{group.name}</span>
                      <Icon name="chevron-right" size={24} />
                      <span className={styles.progressLabel}>
                        <span>
                          {group.done}/{group.total} done
                        </span>
                        <Progress group={group} />
                      </span>
                    </button>
                  </h2>
                  {claimButton(group)}
                </header>
                <GroupTasks
                  {...actions}
                  group={group}
                  claimSelection={claimSelection}
                  onOpen={() => open(group)}
                />
              </section>
            ))}
          </div>
        ) : null}
        {selected ? (
          <div className={styles.focus} style={paletteStyle(selected.palette)}>
            <section
              className={styles.focusTasks}
              aria-label={`${selected.name} tasks`}
            >
              <header className={styles.focusHeader}>
                <GroupAvatar group={selected} />
                <div>
                  <h2>
                    {selected.location.kind === "household"
                      ? "Household tasks"
                      : `${selected.name}’s tasks`}
                  </h2>
                  <p>
                    {selected.rows.filter(
                      (row) =>
                        row.state === "pending" || row.state === "claimed",
                    ).length +
                      selected.bounties.filter(isUnfinishedBountyClaim)
                        .length}{" "}
                    remaining
                  </p>
                </div>
              </header>
              <GroupTasks
                key={selected.key}
                {...actions}
                group={selected}
                claimSelection={claimSelection}
              />
            </section>
            <aside className={styles.focusSummary}>
              <p>Today’s progress</p>
              <div className={styles.bigProgress}>
                {selected.done}
                <span>/{selected.total}</span>
              </div>
              <Progress group={selected} />
              <h2>
                {selected.total > 0 && selected.done === selected.total
                  ? "All done for today"
                  : "One task at a time"}
              </h2>
              {selected.location.kind !== "household" &&
              householdRows.length > 0 ? (
                <button
                  type="button"
                  className={styles.householdLink}
                  onClick={() => {
                    const household = groups.find(
                      (group) => group.location.kind === "household",
                    );
                    if (household) open(household);
                  }}
                >
                  Household tasks <Icon name="chevron-right" size={22} />
                </button>
              ) : null}
            </aside>
          </div>
        ) : null}
        {bountySelected ? (
          <section className={styles.bountyFocus} aria-label="Bounties">
            <header className={styles.bountyHeader}>
              <div>
                <h2>Available Bounties</h2>
                <p>Pick some work and choose who will take it.</p>
              </div>
              <button
                type="button"
                className={styles.rowAction}
                onClick={actions.onAddBounty}
              >
                Add Bounty
              </button>
            </header>
            <div className={styles.groupTasks}>
              {tasks.availableBounties.length === 0 ? (
                <div className={styles.empty}>
                  <Icon name="star" size={32} />
                  <p>No Bounties available</p>
                </div>
              ) : (
                tasks.availableBounties.map((row) => (
                  <TaskRow
                    key={row.id}
                    label={row.title}
                    stars={row.stars}
                    status={{ kind: "open" }}
                    mutationPending={actions.mutatingBountyOfferings.has(
                      row.id,
                    )}
                    onClaim={() => actions.onClaimBounty(row)}
                  />
                ))
              )}
            </div>
            <div className={styles.manageBounties}>
              <div>
                <h2>Manage Bounties</h2>
                <p>Edit rewards, retire old work, and review history.</p>
              </div>
              <Link className={styles.rowAction} href="/admin/bounties">
                Manage
                <Icon name="chevron-right" size={20} />
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
