import { createHash, timingSafeEqual } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/** Agent credentials are accepted only here, never by browser or admin APIs. */
export async function handleMcp(
  request: Request,
  createServer: () => McpServer,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const token = process.env.FAMILYOS_MCP_TOKEN;
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    return Response.json(
      { error: "Agent access is not configured on this server." },
      { status: 503, headers },
    );
  // This endpoint serves non-browser clients. Reject every browser Origin,
  // including null; do not trust Host or forwarded headers for this decision.
  if (request.headers.has("origin"))
    return Response.json(
      { error: "Browser origins are not allowed on this endpoint." },
      { status: 403, headers },
    );
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(authorization);
  if (!match || !timingSafeEqual(digest(match[1]), digest(token)))
    return Response.json(
      { error: "A valid agent bearer token is required." },
      {
        status: 401,
        headers: {
          ...headers,
          "WWW-Authenticate": 'Bearer realm="familyos-mcp"',
        },
      },
    );
  if (request.method !== "POST")
    return new Response(null, {
      status: 405,
      headers: { ...headers, Allow: "POST" },
    });
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 64 * 1024,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    // JSON-only transport finishes the tool before resolving the response.
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("FamilyOS MCP request failed", error);
    return Response.json(
      {
        error:
          "FamilyOS could not process this request. Check the server logs and retry.",
      },
      { status: 500, headers },
    );
  } finally {
    await server.close();
  }
}
