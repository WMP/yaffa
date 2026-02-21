# CSV Import Extension Plan (Minimal Invasive + Powerful Rules)

## 1. Context and Goal

Current CSV import in YAFFA works, but is hardcoded for one parser setup and one rule file.
The goal is to extend it without rewriting the whole flow:

- keep current parser + engine approach (`jquery-csv` + `json-rules-engine`)
- keep existing transaction draft and "quick create" behavior
- add flexible CSV settings (auto-detect + manual override)
- add reusable import profiles
- add stronger mapping/rule capabilities (regex, dictionaries, multi-field conditions)
- improve UX visibility (show sections only when data exists)

This document defines a staged implementation plan.

## 2. Non-Goals (for first implementation)

- Full rewrite to a new frontend framework for import
- Replacing DataTables rendering in import result
- Executing arbitrary JavaScript from DB-stored rules
- Immediate support for every possible bank format in one release

## 3. Current State Summary

Current route and controller:

- `routes/web.php`: `GET /import/csv` (`import.csv`)
- `app/Http/Controllers/ImportController.php`: injects payees into JS

Current frontend flow:

- `resources/views/import/csv.blade.php`: account selector + file + identified table + unmatched rows
- `resources/js/import/csv.js`:
  - reads file via `FileReader`
  - parses CSV with fixed separator `;`
  - processes each row through hardcoded rule engine import
  - creates draft transactions shown in DataTable
  - pushes unmatched rows to unmatched table

Current rules:

- `resources/js/import/rules/hun_raiffeisen_v1.js`
- one rule file, hardcoded import in `csv.js`

## 4. Target Architecture (Minimal Invasive)

Do not replace existing flow. Generalize it.

### 4.1 Keep

- current import page route
- existing results table and quick action flow
- `json-rules-engine` as primary mapping/rule executor

### 4.2 Add

- profile selection on top of current flow
- parser options layer (auto-detect + manual)
- profile persistence in backend
- safe rule DSL persisted as JSON
- conditional visibility for sections in UI

## 5. Data Model

Create a new table, example: `import_profiles`.

Suggested columns:

- `id`
- `user_id` (FK)
- `name` (user-defined profile name)
- `source_name_pattern` (optional filename hint regex)
- `is_default` (boolean)
- `csv_options` (json)
- `column_mapping` (json)
- `value_mappings` (json)
- `rules` (json)
- `created_at`, `updated_at`

### 5.1 JSON fields shape

`csv_options` example:

```json
{
  "delimiter": ";",
  "encoding": "utf-8",
  "quote": "\"",
  "escape": "\\\\",
  "header_row_index": 0,
  "date_formats": ["YYYY-MM-DD", "DD.MM.YYYY", "M/D/YYYY"],
  "decimal_separator": ",",
  "thousands_separator": " "
}
```

`column_mapping` example:

```json
{
  "date": "Data operacji",
  "type": "Typ",
  "amount": "Kwota",
  "counterparty": "Odbiorca/Nadawca",
  "description": "Tytul",
  "currency": "Waluta"
}
```

`value_mappings` example:

```json
{
  "type": {
    "PRZELEW": "transfer",
    "UZNANIE": "deposit",
    "PLATNOSC KARTA": "withdrawal"
  }
}
```

`rules` example (safe DSL, no arbitrary code):

```json
[
  {
    "id": "salary_detect",
    "when": {
      "all": [
        { "field": "type", "op": "equals", "value": "deposit" },
        { "field": "description", "op": "regex", "value": "(?i)ASSECO|IEXPERT|UBESTREFA" }
      ]
    },
    "actions": [
      { "set": "payee_name", "value": "Wyplata" },
      { "set": "category_name", "value": "Wyplata" }
    ]
  }
]
```

## 6. Backend API Plan

Add dedicated endpoints under authenticated API:

- `GET /api/import/csv/profiles`
- `GET /api/import/csv/profiles/{id}`
- `POST /api/import/csv/profiles`
- `PATCH /api/import/csv/profiles/{id}`
- `DELETE /api/import/csv/profiles/{id}`

Optional utility endpoint:

- `POST /api/import/csv/detect` for server-side delimiter/encoding detection if needed later

Validation rules:

- profile belongs to authenticated user
- JSON shape checks for `csv_options`, `column_mapping`, `rules`
- deny dangerous regex flags/pattern lengths if needed

## 7. Frontend UX Plan

### 7.1 Initial page state

Show only:

- target account selector
- optional profile selector
- CSV file input
- optional "advanced parser settings" collapsed panel

### 7.2 After file load + parse

Show "Identified transactions" section only when count > 0.
Show "Unmatched rows" section only when count > 0.
If no rows parsed, show explicit warning card.

### 7.3 Profile interactions

- select profile before file parse
- apply profile settings automatically
- allow "Save current config as new profile"
- allow "Update profile" and "Save as copy"

## 8. Parser Options Strategy

### 8.1 Auto-detection

Implement lightweight heuristic on first N lines:

- test delimiters: `;`, `,`, tab, `|`
- score consistency by column count per line
- pick highest score

If confidence low:

- show detected value + warning
- let user override manually

### 8.2 Manual overrides

Expose controls:

- delimiter
- encoding (start with utf-8, windows-1250, iso-8859-2)
- header row index
- decimal separator
- date format for mapped date field

## 9. Rules and Mapping Engine Plan

### 9.1 Keep existing hardcoded rule path as fallback

If no profile selected:

- run current legacy engine (`hun_raiffeisen_v1.js`) unchanged

### 9.2 Introduce profile-driven pipeline

For profile mode:

1. parse CSV with `csv_options`
2. normalize columns using `column_mapping`
3. apply `value_mappings` dictionary conversions
4. execute rule DSL (regex/conditions/actions)
5. produce `rawTransaction` object shape compatible with current table/actions

### 9.3 Supported condition operators (first batch)

- `equals`
- `not_equals`
- `contains`
- `regex`
- `in`
- `gt`, `lt`, `gte`, `lte` (for numeric fields)
- logical groups: `all`, `any`

### 9.4 Supported actions (first batch)

- `set` fixed value
- `set_from_field`
- `regex_extract` (group extraction)
- `map_lookup` (dictionary translation)
- `append_comment`

## 10. Security and Stability

- No direct eval/new Function for user rules
- Limit regex pattern length and per-row execution time if possible
- Cap number of processed rows per import session (configurable)
- Add try/catch with row-level error collection
- Keep unmatched/error rows visible for diagnosis

## 11. Performance Plan

- Parse and transform row-by-row in memory (same as now)
- Avoid re-render per row, batch update after processing
- For large CSV:
  - progressive progress indicator
  - optional chunk processing (future phase)

## 12. Migration and Backward Compatibility

- Existing hardcoded import behavior remains default
- New profile mode opt-in
- Legacy users can continue without setting profiles
- No database impact on existing transaction models

## 13. Implementation Phases

## Phase 1 - Foundation (minimal risk)

- add `import_profiles` migration + model + policy
- add profile CRUD API
- add profile selector UI (no rules execution yet)
- add section visibility toggles (identified/unmatched only when data exists)

Deliverable:

- import page with profile selection and clean conditional sections

## Phase 2 - Parser settings + auto-detect

- add delimiter detection helper
- add manual parser settings UI
- wire parser settings into current `$.csv.toObjects`
- allow storing settings in profile

Deliverable:

- robust parsing for different CSV dialects without hardcoded `;`

## Phase 3 - Profile-driven mapping/rules

- implement mapping transform layer
- implement value dictionary layer
- implement rule DSL executor
- produce current `rawTransaction` shape

Deliverable:

- reusable import profiles with regex and conditional logic

## Phase 4 - Quality hardening

- tests (unit + feature + UI smoke)
- better error reporting for invalid rows/rules
- profile export/import JSON

Deliverable:

- production-ready import extension

## 14. Testing Plan

Unit tests:

- delimiter detection heuristics
- mapping normalization
- DSL condition evaluation
- DSL action execution

Feature tests (Laravel):

- profile CRUD authorization and validation
- profile ownership isolation

UI/integration tests:

- upload + parse with default flow
- upload + parse with selected profile
- unmatched visibility behavior
- identified visibility behavior

## 15. Open Decisions

- Should rules be stored per user only, or shareable across users?
- Should profile selection be remembered per account?
- Should encoding detection be client-side only, or fallback to backend endpoint?
- Which max CSV size/row count should be enforced?

## 16. Recommended First PR Scope

To move fast with low risk, first PR should include only:

- profile DB + API CRUD
- profile selector in import page
- conditional rendering for identified/unmatched sections
- parser setting object wired in JS (even if only delimiter initially)

Then immediately start PR2 with auto-detect + full mapping/rule DSL.

