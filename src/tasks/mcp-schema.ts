import { z } from "zod";
import { parseCreateTaskDraft, parseLocalDate, parseTaskId } from "./types";

export const taskIdSchema = z
  .string()
  .min(1)
  .max(200)
  .transform((value, ctx) => {
    const id = parseTaskId(value);
    if (id) return id;
    ctx.addIssue({ code: "custom", message: "Invalid Task ID" });
    return z.NEVER;
  });
export const dateSchema = z.string().transform((value, ctx) => {
  const date = parseLocalDate(value);
  if (date) return date;
  ctx.addIssue({ code: "custom", message: "Use a valid YYYY-MM-DD date" });
  return z.NEVER;
});
export const memberSchema = z.string().min(1).max(200);
export const draftSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(500),
    type: z.enum(["chore", "routine"]),
    recurrence: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("daily") }),
      z.strictObject({ kind: z.literal("once"), date: dateSchema }),
      z.strictObject({
        kind: z.literal("weekly"),
        days: z
          .array(z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]))
          .min(1)
          .max(7),
      }),
      z.strictObject({
        kind: z.literal("monthly"),
        day: z.number().int().min(1).max(28),
      }),
    ]),
    assignment: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("fixed"), member: memberSchema }),
      z.strictObject({
        kind: z.literal("rotation"),
        order: z.array(memberSchema).min(1).max(6),
      }),
    ]),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    stars: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .transform((value, ctx) => {
    const draft = parseCreateTaskDraft(value);
    if (draft && draft.assignment.kind !== "open")
      return { ...draft, assignment: draft.assignment };
    ctx.addIssue({
      code: "custom",
      message: "Invalid assigned Task definition",
    });
    return z.NEVER;
  });
export const taskWriteSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("create"),
    requestId: z.uuid(),
    draft: draftSchema,
  }),
  z.strictObject({
    kind: z.literal("edit"),
    requestId: z.uuid(),
    task: taskIdSchema,
    draft: draftSchema,
  }),
]);
export type AgentTaskWrite = z.output<typeof taskWriteSchema>;
