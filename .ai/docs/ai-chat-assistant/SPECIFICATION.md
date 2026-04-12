# AI Chat Assistant

## Feature Summary

Introduce an AI-powered chat assistant embedded in the yaffa UI as a floating widget. The assistant can answer questions about the user's portfolio, create investments and transactions from natural language, and process uploaded files (screenshots, CSV files) to extract and import financial data.

The assistant operates as an agentic loop: it receives a user message, decides which internal tools to invoke, executes them against existing yaffa services, and returns a natural language response along with a summary of actions taken.

The assistant is opt-in and only active when the user has an AI provider configured. It reuses the existing `AiProviderConfig` model and Prism library already present in the application.

## Goals / Non-Goals

- Goals:
  - Natural language queries against the user's portfolio ("what's my current ROI on ISAC?").
  - Natural language write operations ("add a buy transaction: 5 ISAC.MI at 94.50 EUR on 2026-04-10").
  - Screenshot upload: AI reads a brokerage screenshot and proposes or creates the corresponding investment or transaction.
  - CSV upload: backend parses the file and injects the rows into the assistant context; AI maps them to yaffa entities and creates transactions.
  - Multi-turn conversation within a single browser session (history kept in frontend state).
  - Reuse existing `AiProviderConfig` (provider, model, api_key) — no new AI config UI needed.
  - Tool catalog shared with the MCP server feature.

- Non-Goals:
  - Persisting conversation history in the database.
  - Streaming responses (polling on first iteration; SSE can be added later).
  - Autonomous background actions without user prompt.
  - Modifying or replacing the existing AI document processing pipeline.
  - Cost tracking or per-user token budgets.
  - Multi-user or admin-level tool access.
  - Sharing tool class implementations with the MCP server. Both features delegate to the same service layer, but the MCP server uses `laravel/mcp` Tool classes while the chat assistant uses the `AiTool` interface backed by Prism. The shared layer is the service layer, not the tool wrappers.

## Assumptions

- The user must have at least one `AiProviderConfig` record; the assistant is hidden otherwise.
- All write operations performed by the assistant go through the same service layer as the regular UI — no direct DB writes.
- File uploads in chat are temporary (not persisted); image bytes are passed directly to the model as vision content.
- CSV files in chat are parsed server-side into structured rows and injected as text context, not routed through the AI document processing pipeline.
- The agentic loop runs synchronously within a single HTTP request; a timeout of 60 seconds is enforced.
- The assistant respects existing ownership and authorization boundaries — it can only access the authenticated user's data.
- Prism tool calling is available for all targeted providers (OpenAI, Anthropic). Providers that do not support tool calling return a graceful error.

## Backend Scope (Laravel)

- Models:
  - No new models. `AiProviderConfig` and `AiUserSettings` are reused as-is.

- Migrations:
  - None.

- Controllers / APIs:
  - `AiChatApiController` (new)
    - `POST /api/v1/chat` — receives message, history, and optional attachments; returns assistant reply and action log.

- Services:
  - `AiToolRegistry` (new)
    - Central registry for all available tools.
    - Tools are registered at boot via a service provider.
    - Exposes tools to Prism (for the chat assistant) and to the MCP server.
  - `AiChatService` (new)
    - Resolves the user's `AiProviderConfig`.
    - Builds the Prism request: system prompt, tool list, message history, attachments.
    - Runs the agentic loop until the model produces a final text response.
    - Returns the assistant reply and a structured log of tool calls executed.
  - `AiChatAttachmentProcessor` (new)
    - Image (jpg/png/pdf): converts to `ImagePart` for Prism vision input.
    - CSV: parses with PHP and returns structured rows as a text block injected into the user message.

- Tool classes (new, each implements `AiTool` interface):
  - `ListInvestmentsTool`
  - `GetInvestmentDetailsTool`
  - `ListTransactionsTool`
  - `CreateInvestmentTransactionTool`
  - `CreateStandardTransactionTool`
  - `ListAccountsTool`
  - `GetAccountBalanceTool`
  - `ListPayeesTool`
  - `ListCategoriesTool`
  - `GetCashflowReportTool`

- Contracts:
  - `AiTool` interface (new):
    - `getName(): string`
    - `getDescription(): string`
    - `getInputSchema(): array` (JSON Schema for parameters)
    - `execute(array $params, User $user): mixed`

- Form Requests:
  - `AiChatRequest` (new) — validates message, history structure, and attachment mime types/sizes.

- Policies / Auth:
  - `auth:sanctum` + `verified` middleware on the chat endpoint, identical to other API controllers.
  - Each tool's `execute()` method scopes queries to the authenticated user; no additional policy class needed.

- Events / Notifications:
  - None.

## Frontend Scope (Vue + Bootstrap)

- Components:
  - `AiChatWidget.vue` (new, global)
    - Floating action button, bottom-right corner.
    - Expandable chat panel (Bootstrap offcanvas or card).
    - Message thread: user messages, assistant replies, tool call summary cards.
    - Text input with send button.
    - File attach button: accepts image/* and text/csv.
    - Shows a spinner during request; disables input until response arrives.
    - Hidden entirely when `:userHasAiConfig` prop is `false`.

- Pages / Routes:
  - No new pages. Widget is mounted once in the global layout blade template.

- State management:
  - Conversation history kept in component-local `ref([])` — no Pinia/Vuex store.

- API interactions:
  - `POST /api/v1/chat` with `multipart/form-data` (message + history JSON + optional file).

- UX / validation rules:
  - Message input: required, max 2000 characters.
  - File: max size driven by `AI_DOCUMENT_MAX_FILE_SIZE_MB` env var (reuse existing).
  - Tool call cards show action type and summary (e.g., "Created transaction #42 — 5× ISAC.MI at 94.50 EUR").
  - If assistant response contains `isError: true`, display error state in the thread.

## Data & API Design

- Entities involved:
  - `AiProviderConfig` (read-only by chat)
  - `Investment`, `Transaction`, `AccountEntity`, `Payee`, `Category` (via tool calls)

- Endpoint:

  `POST /api/v1/chat`

  Request (multipart/form-data):
  ```
  message:     string (required)
  history:     JSON string, array of {role, content} objects (optional)
  attachment:  file (optional, image/* or text/csv)
  ```

  Response (application/json):
  ```json
  {
    "reply": "I've recorded the transaction. 5 units of ISAC.MI bought at 94.50 EUR on 2026-04-10.",
    "actions": [
      {
        "tool": "create_investment_transaction",
        "summary": "Created transaction #42 — 5× ISAC.MI at 94.50 EUR",
        "record_id": 42
      }
    ]
  }
  ```

  Error response (422 / 503):
  ```json
  {
    "error": {
      "code": "AI_PROVIDER_UNAVAILABLE",
      "message": "The configured AI provider returned an error."
    }
  }
  ```

## Tool Descriptions (authoritative)

Tool descriptions are the primary mechanism by which the model selects the correct action. They must be specific and actionable.

| Tool | Description excerpt |
|---|---|
| `list_investments` | "List all investment assets (stocks, ETFs, funds) for the user. Call this first when the user mentions an investment by name or symbol, to resolve its ID before creating a transaction." |
| `create_investment_transaction` | "Record a buy, sell, dividend, add_shares, or remove_shares transaction for an investment. Requires investment_id from list_investments. Do not guess IDs." |
| `list_accounts` | "List all accounts. Call this when a target account is needed for a transaction and the user has not specified an account ID." |
| `get_account_balance` | "Return the current balance for all accounts or a specific account. Use this to answer questions about available funds." |
| `get_cashflow_report` | "Return aggregated income and expense data. Use this to answer questions about spending, income trends, or monthly summaries." |

## Write Tool Idempotency

Write tools (`CreateInvestmentTransactionTool`, `CreateStandardTransactionTool`) are not idempotent. If the LLM retries a tool call after a timeout or ambiguous result, duplicate records may be created. Mitigation:

- The tool returns the created record ID in its result. The model should confirm with the user before retrying after a failure.
- The system prompt instructs the model to call the corresponding read tool to verify outcome before retrying a write.
- Duplicate detection is not the chat assistant's responsibility; it relies on the existing duplicate detection logic available through the service layer.

## Processing Flow

1. User opens the chat widget (visible only if AI is configured).
2. User types a message and optionally attaches a file.
3. Frontend sends `POST /api/v1/chat` with message, history, and attachment.
4. `AiChatRequest` validates the payload.
5. `AiChatService` resolves the user's `AiProviderConfig`; returns 503 if none found.
6. `AiChatAttachmentProcessor` processes the attachment if present.
7. `AiChatService` builds the Prism request with system prompt, tool list, and message history.
8. Prism executes the agentic loop:
   a. Sends request to the configured provider/model.
   b. If the model returns a tool call, `AiChatService` dispatches to `AiToolRegistry`.
   c. Tool result is appended to the message chain and the loop repeats.
   d. Loop terminates when the model returns a plain text response or the iteration limit (10) is reached.
9. `AiChatService` returns the final reply and action log to the controller.
10. Controller returns JSON response.
11. Frontend appends the assistant reply and tool call cards to the thread.

## Security Considerations

- All tool `execute()` calls are scoped to `$user` — no cross-user data access is possible.
- File attachments are processed in memory and never written to disk or storage.
- The system prompt must not expose internal IDs or sensitive configuration values.
- The chat endpoint is protected by `auth:sanctum` + `verified`; unauthenticated requests receive 401.
- The agentic loop iteration limit (10) prevents runaway tool call chains.
- Attachment file type is validated server-side by MIME type, not by extension.

## Test Strategy

- Backend unit tests:
  - Each `AiTool`: valid params → expected service call → expected return shape.
  - Each `AiTool`: missing required params → validation error.
  - `AiChatAttachmentProcessor`: CSV parsing produces correct structured rows.
  - `AiToolRegistry`: tool registration and resolution.
- Backend feature tests:
  - `POST /api/v1/chat` with no AI config → 503.
  - `POST /api/v1/chat` with valid message → mocked Prism → correct response shape.
  - `POST /api/v1/chat` with oversized attachment → 422.
  - Unauthenticated request → 401.
- Frontend tests:
  - Widget hidden when `userHasAiConfig` is false.
  - Message sent on Enter key or button click.
  - Tool call card rendered when `actions` array is non-empty.
- Edge cases:
  - Provider returns tool call loop with no termination → iteration limit kicks in.
  - Provider does not support tool calling → graceful error message in thread.
  - CSV with malformed rows → partial parse, rows with errors are skipped and reported.

## Acceptance Criteria

- Given a user with an AI provider configured, when they open the chat widget and ask "what investments do I have?", then the assistant returns a list of the user's investments by calling `list_investments`.
- Given a user types "buy 5 ISAC.MI at 94.50 EUR today", then the assistant calls `list_investments` to resolve the ID, optionally `list_accounts` if no account context exists, then calls `create_investment_transaction`, and confirms the created record ID in its reply.
- Given a user attaches a CSV file with investment transactions, then the assistant parses the rows and proposes or creates the transactions, confirming each created record.
- Given a user attaches a brokerage screenshot, then the assistant reads the image and extracts the relevant transaction data before calling the appropriate tool.
- Given no AI provider is configured, then the chat widget is not visible.
- Given the AI provider is unavailable, then the assistant returns a human-readable error without crashing the page.
- Given a tool call targets another user's data, then the request is rejected and the assistant reports that the resource was not found.
