import { describe, expect, test } from "vitest";
import type { HouseholdMember } from "@/members/members";
import { type LocalDate, parseLocalDate } from "@/tasks/types";
import {
  type ExternalTaskRequest,
  externalTaskTitle,
  type IntakeHousehold,
  planExternalTask,
  TASK_TITLE_LIMIT,
} from "./intake";

function date(value: string): LocalDate {
  const parsed = parseLocalDate(value);
  if (!parsed) throw new Error(`bad test date ${value}`);
  return parsed;
}

const members: HouseholdMember[] = [
  { id: "dad", name: "Dad", status: "active", color: "#a9d8d2" },
  { id: "m-ellie", name: "Ellie", status: "active", color: "#f6c9c5" },
  { id: "gran", name: "Gran", status: "retired" },
];

const household: IntakeHousehold = {
  members,
  defaultMember: "dad",
  today: date("2026-11-15"),
};

function request(
  overrides: Partial<ExternalTaskRequest> & {
    attrs?: Record<string, string> | [string, string][];
  } = {},
): ExternalTaskRequest {
  const { attrs, ...rest } = overrides;
  return {
    id: "8122da57-6b67-5804-8ef8-1c587f6aeb7f",
    transcript: "Take out the recycling",
    notes: null,
    details: null,
    attributes: Array.isArray(attrs) ? attrs : Object.entries(attrs ?? {}),
    ...rest,
  };
}

function refusal(plan: ReturnType<typeof planExternalTask>) {
  return plan.ok ? null : plan.refusal;
}

function draft(plan: ReturnType<typeof planExternalTask>) {
  if (!plan.ok) throw new Error(`refused: ${plan.refusal}`);
  return plan.draft;
}

describe("defaults", () => {
  test("an unadorned request is a once Chore for the default member today", () => {
    expect(draft(planExternalTask(request(), household))).toEqual({
      title: "Take out the recycling",
      type: "chore",
      recurrence: { kind: "once", date: "2026-11-15" },
      assignment: { kind: "fixed", member: "dad" },
      time: null,
      stars: 0,
    });
  });

  test("no member and no default member is refused", () => {
    expect(
      refusal(
        planExternalTask(request(), { ...household, defaultMember: null }),
      ),
    ).toBe("no_default_member");
  });

  test("a retired default member is not usable", () => {
    expect(
      refusal(
        planExternalTask(request(), { ...household, defaultMember: "gran" }),
      ),
    ).toBe("no_default_member");
  });

  test("a default member no longer on the roster is not usable", () => {
    expect(
      refusal(
        planExternalTask(request(), { ...household, defaultMember: "gone" }),
      ),
    ).toBe("no_default_member");
  });
});

describe("member attribute", () => {
  test.each([
    ["Ellie", "m-ellie"],
    ["ellie", "m-ellie"],
    ["  ELLIE ", "m-ellie"],
    ["m-ellie", "m-ellie"],
    ["dad", "dad"],
  ])("%j assigns %s", (value, id) => {
    expect(
      draft(planExternalTask(request({ attrs: { member: value } }), household))
        .assignment,
    ).toEqual({ kind: "fixed", member: id });
  });

  test("the attribute name matches case-insensitively", () => {
    expect(
      draft(
        planExternalTask(request({ attrs: { Member: "Ellie" } }), household),
      ).assignment,
    ).toEqual({ kind: "fixed", member: "m-ellie" });
  });

  test("a named member wins over the default even without a default", () => {
    expect(
      draft(
        planExternalTask(request({ attrs: { member: "Ellie" } }), {
          ...household,
          defaultMember: null,
        }),
      ).assignment,
    ).toEqual({ kind: "fixed", member: "m-ellie" });
  });

  test.each([
    ["Grandpa"],
    ["Gran"],
    ["gran"],
    [""],
  ])("%j is an unknown member", (value) => {
    expect(
      refusal(
        planExternalTask(request({ attrs: { member: value } }), household),
      ),
    ).toBe("unknown_member");
  });

  test("differently-cased names that agree are accepted", () => {
    expect(
      draft(
        planExternalTask(
          request({ attrs: { member: "Ellie", MEMBER: "ellie" } }),
          household,
        ),
      ).assignment,
    ).toEqual({ kind: "fixed", member: "m-ellie" });
  });

  test("differently-cased names that disagree are refused", () => {
    expect(
      refusal(
        planExternalTask(
          request({ attrs: { member: "Ellie", Member: "Dad" } }),
          household,
        ),
      ),
    ).toBe("conflicting_attributes");
  });

  test("two Active Members with the same name are ambiguous", () => {
    expect(
      refusal(
        planExternalTask(request({ attrs: { member: "Sam" } }), {
          ...household,
          members: [
            ...members,
            { id: "sam-1", name: "Sam", status: "active", color: "#c8e5cd" },
            { id: "sam-2", name: "sam", status: "active", color: "#f7e3c8" },
          ],
        }),
      ),
    ).toBe("ambiguous_member");
  });
});

describe("date, time and stars", () => {
  test("valid values are used", () => {
    expect(
      draft(
        planExternalTask(
          request({ attrs: { Date: "2026-12-01", TIME: "07:30", stars: "3" } }),
          household,
        ),
      ),
    ).toMatchObject({
      recurrence: { kind: "once", date: "2026-12-01" },
      time: "07:30",
      stars: 3,
    });
  });

  test("a past date is accepted like any once Task", () => {
    expect(
      draft(
        planExternalTask(request({ attrs: { date: "2026-11-01" } }), household),
      ).recurrence,
    ).toEqual({ kind: "once", date: "2026-11-01" });
  });

  test.each([
    [{ date: "2026-02-30" }, "invalid_date"],
    [{ date: "tomorrow" }, "invalid_date"],
    [{ date: "2026-1-5" }, "invalid_date"],
    [{ time: "7:30" }, "invalid_time"],
    [{ time: "24:00" }, "invalid_time"],
    [{ time: "noon" }, "invalid_time"],
    [{ stars: "-1" }, "invalid_stars"],
    [{ stars: "1.5" }, "invalid_stars"],
    [{ stars: "three" }, "invalid_stars"],
    [{ stars: "99999999999999999999" }, "invalid_stars"],
    [{ stars: "2", Stars: "3" }, "conflicting_attributes"],
  ])("%j is refused as %s", (attrs, code) => {
    expect(refusal(planExternalTask(request({ attrs }), household))).toBe(code);
  });

  test("other attributes are ignored", () => {
    expect(
      draft(
        planExternalTask(
          request({ attrs: { project: "House", priority: "high" } }),
          household,
        ),
      ),
    ).toMatchObject({ stars: 0, time: null });
  });
});

describe("title", () => {
  test("whitespace collapses", () => {
    expect(
      externalTaskTitle(request({ transcript: "  Feed\n the   cat\t" })),
    ).toBe("Feed the cat");
  });

  test("notes and details follow the transcript after a dash", () => {
    expect(
      externalTaskTitle(
        request({ notes: "Two scoops", details: "Bowl by\nthe door" }),
      ),
    ).toBe("Take out the recycling — Two scoops — Bowl by the door");
    expect(externalTaskTitle(request({ details: "Blue bin" }))).toBe(
      "Take out the recycling — Blue bin",
    );
  });

  test("a long title is cut to the limit with an ellipsis", () => {
    const title = externalTaskTitle(request({ transcript: "a".repeat(600) }));
    expect(title).toHaveLength(TASK_TITLE_LIMIT);
    expect(title.endsWith("a…")).toBe(true);
  });

  test("a cut never splits a surrogate pair", () => {
    const title = externalTaskTitle(
      request({ transcript: `${"a".repeat(498)}😀😀` }),
    );
    expect(title).toBe(`${"a".repeat(498)}…`);
  });

  test("a request with no words is refused", () => {
    expect(
      refusal(planExternalTask(request({ transcript: " \n " }), household)),
    ).toBe("empty_task");
  });
});
