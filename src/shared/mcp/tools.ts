import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export class AgentInputError extends Error {}

/** Only explicitly safe domain errors reach the agent. */
export async function toolResult(
  action: () => unknown | Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const result = await action();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    if (error instanceof AgentInputError) {
      return {
        isError: true,
        content: [{ type: "text", text: error.message }],
      };
    }
    console.error("FamilyOS MCP tool failed", error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "FamilyOS could not finish this request. Retry with the same request ID; check the server logs if it persists.",
        },
      ],
    };
  }
}

export const readAnnotations = { readOnlyHint: true, openWorldHint: false };
export const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
