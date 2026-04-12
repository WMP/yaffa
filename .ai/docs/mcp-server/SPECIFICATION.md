# MCP Server

## Feature Summary

Expose yaffa as a Model Context Protocol (MCP) server using the `laravel/mcp` package (already listed as a project dependency in AGENTS.md). External AI clients — Claude Desktop, Cursor, custom agents — can query and manipulate the authenticated user's financial data through a standardized tool interface.

MCP tools are organized into two servers with distinct access profiles: a read-only server for safe portfolio queries, and a write server for mutations. Both authenticate via Laravel Sanctum personal access tokens with a dedicated `mcp` ability, enforced through bearer-only middleware that explicitly rejects session-based authentication. A dedicated UI page lets users generate and manage tokens.

## Goals / Non-Goals

- Goals:
  - Implement two MCP servers via `laravel/mcp`: `YaffaReadServer` and `YaffaWriteServer`.
  - Authenticate requests via Sanctum personal access tokens with the `mcp` ability.
  - Reject session-based authentication on the MCP endpoints (bearer token only).
  - Provide a UI for users to create, name, and revoke MCP tokens.
  - Add `throttle:mcp` rate limiting to MCP routes.
  - Log each tool call (tool name, user id, timestamp, success/error) for basic audit trail.
  - Use `outputSchema()` on MCP tool classes to return structured data, not JSON-as-text.
  - Tools delegate to the same service layer used by the chat assistant and regular API.

- Non-Goals:
  - MCP Resources or Prompts primitives (tools only in MVP).
  - SSE server-to-client push stream (not needed with Streamable HTTP transport).
  - OAuth 2.1 authorization flow (Sanctum PAT is sufficient for self-hosted use).
  - Token scoping beyond `mcp` ability in MVP.
  - Per-user rate limit overrides (global `throttle:mcp` is sufficient for MVP).

## Assumptions

- `laravel/mcp` is installed via Composer and `routes/ai.php` is published.
- `laravel/mcp` handles all protocol-level concerns: `initialize` handshake, `tools/list`, `tools/call` dispatch, protocol version negotiation, JSON-RPC envelope. No custom controller is written for these.
- Tool execution is synchronous within the HTTP request; a 60-second timeout applies.
- Delegating to shared services (not re-implementing data logic in MCP tool classes) keeps both servers in sync automatically.
- Tools in `YaffaWriteServer` must not be included in `YaffaReadServer` and vice versa.

## Why Two Servers

Separating read and write tools into distinct servers allows clients to be granted minimal access:

- A read-only dashboard integration gets the URL for `YaffaReadServer` only.
- A fully capable agent gets both, or only `YaffaWriteServer` if reads can be inferred.
- It also prevents accidental write exposure when a client only needs portfolio data.

## Backend Scope (Laravel)

- Dependencies:
  - Add `laravel/mcp` to `composer.json` (already in AGENTS.md, not yet in composer.json).
  - Publish `routes/ai.php` via `php artisan vendor:publish --tag=ai-routes`.

- Models:
  - No new models. Sanctum's `PersonalAccessToken` is used as-is.

- Migrations:
  - None.

- MCP Servers (new, in `app/Mcp/Servers/`):
  - `YaffaReadServer` — registers read-only tools.
  - `YaffaWriteServer` — registers mutation tools.

- MCP Tools (new, in `app/Mcp/Tools/`, extend `Laravel\Mcp\Server\Tool`):
  - Read tools (registered in `YaffaReadServer`):
    - `ListInvestmentsTool`
    - `GetInvestmentDetailsTool`
    - `ListTransactionsTool`
    - `ListAccountsTool`
    - `GetAccountBalanceTool`
    - `ListPayeesTool`
    - `ListCategoriesTool`
    - `GetCashflowReportTool`
  - Write tools (registered in `YaffaWriteServer`):
    - `CreateInvestmentTransactionTool`
    - `CreateStandardTransactionTool`

- Controllers / APIs:
  - `ApiTokenController` (new, in `app/Http/Controllers/API/`)
    - `GET /api/v1/user/api-tokens` — list tokens (id, name, abilities, last_used_at, created_at). Plaintext never returned after creation.
    - `POST /api/v1/user/api-tokens` — create token; returns plaintext once.
    - `DELETE /api/v1/user/api-tokens/{tokenId}` — revoke token.

- Middleware:
  - `RequireBearerToken` (new) — rejects requests authenticated via session (no `tokenCan` check can substitute this); ensures `/mcp` is only accessible with a Sanctum PAT, never from a browser session.

- Services:
  - Each MCP tool delegates directly to the existing service layer (same services used by `TransactionApiController`, `InvestmentApiController`, etc.). No new service classes are introduced for MCP.

- Routing (in `routes/ai.php`):
  ```php
  use App\Mcp\Servers\YaffaReadServer;
  use App\Mcp\Servers\YaffaWriteServer;
  use Laravel\Mcp\Facades\Mcp;

  Mcp::web('/mcp/read', YaffaReadServer::class)
      ->middleware(['auth:sanctum', 'require-bearer-token', 'throttle:mcp']);

  Mcp::web('/mcp/write', YaffaWriteServer::class)
      ->middleware(['auth:sanctum', 'require-bearer-token', 'throttle:mcp']);
  ```

- Audit logging:
  - Each tool's `handle()` method writes a log entry via `Log::info()` or a dedicated channel: tool name, user ID, arguments summary (no sensitive values), success/error outcome.

- Policies / Auth:
  - `auth:sanctum` resolves the user from the Bearer token.
  - `RequireBearerToken` middleware rejects session-authenticated requests with HTTP 401.
  - `$request->user()->tokenCan('mcp')` is checked inside `RequireBearerToken` after confirming a PAT is present.
  - `ApiTokenController` uses `auth:sanctum` + `verified`.

## Frontend Scope (Vue + Bootstrap)

- Pages / Routes:
  - New tab in the existing user settings page: **API Tokens**.

- Components:
  - `ApiTokenManager.vue` (new)
    - Lists existing tokens: name, abilities, last used, created date, revoke button.
    - "Create token" form: name input (required) + submit.
    - After creation: one-time alert with the plaintext token and a copy button. Clear instruction that the token will not be shown again.
    - Revoke: inline confirmation before DELETE.

- State management:
  - Component-local state only.

- API interactions:
  - `GET /api/v1/user/api-tokens`
  - `POST /api/v1/user/api-tokens`
  - `DELETE /api/v1/user/api-tokens/{id}`

- UX / validation rules:
  - Token name: required, max 100 characters.
  - After revocation: token removed from list immediately without page reload.
  - Copy button uses the Clipboard API; shows "Copied!" for 2 seconds.

## Tool Design

### Read/Write Classification

| Tool | Server | Idempotent |
|---|---|---|
| `ListInvestmentsTool` | Read | Yes |
| `GetInvestmentDetailsTool` | Read | Yes |
| `ListTransactionsTool` | Read | Yes |
| `ListAccountsTool` | Read | Yes |
| `GetAccountBalanceTool` | Read | Yes |
| `ListPayeesTool` | Read | Yes |
| `ListCategoriesTool` | Read | Yes |
| `GetCashflowReportTool` | Read | Yes |
| `CreateInvestmentTransactionTool` | Write | No |
| `CreateStandardTransactionTool` | Write | No |

### Write Tool Idempotency

Write tools are not idempotent. MCP clients must not retry a `tools/call` for a write tool after a timeout or ambiguous failure. Each tool returns the created record's ID in its output so that clients can verify the outcome by calling the corresponding read tool.

### Structured Output

Each tool implements `outputSchema()` using `laravel/mcp`'s `JsonSchema` fluent API. Example for `ListInvestmentsTool`:

```php
public function outputSchema(JsonSchema $schema): array
{
    return [
        'investments' => $schema->array()
            ->description('List of investments belonging to the user.')
            ->items($schema->object()->properties([
                'id'       => $schema->integer()->description('Investment ID')->required(),
                'name'     => $schema->string()->description('Investment name')->required(),
                'symbol'   => $schema->string()->description('Ticker symbol')->required(),
                'currency' => $schema->string()->description('ISO currency code')->required(),
                'active'   => $schema->boolean()->description('Whether automatic price updates are enabled')->required(),
            ])),
    ];
}
```

### Tool Descriptions

Tool descriptions are the primary signal for LLM tool selection. They must be specific and action-oriented.

| Tool | Key description element |
|---|---|
| `ListInvestmentsTool` | "Call this first when the user mentions an investment by name or symbol, to resolve its ID before creating a transaction." |
| `CreateInvestmentTransactionTool` | "Requires `investment_id` from ListInvestments. Supported types: buy, sell, dividend, add_shares, remove_shares. Do not guess IDs." |
| `GetAccountBalanceTool` | "Use this to answer questions about available funds or current account state." |

## Data & API Design

### Token API

`POST /api/v1/user/api-tokens`
Request: `{ "name": "Claude Desktop" }`
Response 201: `{ "id": 1, "name": "Claude Desktop", "token": "1|plaintext-shown-once", "abilities": ["mcp"] }`

`GET /api/v1/user/api-tokens`
Response: `{ "data": [{ "id": 1, "name": "Claude Desktop", "abilities": ["mcp"], "last_used_at": "...", "created_at": "..." }] }`

`DELETE /api/v1/user/api-tokens/{id}` → 204 No Content.

### Client Configuration (Claude Desktop)

```json
{
  "mcpServers": {
    "yaffa-read": {
      "type": "http",
      "url": "https://your-yaffa-instance.example.com/mcp/read",
      "headers": { "Authorization": "Bearer <token>" }
    },
    "yaffa-write": {
      "type": "http",
      "url": "https://your-yaffa-instance.example.com/mcp/write",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## Processing Flow

1. External MCP client sends `POST /mcp/read` or `POST /mcp/write` with `Authorization: Bearer <token>`.
2. `auth:sanctum` validates the token and resolves the user.
3. `RequireBearerToken` middleware confirms authentication is via PAT (not session) and that the token has the `mcp` ability.
4. `laravel/mcp` dispatches the JSON-RPC method (`tools/list`, `tools/call`, etc.).
5. For `tools/call`: the appropriate MCP tool's `handle()` method is invoked with the authenticated user in context.
6. Tool delegates to the existing service layer, scoped to the user.
7. Tool logs the call.
8. `laravel/mcp` formats the response using the tool's `outputSchema()`.

## Security Considerations

- Token plaintext is shown once at creation; Sanctum stores only the hash.
- The `RequireBearerToken` middleware is the enforcement point that prevents first-party session auth from accessing `/mcp/*`. This addresses the known `tokenCan()` behaviour where it returns `true` for all abilities in session-authenticated contexts.
- Write tools (`/mcp/write`) may only be accessed with a token that explicitly has the `mcp` ability. Read-only integrations should be pointed at `/mcp/read` only.
- All tool queries are scoped to `$request->user()` — no cross-user access is possible.
- Tool arguments are validated via `$request->validate()` inside `handle()` before reaching the service layer.
- `throttle:mcp` prevents abusive call volumes.

## Test Strategy

- Backend unit tests:
  - Each MCP tool: valid input → correct service call → correct structured output shape.
  - Each MCP tool: invalid input fails `validate()` and returns a tool error response.
  - `RequireBearerToken`: session-authenticated request → 401.
  - `RequireBearerToken`: bearer token without `mcp` ability → 401.
  - `ApiTokenController`: create returns plaintext once; list never returns plaintext; revoke removes token.
- Backend feature tests:
  - `POST /mcp/read` without token → 401.
  - `POST /mcp/read` with valid PAT and `mcp` ability → `tools/list` returns read tools only.
  - `POST /mcp/write` with valid PAT → `tools/call CreateInvestmentTransaction` creates a record and returns its ID.
  - `POST /mcp/write` with session auth (no Bearer header) → 401.
  - `DELETE /api/v1/user/api-tokens/{id}` for another user's token → 403.
- Edge cases:
  - Write tool called twice with identical arguments → two records created (not idempotent; expected).
  - Tool called with unknown investment ID → tool returns structured error in output, `isError: true`.
  - Token revoked mid-session → next request returns 401.

## Acceptance Criteria

- Given a user creates an MCP token, when they configure Claude Desktop with that token and ask "list my investments", then `YaffaReadServer` returns the user's investments as structured JSON, not as a plain text blob.
- Given the MCP token is used from a browser session (no Bearer header), then `POST /mcp/read` returns 401.
- Given a user revokes a token, then the next MCP request with that token returns 401.
- Given a client points only at `/mcp/read`, then write tools are not exposed and cannot be called.
- Given `CreateInvestmentTransactionTool` is called with valid arguments, then the transaction is created and the response includes the new transaction ID.
- Given `CreateInvestmentTransactionTool` is called twice with identical arguments, then two separate transactions are created (no silent deduplication).
- Given a tool is called with invalid arguments, then the response contains `isError: true` and a human-readable message; no unhandled exception is thrown.
