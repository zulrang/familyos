import { expect, test, vi } from "vitest";
import { AgentInputError, toolResult } from "./tools";

test("domain errors are actionable, unexpected failures are logged without exposing internals", async () => {
  expect(
    await toolResult(() => {
      throw new AgentInputError("Refresh the reward before spending.");
    }),
  ).toEqual({
    isError: true,
    content: [{ type: "text", text: "Refresh the reward before spending." }],
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const failure = new Error(
      "Database path /private/household and secret configuration",
    );
    const result = await toolResult(() => {
      throw failure;
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("/private/household");
    expect(JSON.stringify(result)).toContain("same request ID");
    expect(log).toHaveBeenCalledWith("FamilyOS MCP tool failed", failure);
  } finally {
    log.mockRestore();
  }
});
