# MCP Server

## Feature Summary

Expose yaffa as a Model Context Protocol (MCP) server, allowing external AI clients (Claude Desktop, Cursor, custom agents) to query and manipulate the authenticated user's financial data through a standardized tool interface.

The MCP server reuses the tool catalog introduced by the AI Chat Assistant feature (`AiToolRegistry`, `AiTool` implementations). It adds a single HTTP endpoint implementing the MCP Streamable HTTP transport (protocol version 2025-03-26), authenticated via Laravel Sanctum personal access tokens. A dedicated UI page allows users to generate and manage these tokens.

## Goals / Non-Goals

- Goals:
  - Implement the MCP Streamable HTTP transport at a single `/mcp` endpoint.
  - Expose all tools from `AiToolRegistry` as MCP tools.
  - Authenticate requests via Sanctum personal access tokens with a dedicated `mcp` ability.
  - Provide a UI for users to create, name, and revoke MCP tokens.
  - Support `initialize`, `tools/list`, and `tools/call` MCP methods in MVP.

- Non-Goals:
  - MCP Resources or Prompts primitives (tools only in MVP).
  - SSE server-to-client push stream (GET `/mcp` returns 405 in MVP).
  - OAuth 2.0 authorization flow (simple Bearer token is sufficient).
  - Token scoping beyond a single `mcp` ability.
  - Rate limiting per MCP token (can be added in a follow-up).
  - Audit log of MCP tool calls.
  - Support for the deprecated HTTP+SSE transport (2024-11-05).

## Assumptions

- `AiToolRegistry` and all `AiTool` implementations from the AI Chat Assistant feature are available.
- Laravel Sanctum is already installed and the `User` model uses `HasApiTokens`.
- Clients send a `POST` to `/mcp` for all MCP messages (Streamable HTTP transport).
- Session management: the server does not issue `Mcp-Session-Id` in MVP; each request is stateless and authenticated solely by the Bearer token.
- Tool execution runs synchronously within the HTTP request; the 60-second timeout applied to the chat assistant applies here too.
- The MCP endpoint is public-facing (behind the application's existing TLS termination).

## Backend Scope (Laravel)

- Models:
  - No new models. Sanctum's `PersonalAccessToken` is used as-is.

- Migrations:
  - None.

- Controllers / APIs:
  - `McpController` (new)
    - `POST /mcp` — handles all MCP JSON-RPC messages.
    - `GET /mcp` — returns HTTP 405 (SSE not implemented in MVP).
  - `ApiTokenController` (new)
    - `GET /api/v1/user/api-tokens` — list the authenticated user's tokens (id, name, abilities, last_used_at, created_at). Token plaintext is never returned after creation.
    - `POST /api/v1/user/api-tokens` — create a new token; returns the plaintext token once.
    - `DELETE /api/v1/user/api-tokens/{tokenId}` — revoke a token.

- Services:
  - `McpRequestHandler` (new)
    - Dispatches incoming JSON-RPC method calls:
      - `initialize` → returns server capabilities and protocol version.
      - `notifications/initialized` → returns 202 Accepted, no body.
      - `tools/list` → returns all tools from `AiToolRegistry` formatted as MCP tool definitions.
      - `tools/call` → resolves tool from registry, executes with authenticated user, returns MCP content response.
      - Unknown method → returns JSON-RPC error `-32601` (Method not found).
    - All tool execution errors are returned as MCP tool results with `isError: true`, not as JSON-RPC protocol errors (per MCP spec).

- Contracts:
  - `AiTool` interface provides `getInputSchema()` which maps directly to MCP's `inputSchema` field. No additional contract needed.

- Policies / Auth:
  - `McpController` uses `auth:sanctum` middleware.
  - Token ability `mcp` is checked via `$request->user()->tokenCan('mcp')`.
  - Requests without a valid token or without the `mcp` ability receive HTTP 401.
  - `ApiTokenController` uses `auth:sanctum` + `verified`.

- Events / Notifications:
  - None.

## Frontend Scope (Vue + Bootstrap)

- Pages / Routes:
  - New tab in the existing user settings page: **API Tokens**.

- Components:
  - `ApiTokenManager.vue` (new)
    - Lists existing tokens: name, abilities, last used, created date, revoke button.
    - "Create token" form: name field (required) + submit button.
    - After creation: displays the token plaintext in a one-time alert with a copy button. Instructs the user to copy it now — it will not be shown again.
    - Revoke confirmation: inline confirmation before DELETE.

- State management:
  - Component-local state only; no store.

- API interactions:
  - `GET /api/v1/user/api-tokens`
  - `POST /api/v1/user/api-tokens`
  - `DELETE /api/v1/user/api-tokens/{id}`

- UX / validation rules:
  - Token name: required, max 100 characters.
  - After revocation: token removed from list immediately; no page reload needed.
  - Copy button uses the Clipboard API; shows confirmation ("Copied!") for 2 seconds.

## Data & API Design

### MCP Endpoint

`POST /mcp`

All requests follow JSON-RPC 2.0. Examples:

**initialize:**
```json
// Request
{ "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "2025-03-26", "capabilities": {},
              "clientInfo": { "name": "Claude Desktop", "version": "1.0" } } }

// Response
{ "jsonrpc": "2.0", "id": 1,
  "result": { "protocolVersion": "2025-03-26",
              "capabilities": { "tools": {} },
              "serverInfo": { "name": "yaffa", "version": "3.0" } } }
```

**tools/list:**
```json
// Response
{ "jsonrpc": "2.0", "id": 2,
  "result": {
    "tools": [
      { "name": "list_investments",
        "description": "...",
        "inputSchema": { "type": "object", "properties": { "active_only": { "type": "boolean" } } } }
    ]
  }
}
```

**tools/call:**
```json
// Request
{ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": { "name": "list_investments", "arguments": { "active_only": true } } }

// Success response
{ "jsonrpc": "2.0", "id": 3,
  "result": { "content": [{ "type": "text", "text": "[{\"id\":1,\"name\":\"ISAC\"}]" }],
              "isError": false } }

// Tool execution error response (per MCP spec — NOT a JSON-RPC error)
{ "jsonrpc": "2.0", "id": 3,
  "result": { "content": [{ "type": "text", "text": "Investment not found." }],
              "isError": true } }
```

### Token API

`POST /api/v1/user/api-tokens`

Request: `{ "name": "Claude Desktop" }`

Response (201):
```json
{ "token": "1|plaintext-only-shown-once", "name": "Claude Desktop", "id": 1 }
```

`GET /api/v1/user/api-tokens` response:
```json
{
  "data": [
    { "id": 1, "name": "Claude Desktop", "abilities": ["mcp"],
      "last_used_at": "2026-04-12T10:00:00Z", "created_at": "2026-04-10T08:00:00Z" }
  ]
}
```

### Client Configuration Example (Claude Desktop)

```json
{
  "mcpServers": {
    "yaffa": {
      "type": "http",
      "url": "https://your-yaffa-instance.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## Processing Flow

1. External MCP client sends `POST /mcp` with `Authorization: Bearer <token>`.
2. `auth:sanctum` middleware validates the token and resolves the user.
3. `McpController` verifies the `mcp` token ability; returns 401 if missing.
4. `McpController` passes the JSON-RPC payload to `McpRequestHandler`.
5. `McpRequestHandler` dispatches by method name.
6. For `tools/call`: resolves the tool from `AiToolRegistry`, calls `execute($params, $user)`.
7. Tool result is JSON-encoded and returned as an MCP text content block.
8. Controller returns the JSON-RPC response with `Content-Type: application/json`.

## Security Considerations

- Token plaintext is returned once at creation and never stored in plaintext (Sanctum hashes it).
- Token revocation is immediate; any in-flight request with a revoked token returns 401 after the middleware check.
- The `mcp` ability is the only ability granted to MCP tokens — they cannot access non-MCP endpoints through ability checks.
- All tool `execute()` calls are scoped to the token's owner; cross-user access is not possible.
- The `Origin` header is not applicable for server-to-server token-based requests, but the endpoint must not be accessible without authentication.
- Input validation: `tools/call` arguments are validated against each tool's `getInputSchema()` before execution.

## Test Strategy

- Backend unit tests:
  - `McpRequestHandler`: each supported method returns the correct JSON-RPC structure.
  - `McpRequestHandler`: unknown method returns error `-32601`.
  - `McpRequestHandler`: tool execution error returns `isError: true` in result, not a JSON-RPC error.
  - `ApiTokenController`: create token returns plaintext once.
  - `ApiTokenController`: list tokens does not include plaintext.
  - `ApiTokenController`: revoke removes the token.
- Backend feature tests:
  - `POST /mcp` without token → 401.
  - `POST /mcp` with valid token, `initialize` → correct capabilities.
  - `POST /mcp` with valid token, `tools/call list_investments` → returns user's investments.
  - `POST /mcp` with token missing `mcp` ability → 401.
  - `DELETE /api/v1/user/api-tokens/{id}` for another user's token → 403.
- Edge cases:
  - Malformed JSON body → JSON-RPC error `-32700` (Parse error).
  - `tools/call` with unknown tool name → JSON-RPC error `-32602` (Invalid params).
  - `tools/call` with invalid arguments (fails schema validation) → `isError: true` in result.

## Acceptance Criteria

- Given a user creates an MCP token in the settings UI, when they paste the token into Claude Desktop and send "list my investments", then Claude Desktop calls `tools/list` followed by `tools/call list_investments` and returns the user's investment list.
- Given the token plaintext is shown after creation, when the user navigates away and returns, then the plaintext is no longer visible — only the token name and metadata.
- Given a user revokes a token, when an MCP client makes a subsequent request with that token, then the server returns HTTP 401.
- Given an MCP client calls `tools/call` with an unknown tool name, then the server returns a valid JSON-RPC error response with code `-32602`.
- Given an MCP client calls `GET /mcp`, then the server returns HTTP 405.
- Given the `mcp` ability is not present on the token, then `POST /mcp` returns HTTP 401 regardless of whether the token is otherwise valid.
