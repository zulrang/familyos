# Agents use a separate MCP credential and existing domain stores

Agents access this single-Household installation through `/api/mcp`, using a
separate revocable bearer token. They are not Trusted Displays or PIN sessions:
those credentials represent browser access and are not suitable for unattended
clients. The token grants only the endpoint's explicit tool set; it does not
authenticate requests to other APIs. Agent access stays disabled until configured.

The route composes slice-owned tool registrations using the official MCP SDK's
stateless Streamable HTTP transport. The SDK replaces protocol negotiation,
framing and schema-discovery code outside FamilyOS's domain. Native HTTP bearer
configuration is sufficient for trusted local clients; OAuth onboarding and
per-agent scopes are deferred. Clients requiring OAuth or browser access cannot
connect to this version. Remote clients need a protected transport such as an
SSH tunnel or HTTPS.

Task and Reward data remain in their existing stores. Agent Task create/edit
commands additionally persist request payloads and results atomically with each
write, so retrying a lost response cannot duplicate a retire-and-replace edit.
Reward Spends and completions reuse existing domain receipts and Star Balance
rules. A Reward Spend retains its current meaning: Stars spent, not delivery.

See [the setup and tool contract](../mcp.md). Protocol references:
[SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) and
[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
