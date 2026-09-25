# Agent access through MCP

FamilyOS exposes `/api/mcp` using Streamable HTTP. Agents can read the household
roster, Tasks and Rewards, create or edit assigned Tasks, check off an Occurrence,
and confirm a Reward Spend. Existing wall and admin interfaces continue to work
with their own credentials. Calendar, Lists, Bounty mutations, catalog editing,
and reward delivery tracking are outside this endpoint's current tool set.

## Enable and connect

1. Generate a secret with `openssl rand -hex 32`.
2. Set `FAMILYOS_MCP_TOKEN` to that 64-character lowercase hex value in the
   server environment or `.env.local`, then restart FamilyOS.
3. Configure the agent's MCP client with the server URL and an HTTP header:

   ```text
   URL: http://localhost:3000/api/mcp
   Authorization: Bearer <FAMILYOS_MCP_TOKEN>
   Transport: Streamable HTTP
   ```

Use port 3001 for development. `localhost` refers to the machine running the
MCP client; a client on another computer needs a reachable server address.
For remote use, prefer an SSH tunnel or HTTPS rather than sending this credential
in cleartext across a network. For example, from the client computer:

```bash
ssh -N -L 3300:127.0.0.1:3000 your-user@your-familyos-server
```

Then connect the client to `http://localhost:3300/api/mcp` with the same header.
Store the secret in the client's credential or environment configuration, not
in prompts or repository files. Clients must support explicit bearer headers;
this endpoint does not offer OAuth discovery/login or browser-origin requests.

The token authorizes every listed tool for this Household. A Household Member
ID identifies the person receiving completion credit or spending Stars, not the
agent's identity. Only give the token to agents you trust with these actions.
Changing it and restarting revokes the previous token; clearing it disables the
endpoint. Missing or malformed server configuration returns 503, bad credentials
return 401, and requests carrying an Origin header return 403.

## Tools

| Tool | Behavior |
| --- | --- |
| `list_members` | Active member IDs and names, family name and Household Time Zone. |
| `list_tasks` | Current assigned Occurrences, definitions, Bounty offerings/claims, progress and Star Balances. |
| `create_task` | Creates an assigned Chore or Routine. Requires a UUID `requestId` and full `draft`. |
| `edit_task` | Saves a full draft for a current Task ID. Assignment/recurrence edits may return a replacement ID. Requires a UUID `requestId`. |
| `complete_task` | Completes the exact `task`/`window` from the read, crediting the specified active `member` once. |
| `list_rewards` | Active catalog IDs, costs and revisions, goals and balances. |
| `spend_reward` | Confirms spending against a Reward revision. Requires a UUID `requestId`, active `member`, `reward` and `revision`. |

Read members and current state first. For edits, preserve every field the user did
not ask to change and use the returned definition afterward. A draft includes
`title`, `type` (`chore` or `routine`), `assignment` (fixed member or rotation),
`recurrence` (once/daily/weekly/monthly), `time` (`HH:mm` or null), and nonnegative
integer `stars`. The advertised MCP schemas describe each variant.

Retry uncertain writes with the **same request ID and identical inputs**. Task
create/edit receipts persist in the Task database and commit atomically with the
change. A replay returns the original result even after later edits; refresh the
read before making another change. Completion uses its existing task/window key.
Reward Spends retain their existing immutable receipts and cannot overdraw a
balance. Reusing a write request ID for different inputs fails.

A Reward Spend deducts Stars; it does not confirm delivery. If a reward's price
or availability changed, read again and have the user choose at the current
price before sending a new Spend. Expected domain conflicts appear as MCP tool
errors; unexpected errors are logged on the server and return a generic message.

## Implementation and validation

The Next route explicitly composes registrations from the Tasks and Rewards
slices, supplying the existing Task database to Rewards. Slice boundaries and
browser authentication stay intact. The official MCP TypeScript SDK handles
protocol negotiation, schema discovery and Streamable HTTP framing. Requests
use a fresh server/transport, JSON responses and no connection session; GET and
DELETE return 405 after authentication. POST bodies are limited to 64 KiB.

`src/app/api/mcp/route.test.ts` uses the real MCP SDK client and transport with
temporary household files and SQLite databases. It exercises discovery,
authentication, validation, edits, completion, spending, and retries after the
database connection is reopened.

Reverting this change removes agent access without undoing Task edits or Reward
Spends. The additive `agent_task_writes` receipt table can remain in place; older
code ignores it. No existing tables or user data are removed.
