/**
 * This functionality allows the user to open a CSV file and parse it to an array of objects.
 * The array is then interpreted using a selected DSL import profile.
 */

import 'datatables.net-bs5';
// Import dataTable helper functions
import * as dataTableHelpers from './../components/dataTableHelper';
import { toFormattedCurrency, toIsoDateString } from '../helpers';

// Import RRule library for handling schedules
import { RRule } from 'rrule';
import 'select2';
import 'jquery-csv';

window.transactions = [];
window.account_currency = {};
window.unmatchedRows = [];
window.schedules = [];
window.csvParsedRows = [];
window.csvSampleRows = [];
window.csvHeaders = [];
window.dslPreviewMatchedRows = [];
window.dslPreviewUnmatchedEntries = [];
window.dslPreviewPromptUnmatchedRows = [];
window.dslPreviewPromptUnmatchedIndexes = [];
window.dslPreviewPromptStrictValueKeys = [];
window.dslPreviewIssueRows = {};
window.dslPreviewSelectedRows = {};
window.dslPreviewFilters = {
  include: {},
  exclude: {},
};
window.csvDraftsReady = false;
window.dslBulkImportInProgress = false;
const identifiedTransactionsSectionSelector =
  '#identified-transactions-section';
const dslPreviewMatchedSectionSelector = '#dsl-preview-matched-section';
const unmatchedRowsSectionSelector = '#unmatched-rows-section';
const aiAssistantSectionSelector = '#ai-dsl-assistant-section';
const addNewProfileOptionId = '__add_new_profile__';
const aiPromptSampleRowsCount = 3;
const aiPromptExtraUnmatchedRowsCount = 3;
const dslStatusYaffaFields = [
  'date',
  'amount',
  'description',
  'type',
  'from',
  'to',
];
const aiDslAllowedKeys = [
  'csv_options',
  'column_mapping',
  'value_mappings',
  'rules',
];
const dslTransactionTypes = {
  withdrawal: {
    id: 1,
    name: 'withdrawal',
    amount_multiplier: -1,
  },
  deposit: {
    id: 2,
    name: 'deposit',
    amount_multiplier: 1,
  },
  transfer: {
    id: 3,
    name: 'transfer',
    amount_multiplier: null,
  },
};
let selectedImportProfile = null;
window.dslStatusState = {
  mapping: {},
  strictFields: [],
  matchedRows: null,
  totalRows: 0,
  unmatchedRows: null,
};
window.csvImportSummary = {
  totalRows: 0,
  acceptedRows: 0,
  unmatchedRows: 0,
};

function getDslStatusDisplayValue(rawValue) {
  const value = String(rawValue ?? '').trim();
  return value.length > 0 ? value : 'n/a';
}

function getDslStatusMappingFromPayload(dslPayload) {
  const mapping = {};
  dslStatusYaffaFields.forEach((yaffaField) => {
    mapping[yaffaField] = String(
      dslPayload?.column_mapping?.[yaffaField] ?? '',
    ).trim();
  });
  return mapping;
}

function renderDslStatusTable() {
  const tableBody = document.getElementById('dsl_status_table_body');
  if (!tableBody) {
    return;
  }

  const mappingSummary = dslStatusYaffaFields
    .map((yaffaField) => {
      const mappedCsvField = getDslStatusDisplayValue(
        window.dslStatusState.mapping?.[yaffaField] ?? '',
      );
      return yaffaField + ' -> ' + mappedCsvField;
    })
    .join(', ');

  const strictFieldsSummary = Array.isArray(window.dslStatusState.strictFields)
    ? window.dslStatusState.strictFields
        .map((strictField) => String(strictField).trim())
        .filter((strictField) => strictField.length > 0)
        .join(', ')
    : '';

  const matchedRowsValue =
    window.dslStatusState.matchedRows === null
      ? 'n/a'
      : String(window.dslStatusState.matchedRows);
  const totalRowsValue = Number.isFinite(window.dslStatusState.totalRows)
    ? String(window.dslStatusState.totalRows)
    : '0';
  const unmatchedRowsValue =
    window.dslStatusState.unmatchedRows === null
      ? 'n/a'
      : String(window.dslStatusState.unmatchedRows);

  const rows = [
    ['YAFFA <-> CSV mapping', mappingSummary],
    ['Strict fields detected', getDslStatusDisplayValue(strictFieldsSummary)],
    ['Matched rows', matchedRowsValue],
    ['All rows', totalRowsValue],
    ['Unmatched rows', unmatchedRowsValue],
  ];

  tableBody.innerHTML = '';
  rows.forEach(([label, value]) => {
    const row = document.createElement('tr');
    const labelCell = document.createElement('th');
    labelCell.scope = 'row';
    labelCell.textContent = label;
    const valueCell = document.createElement('td');
    valueCell.textContent = value;
    row.appendChild(labelCell);
    row.appendChild(valueCell);
    tableBody.appendChild(row);
  });
}

function resetDslStatusState(totalRows = 0) {
  const normalizedTotalRows = Number(totalRows);
  window.dslStatusState = {
    mapping: {},
    strictFields: [],
    matchedRows: null,
    totalRows:
      Number.isFinite(normalizedTotalRows) && normalizedTotalRows > 0
        ? normalizedTotalRows
        : 0,
    unmatchedRows: null,
  };
  renderDslStatusTable();
}

function updateDslStatusStateFromPreview(dslPayload, previewResult) {
  window.dslStatusState = {
    mapping: getDslStatusMappingFromPayload(dslPayload),
    strictFields: Array.isArray(previewResult?.strictColumns)
      ? previewResult.strictColumns
      : [],
    matchedRows: Array.isArray(previewResult?.matchedRows)
      ? previewResult.matchedRows.length
      : null,
    totalRows: Number.isFinite(previewResult?.totalRows)
      ? previewResult.totalRows
      : 0,
    unmatchedRows: Array.isArray(previewResult?.unmatchedRows)
      ? previewResult.unmatchedRows.length
      : null,
  };
  renderDslStatusTable();
}

// The following variable is used to store the current transaction being created.
let recentTransactionDraftId;

function setSectionVisibility(sectionSelector, isVisible) {
  const section = $(sectionSelector);
  if (isVisible) {
    section.removeClass('d-none');
  } else {
    section.addClass('d-none');
  }
}

function clearUnmatchedRowsTable() {
  document.getElementById('unmatched_table_head').innerHTML = '';
  document.getElementById('unmatched_table_body').innerHTML = '';
}

function clearDslPreviewMatchedRowsTable() {
  document.getElementById('dsl_preview_matched_table_head').innerHTML = '';
  document.getElementById('dsl_preview_matched_table_body').innerHTML = '';
  updateDslPreviewSelectionSummary();
}

function showImportErrorNotification(message) {
  const notificationEvent = new CustomEvent('notification', {
    detail: {
      notification: {
        type: 'error',
        message: message,
        title: null,
        icon: null,
        dismissible: true,
      },
    },
  });
  window.dispatchEvent(notificationEvent);
}

function setAiDslStatus(message, tone = 'muted') {
  const statusElement = document.getElementById('ai_dsl_status');
  if (!statusElement) {
    return;
  }

  statusElement.className = 'form-text';
  switch (tone) {
    case 'success':
      statusElement.classList.add('text-success');
      break;
    case 'danger':
      statusElement.classList.add('text-danger');
      break;
    case 'warning':
      statusElement.classList.add('text-warning');
      break;
    default:
      statusElement.classList.add('text-muted');
      break;
  }
  statusElement.textContent = message;
}

function getQuickImportableDraftIds() {
  return (window.transactions || [])
    .filter((transaction) => transaction.quickRecordingPossible)
    .filter((transaction) => !transaction.handled)
    .map((transaction) => Number(transaction.draftId))
    .filter((draftId) => Number.isFinite(draftId));
}

function updateQuickImportButtonState() {
  const importButton = document.getElementById('import_all_quick_transactions');
  if (!importButton) {
    return;
  }

  const importableCount = getQuickImportableDraftIds().length;
  importButton.textContent =
    'Import all accepted transactions' +
    (importableCount > 0 ? ' (' + importableCount + ')' : '');
  importButton.disabled =
    window.dslBulkImportInProgress ||
    !window.csvDraftsReady ||
    importableCount === 0;
}

function updateCsvImportSummary(totalRows, acceptedRows, unmatchedRows) {
  window.csvImportSummary = {
    totalRows: Number(totalRows) || 0,
    acceptedRows: Number(acceptedRows) || 0,
    unmatchedRows: Number(unmatchedRows) || 0,
  };

  const summaryElement = document.getElementById('import_parse_summary');
  if (!summaryElement) {
    return;
  }

  summaryElement.textContent =
    'Accepted: ' +
    window.csvImportSummary.acceptedRows +
    ' / Total: ' +
    window.csvImportSummary.totalRows +
    ' / Unmatched: ' +
    window.csvImportSummary.unmatchedRows;
}

function isDslPreviewRowSelected(rowIndex) {
  const key = String(rowIndex);
  return window.dslPreviewSelectedRows[key] !== false;
}

function setDslPreviewRowSelected(rowIndex, isSelected) {
  const key = String(rowIndex);
  window.dslPreviewSelectedRows[key] = isSelected !== false;
}

function syncDslPreviewSelectionWithMatchedRows(matchedRows) {
  const nextSelection = {};
  (matchedRows || []).forEach((entry) => {
    const key = String(entry.index);
    if (
      Object.prototype.hasOwnProperty.call(window.dslPreviewSelectedRows, key)
    ) {
      nextSelection[key] = window.dslPreviewSelectedRows[key] !== false;
    } else {
      nextSelection[key] = true;
    }
  });
  window.dslPreviewSelectedRows = nextSelection;
}

function getSelectedDslPreviewMatchedRows() {
  return (window.dslPreviewMatchedRows || []).filter((entry) =>
    isDslPreviewRowSelected(entry.index),
  );
}

function getVisibleDslPreviewRowIndexes() {
  return Array.from(
    document.querySelectorAll(
      '#dsl_preview_matched_table .dsl-preview-select-row',
    ),
  )
    .map((inputElement) => Number(inputElement.dataset.rowIndex))
    .filter((rowIndex) => Number.isFinite(rowIndex));
}

function updateDslPreviewSelectionSummary() {
  const summaryElement = document.getElementById(
    'dsl_preview_selection_status',
  );
  if (!summaryElement) {
    return;
  }

  const matchedRows = window.dslPreviewMatchedRows || [];
  const selectedCount = getSelectedDslPreviewMatchedRows().length;
  summaryElement.textContent =
    'Selected: ' + selectedCount + ' / Matched: ' + matchedRows.length;

  const importButton = document.getElementById('ai_import_matched_dsl');
  if (importButton) {
    importButton.disabled =
      window.dslBulkImportInProgress ||
      !window.csvDraftsReady ||
      selectedCount === 0 ||
      matchedRows.length === 0;
  }
  updateQuickImportButtonState();

  const selectAllCheckbox = document.getElementById('dsl_preview_select_all');
  if (!selectAllCheckbox) {
    return;
  }

  const visibleRowIndexes = getVisibleDslPreviewRowIndexes();
  if (visibleRowIndexes.length === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    return;
  }

  const visibleSelectedCount = visibleRowIndexes.filter((rowIndex) =>
    isDslPreviewRowSelected(rowIndex),
  ).length;
  selectAllCheckbox.checked = visibleSelectedCount === visibleRowIndexes.length;
  selectAllCheckbox.indeterminate =
    visibleSelectedCount > 0 && visibleSelectedCount < visibleRowIndexes.length;
}

function buildAiDslPrompt(csvRows, additionalRows = [], flaggedIssueRows = []) {
  const sampleRows = csvRows.slice(0, aiPromptSampleRowsCount);
  const headers = Object.keys(sampleRows[0] ?? {});
  const sampleJson = JSON.stringify(sampleRows, null, 2);
  const additionalJson = JSON.stringify(additionalRows, null, 2);
  const flaggedIssuesJson = JSON.stringify(flaggedIssueRows, null, 2);

  return [
    'You are helping me configure YAFFA CSV import rules.',
    '',
    'Output format is mandatory:',
    '- Return ONLY one fenced code block with language tag json.',
    '- Do not return any text before or after the code block.',
    '- The content of the code block must be valid strict JSON parseable by JSON.parse().',
    '',
    'Regex escaping rules (mandatory):',
    '- Use "\\\\s" instead of "\\s".',
    '- Use "\\\\d" instead of "\\d".',
    '- Use "\\\\+" instead of "\\+".',
    '- Do not use "\\-" (use "-" directly).',
    '',
    'Validation requirement:',
    '- Before returning, verify that JSON.parse(output) succeeds.',
    '',
    'Generate ONLY strict JSON (RFC 8259): no markdown comments, no trailing commas.',
    'Return a single JSON object with top-level keys limited to: csv_options, column_mapping, value_mappings, rules.',
    'Use only double quotes in JSON strings.',
    'If you use regex, escape backslashes for JSON (example: "^Title:\\\\s*\\\\d+$").',
    'Do not use keys outside the schema.',
    '',
    'YAFFA strict matching guidance:',
    '- A row is matched only when transaction_type resolves to withdrawal, deposit, or transfer.',
    '- The source column mapped to column_mapping.type is STRICT by default in YAFFA preview.',
    '- Amount-sign rules should be fallback only, not the only strict source.',
    '- Map column_mapping.type to the transaction-kind/type source column from this CSV.',
    '',
    'Hard engine constraints (MANDATORY):',
    '- In value_mappings[].when, use ONLY keys based on exact CSV headers:',
    '  - exact match: "<EXACT_HEADER>"',
    '  - regex match: "<EXACT_HEADER>_regex"',
    '- Do NOT use abstract keys like "type_regex" or "amount_regex".',
    '- Do NOT use unsupported pseudo-conditions like "transaction_type_missing".',
    '- Do NOT invent transaction labels not present in provided rows (sample + unmatched + flagged).',
    '- If a mapping cannot be derived from provided rows, omit it.',
    '- Keep "rules" as an empty array [] unless explicitly required by the provided rows.',
    '- Allowed set keys: "transaction_type", "category".',
    '',
    'Expected output structure:',
    '{',
    '  "csv_options": { "delimiter": ";", "encoding": "windows-1250" },',
    '  "column_mapping": { "date": "<DATE_HEADER>", "amount": "<AMOUNT_HEADER>", "description": "<DESCRIPTION_HEADER>", "type": "<TYPE_HEADER>", "from": "<FROM_HEADER>", "to": "<TO_HEADER>" },',
    '  "value_mappings": [',
    '    { "when": { "<TYPE_HEADER>_regex": "^CARD\\\\s+PAYMENT$" }, "set": { "transaction_type": "withdrawal" } }',
    '  ],',
    '  "rules": []',
    '}',
    '',
    'Rules:',
    '- Preserve original column names exactly.',
    '- Use regex fields when useful (e.g. "description_regex").',
    '- Keep it deterministic and machine-readable.',
    '- Replace all placeholder header names with exact values from CSV headers.',
    '- Ensure conditions assigning transaction_type are based on the source column mapped to column_mapping.type.',
    '- transaction_type must be one of: withdrawal, deposit, transfer.',
    '',
    'CSV headers:',
    JSON.stringify(headers),
    '',
    'Sample rows (first ' + aiPromptSampleRowsCount + '):',
    sampleJson,
    '',
    'Additional unmatched rows (accumulated from preview tests):',
    additionalJson,
    '',
    'Flagged preview rows (user-marked as incorrect; regenerate rules to classify these correctly):',
    flaggedIssuesJson,
    '',
    'Final requirement:',
    'Output only one json code block and ensure all regex strings are JSON-escaped correctly.',
  ].join('\n');
}

function updateAiPromptFromRows(
  csvRows,
  additionalRows = [],
  flaggedIssueRows = [],
) {
  const promptElement = document.getElementById('ai_dsl_prompt_output');
  if (!promptElement) {
    return;
  }

  if (!csvRows || csvRows.length === 0) {
    promptElement.value = '';
    return;
  }

  promptElement.value = buildAiDslPrompt(
    csvRows,
    additionalRows,
    flaggedIssueRows,
  );
}

function parseAiDslInput(rawValue) {
  const trimmedValue = String(rawValue ?? '').trim();
  if (!trimmedValue) {
    throw new Error('DSL input is empty.');
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmedValue);
  } catch (error) {
    throw new Error(
      'Invalid JSON format: ' +
        error.message +
        '. Hint: escape regex backslashes, e.g. "\\\\s", "\\\\d", "\\\\+".',
    );
  }

  if (Array.isArray(parsed)) {
    return { rules: parsed };
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('DSL must be a JSON object or an array of rules.');
  }

  const unknownKeys = Object.keys(parsed).filter(
    (key) => !aiDslAllowedKeys.includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new Error('Unknown keys in DSL: ' + unknownKeys.join(', '));
  }

  if (Object.keys(parsed).length === 0) {
    throw new Error('DSL object is empty.');
  }

  if (
    parsed.rules !== undefined &&
    parsed.rules !== null &&
    !Array.isArray(parsed.rules)
  ) {
    throw new Error('"rules" must be an array.');
  }

  if (
    parsed.csv_options?.strict_column !== undefined &&
    parsed.csv_options?.strict_column !== null &&
    typeof parsed.csv_options.strict_column !== 'string'
  ) {
    throw new Error('"csv_options.strict_column" must be a string.');
  }

  if (
    parsed.csv_options?.strict_columns !== undefined &&
    parsed.csv_options?.strict_columns !== null
  ) {
    if (!Array.isArray(parsed.csv_options.strict_columns)) {
      throw new Error('"csv_options.strict_columns" must be an array.');
    }

    const hasInvalidStrictColumns = parsed.csv_options.strict_columns.some(
      (columnName) => typeof columnName !== 'string' || !columnName.trim(),
    );
    if (hasInvalidStrictColumns) {
      throw new Error(
        '"csv_options.strict_columns" must contain non-empty strings.',
      );
    }
  }

  return parsed;
}

function profileDslToTextareaValue(profile) {
  if (!profile) {
    return '';
  }

  const dsl = {};
  aiDslAllowedKeys.forEach((key) => {
    if (profile[key] !== null && profile[key] !== undefined) {
      dsl[key] = profile[key];
    }
  });

  if (Object.keys(dsl).length === 0) {
    return '';
  }

  return JSON.stringify(dsl, null, 2);
}

function getActiveDslPayloadForImport() {
  if (selectedImportProfile) {
    const profileDslValue = profileDslToTextareaValue(selectedImportProfile);
    if (!profileDslValue.trim()) {
      throw new Error(
        'Selected import profile does not contain DSL settings yet.',
      );
    }

    return parseAiDslInput(profileDslValue);
  }

  const inputElement = document.getElementById('ai_dsl_input');
  const rawDslInput = String(inputElement?.value ?? '').trim();
  if (!rawDslInput) {
    throw new Error(
      'No DSL loaded. Select an import profile or use Add new profile and provide DSL JSON.',
    );
  }

  return parseAiDslInput(rawDslInput);
}

function getSelectedAccountReference() {
  const selectedAccountId = Number($('#account').val());
  if (!Number.isFinite(selectedAccountId)) {
    return null;
  }

  const selectedAccountData = $('#account').select2('data');
  const selectedAccountLabel =
    selectedAccountData?.[0]?.text ||
    String($('#account option:selected').text() ?? '').trim() ||
    'Selected account';

  return {
    id: selectedAccountId,
    name: selectedAccountLabel,
  };
}

function parseDslDateValue(rawDateValue) {
  const rawDate = String(rawDateValue ?? '').trim();
  if (!rawDate) {
    return null;
  }

  const isoLikeMatch = rawDate.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (isoLikeMatch) {
    const year = Number(isoLikeMatch[1]);
    const month = Number(isoLikeMatch[2]);
    const day = Number(isoLikeMatch[3]);
    const parsedDate = new Date(year, month - 1, day);
    if (
      parsedDate.getFullYear() === year &&
      parsedDate.getMonth() === month - 1 &&
      parsedDate.getDate() === day
    ) {
      return parsedDate;
    }
  }

  const dayFirstMatch = rawDate.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dayFirstMatch) {
    const day = Number(dayFirstMatch[1]);
    const month = Number(dayFirstMatch[2]);
    const year = Number(dayFirstMatch[3]);
    const parsedDate = new Date(year, month - 1, day);
    if (
      parsedDate.getFullYear() === year &&
      parsedDate.getMonth() === month - 1 &&
      parsedDate.getDate() === day
    ) {
      return parsedDate;
    }
  }

  const timestamp = Date.parse(rawDate);
  if (!Number.isNaN(timestamp)) {
    return new Date(timestamp);
  }

  return null;
}

function parseDslAmountValue(rawAmountValue) {
  let normalizedValue = String(rawAmountValue ?? '').trim();
  if (!normalizedValue) {
    return null;
  }

  normalizedValue = normalizedValue
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[^0-9,.\-+]/g, '');

  if (!normalizedValue) {
    return null;
  }

  const lastCommaIndex = normalizedValue.lastIndexOf(',');
  const lastDotIndex = normalizedValue.lastIndexOf('.');

  if (lastCommaIndex >= 0 && lastDotIndex >= 0) {
    if (lastCommaIndex > lastDotIndex) {
      normalizedValue = normalizedValue.replace(/\./g, '').replace(',', '.');
    } else {
      normalizedValue = normalizedValue.replace(/,/g, '');
    }
  } else if (lastCommaIndex >= 0) {
    normalizedValue = normalizedValue.replace(',', '.');
  }

  const parsedNumber = Number.parseFloat(normalizedValue);
  if (!Number.isFinite(parsedNumber)) {
    return null;
  }

  return Math.abs(parsedNumber);
}

function findPayeeByImportValue(rawValue) {
  const sourceValue = String(rawValue ?? '')
    .trim()
    .toLowerCase();
  if (!sourceValue) {
    return null;
  }

  const payees = Array.isArray(window.payees) ? window.payees : [];

  const matchedByName = payees.find((payee) => {
    const payeeName = String(payee?.name ?? '')
      .trim()
      .toLowerCase();
    return payeeName.length > 0 && sourceValue.includes(payeeName);
  });
  if (matchedByName) {
    return matchedByName;
  }

  for (const payee of payees) {
    const aliasLines = String(payee?.alias ?? '')
      .split(/\r?\n/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
    if (aliasLines.some((aliasLine) => sourceValue.includes(aliasLine))) {
      return payee;
    }
  }

  return null;
}

function resolveCounterpartyAccount(rawValue) {
  const matchedPayee = findPayeeByImportValue(rawValue);
  if (matchedPayee) {
    return matchedPayee;
  }

  const fallbackLabel = String(rawValue ?? '').trim();
  if (!fallbackLabel) {
    return undefined;
  }

  return {
    name: fallbackLabel,
    config: {},
  };
}

function isQuickRecordPossible(rawTransaction) {
  if (
    !rawTransaction?.date ||
    !rawTransaction?.config?.account_from ||
    !rawTransaction?.config?.account_to ||
    !rawTransaction?.config?.amount_from ||
    !rawTransaction?.config?.amount_to
  ) {
    return false;
  }

  if (rawTransaction.transaction_type?.name === 'withdrawal') {
    const withdrawalCategoryId =
      rawTransaction.config.account_to?.config?.category_id ??
      rawTransaction.config.account_to?.config?.category?.id;
    return Boolean(withdrawalCategoryId);
  }

  if (rawTransaction.transaction_type?.name === 'deposit') {
    const depositCategoryId =
      rawTransaction.config.account_from?.config?.category_id ??
      rawTransaction.config.account_from?.config?.category?.id;
    return Boolean(depositCategoryId);
  }

  return false;
}

function buildDslDraftTransaction(row, draftId, dslPayload, mappedValues) {
  const transactionTypeName = String(
    mappedValues?.transaction_type ?? '',
  ).trim();
  const transactionType = dslTransactionTypes[transactionTypeName];
  if (!transactionType) {
    return null;
  }

  const columnMapping = dslPayload?.column_mapping ?? {};
  const dateColumnName = String(columnMapping.date ?? '').trim();
  const amountColumnName = String(columnMapping.amount ?? '').trim();
  const descriptionColumnName = String(columnMapping.description ?? '').trim();
  const fromColumnName = String(columnMapping.from ?? '').trim();
  const toColumnName = String(columnMapping.to ?? '').trim();

  const parsedDate = parseDslDateValue(row[dateColumnName]);
  const parsedAmount = parseDslAmountValue(row[amountColumnName]);
  const selectedAccount = getSelectedAccountReference();

  if (!parsedDate || !Number.isFinite(parsedAmount) || !selectedAccount?.id) {
    return null;
  }

  const descriptionValue = String(row[descriptionColumnName] ?? '').trim();
  const fromValue = row[fromColumnName];
  const toValue = row[toColumnName];

  const rawTransaction = {
    draftId: draftId,
    handled: false,
    hidden: false,
    similarTransactions: false,
    relatedSchedules: false,
    quickRecordingPossible: false,
    transaction_config_type: 'standard',
    transaction_type_id: transactionType.id,
    transaction_type: {
      name: transactionType.name,
      amount_multiplier: transactionType.amount_multiplier,
    },
    config: {
      amount_from: parsedAmount,
      amount_to: parsedAmount,
    },
  };

  if (descriptionValue.length > 0) {
    rawTransaction.comment = descriptionValue;
  }

  if (transactionTypeName === 'withdrawal') {
    rawTransaction.config.account_from = selectedAccount;
    rawTransaction.config.account_to = resolveCounterpartyAccount(
      toValue ?? fromValue,
    );
  } else if (transactionTypeName === 'deposit') {
    rawTransaction.config.account_from = resolveCounterpartyAccount(
      fromValue ?? toValue,
    );
    rawTransaction.config.account_to = selectedAccount;
  } else {
    rawTransaction.config.account_from = selectedAccount;
    rawTransaction.config.account_to = resolveCounterpartyAccount(toValue);
  }

  rawTransaction.quickRecordingPossible = isQuickRecordPossible(rawTransaction);

  return rawTransaction;
}

function buildTransactionsFromDslPreviewRows(previewRows, dslPayload) {
  const transactions = [];
  const failedEntries = [];

  (previewRows ?? []).forEach((entry) => {
    const draft = buildDslDraftTransaction(
      entry.row,
      Number(entry.index),
      dslPayload,
      entry.mapped ?? {},
    );
    if (draft) {
      transactions.push(draft);
      return;
    }

    failedEntries.push({
      index: entry.index,
      row: entry.row,
    });
  });

  return {
    transactions: transactions,
    failedEntries: failedEntries,
  };
}

function getDslPreviewIssueState(rowIndex) {
  const key = String(rowIndex);
  return String(window.dslPreviewIssueRows[key] ?? '');
}

function setDslPreviewIssueState(rowIndex, reasonText) {
  const key = String(rowIndex);
  const normalizedReason = String(reasonText ?? '');
  if (!normalizedReason.trim()) {
    delete window.dslPreviewIssueRows[key];
    return;
  }

  window.dslPreviewIssueRows[key] = normalizedReason;
}

function collectFlaggedDslPreviewRowsForPrompt() {
  const rowsByIndex = new Map(
    (window.dslPreviewMatchedRows ?? []).map((entry) => [entry.index, entry]),
  );
  const flaggedRows = [];

  Object.entries(window.dslPreviewIssueRows ?? {}).forEach(
    ([rowIndexRaw, reasonRaw]) => {
      const rowIndex = Number(rowIndexRaw);
      if (!Number.isFinite(rowIndex)) {
        return;
      }

      const reason = String(reasonRaw ?? '').trim();
      if (!reason) {
        return;
      }

      const matchedEntry = rowsByIndex.get(rowIndex);
      if (!matchedEntry) {
        return;
      }

      flaggedRows.push({
        _row: matchedEntry.index + 1,
        _issue_reason: reason,
        ...matchedEntry.row,
      });
    },
  );

  return {
    flaggedRows: flaggedRows,
  };
}

function getPromptRowsFromPreviewState() {
  const promptUnmatchedRows = Array.isArray(
    window.dslPreviewPromptUnmatchedRows,
  )
    ? window.dslPreviewPromptUnmatchedRows
    : [];
  const flaggedInfo = collectFlaggedDslPreviewRowsForPrompt();

  return {
    promptUnmatchedRows: promptUnmatchedRows,
    flaggedRows: flaggedInfo.flaggedRows,
  };
}

function updateDslPreviewFiltersStatus() {
  const statusElement = document.getElementById('dsl_preview_filters_status');
  if (!statusElement) {
    return;
  }

  const includeFilters = Object.entries(window.dslPreviewFilters.include ?? {});
  const excludeFilters = Object.entries(window.dslPreviewFilters.exclude ?? {});

  if (includeFilters.length === 0 && excludeFilters.length === 0) {
    statusElement.textContent = 'No active DSL preview filters.';
    return;
  }

  const includeLabel = includeFilters
    .map(
      ([column, values]) =>
        column +
        ' IN [' +
        (Array.isArray(values) ? values.join(', ') : '') +
        ']',
    )
    .join(', ');
  const excludeLabel = excludeFilters
    .map(
      ([column, values]) =>
        column +
        ' NOT IN [' +
        (Array.isArray(values) ? values.join(', ') : '') +
        ']',
    )
    .join(', ');

  const parts = [];
  if (includeLabel) {
    parts.push('Include: ' + includeLabel);
  }
  if (excludeLabel) {
    parts.push('Exclude: ' + excludeLabel);
  }

  statusElement.textContent = parts.join(' | ');
}

function applyDslPreviewFilters(tableRows) {
  return tableRows.filter((tableRow) => {
    const includeFilters = Object.entries(
      window.dslPreviewFilters.include ?? {},
    );
    const excludeFilters = Object.entries(
      window.dslPreviewFilters.exclude ?? {},
    );

    const includesPass = includeFilters.every(([column, values]) => {
      const normalizedValues = Array.isArray(values) ? values : [];
      if (normalizedValues.length === 0) {
        return true;
      }

      return normalizedValues.includes(String(tableRow[column] ?? ''));
    });
    if (!includesPass) {
      return false;
    }

    const excludesPass = excludeFilters.every(([column, values]) => {
      const normalizedValues = Array.isArray(values) ? values : [];
      if (normalizedValues.length === 0) {
        return true;
      }

      return !normalizedValues.includes(String(tableRow[column] ?? ''));
    });

    return excludesPass;
  });
}

function clearDslPreviewFilters() {
  window.dslPreviewFilters = {
    include: {},
    exclude: {},
  };
}

function addDslPreviewFilterValue(filterType, column, value) {
  const filterRoot = window.dslPreviewFilters[filterType] ?? {};
  const normalizedColumn = String(column ?? '');
  const normalizedValue = String(value ?? '');
  if (!normalizedColumn) {
    return;
  }

  const existingValues = Array.isArray(filterRoot[normalizedColumn])
    ? filterRoot[normalizedColumn]
    : [];
  if (!existingValues.includes(normalizedValue)) {
    existingValues.push(normalizedValue);
  }
  filterRoot[normalizedColumn] = existingValues;
  window.dslPreviewFilters[filterType] = filterRoot;
}

function removeDslPreviewFilterValue(filterType, column, value) {
  const filterRoot = window.dslPreviewFilters[filterType] ?? {};
  const normalizedColumn = String(column ?? '');
  const normalizedValue = String(value ?? '');
  if (!normalizedColumn) {
    return;
  }

  const existingValues = Array.isArray(filterRoot[normalizedColumn])
    ? filterRoot[normalizedColumn]
    : [];
  const nextValues = existingValues.filter(
    (entry) => String(entry) !== normalizedValue,
  );
  if (nextValues.length === 0) {
    delete filterRoot[normalizedColumn];
  } else {
    filterRoot[normalizedColumn] = nextValues;
  }
  window.dslPreviewFilters[filterType] = filterRoot;
}

function getDslMappingLabel(mapping, index) {
  const mappingName = String(mapping?.name ?? '').trim();
  if (mappingName.length > 0) {
    return mappingName;
  }

  const conditionKeys = Object.keys(mapping?.when ?? {});
  if (conditionKeys.length > 0) {
    return conditionKeys.join(' & ');
  }

  return 'rule_' + (index + 1);
}

function extractConditionSourceField(conditionKey) {
  if (String(conditionKey).endsWith('_regex')) {
    return String(conditionKey).replace(/_regex$/, '');
  }

  return String(conditionKey);
}

function getDslStrictColumns(dslPayload) {
  const strictColumns = [];
  const mappedTypeSourceColumn = String(
    dslPayload?.column_mapping?.type ?? '',
  ).trim();

  if (mappedTypeSourceColumn.length > 0) {
    strictColumns.push(mappedTypeSourceColumn);
  }

  const strictColumnSingle = dslPayload?.csv_options?.strict_column;
  const strictColumnsArray = dslPayload?.csv_options?.strict_columns;

  if (typeof strictColumnSingle === 'string' && strictColumnSingle.trim()) {
    strictColumns.push(strictColumnSingle.trim());
  }

  if (Array.isArray(strictColumnsArray)) {
    strictColumnsArray.forEach((columnName) => {
      const normalizedColumnName = String(columnName ?? '').trim();
      if (normalizedColumnName.length > 0) {
        strictColumns.push(normalizedColumnName);
      }
    });
  }

  return Array.from(new Set(strictColumns));
}

function checkDslConditionValue(row, conditionKey, expectedValue) {
  if (conditionKey.endsWith('_regex')) {
    const sourceField = conditionKey.replace(/_regex$/, '');
    const sourceValue = String(row[sourceField] ?? '');
    const regex = new RegExp(String(expectedValue ?? ''));
    return regex.test(sourceValue);
  }

  return String(row[conditionKey] ?? '') === String(expectedValue ?? '');
}

function doesDslConditionMatchRow(row, whenConditions) {
  if (!whenConditions || typeof whenConditions !== 'object') {
    return false;
  }

  const conditionEntries = Object.entries(whenConditions);
  if (conditionEntries.length === 0) {
    return false;
  }

  return conditionEntries.every(([conditionKey, expectedValue]) =>
    checkDslConditionValue(row, conditionKey, expectedValue),
  );
}

function applyDslMappingsToRow(row, dslPayload) {
  const mappedValues = {};
  const matchedByRules = [];
  const matchedConditionFields = [];
  const valueMappings = Array.isArray(dslPayload.value_mappings)
    ? dslPayload.value_mappings
    : [];

  valueMappings.forEach((mapping, mappingIndex) => {
    if (!mapping || typeof mapping !== 'object') {
      return;
    }

    if (!doesDslConditionMatchRow(row, mapping.when)) {
      return;
    }

    matchedByRules.push(getDslMappingLabel(mapping, mappingIndex));
    Object.keys(mapping.when ?? {}).forEach((conditionKey) => {
      const sourceField = extractConditionSourceField(conditionKey);
      if (!matchedConditionFields.includes(sourceField)) {
        matchedConditionFields.push(sourceField);
      }
    });

    if (mapping.set && typeof mapping.set === 'object') {
      Object.assign(mappedValues, mapping.set);
    }
  });

  return {
    mappedValues: mappedValues,
    matchedByRules: matchedByRules,
    matchedConditionFields: matchedConditionFields,
  };
}

function runDslPreviewScan(dslPayload) {
  const rows = Array.isArray(window.csvParsedRows) ? window.csvParsedRows : [];
  const strictColumns = getDslStrictColumns(dslPayload);
  const matchedRows = [];
  const unmatchedRows = [];

  rows.forEach((row, index) => {
    let mappedResult = { mappedValues: {}, matchedByRules: [] };

    try {
      mappedResult = applyDslMappingsToRow(row, dslPayload);
    } catch (_error) {
      unmatchedRows.push({ index: index, row: row });
      return;
    }

    const type = String(
      mappedResult.mappedValues.transaction_type ?? '',
    ).trim();
    const hasStrictCoverage =
      strictColumns.length === 0 ||
      strictColumns.some((strictColumn) =>
        mappedResult.matchedConditionFields.includes(strictColumn),
      );
    const isMatched =
      (type === 'withdrawal' || type === 'deposit' || type === 'transfer') &&
      hasStrictCoverage;

    if (isMatched) {
      matchedRows.push({
        index: index,
        row: row,
        mapped: mappedResult.mappedValues,
        matchedByRules: mappedResult.matchedByRules,
        matchedConditionFields: mappedResult.matchedConditionFields,
      });
    } else {
      unmatchedRows.push({ index: index, row: row });
    }
  });

  return {
    matchedRows: matchedRows,
    unmatchedRows: unmatchedRows,
    totalRows: rows.length,
    strictColumns: strictColumns,
  };
}

function pickNextPromptUnmatchedEntries(
  unmatchedEntries,
  strictColumns,
  limit,
) {
  const normalizedLimit = Number(limit);
  const maxResults =
    Number.isFinite(normalizedLimit) && normalizedLimit > 0
      ? normalizedLimit
      : aiPromptExtraUnmatchedRowsCount;
  const candidates = Array.isArray(unmatchedEntries) ? unmatchedEntries : [];
  const strictColumn = String(strictColumns?.[0] ?? '').trim();
  const usedIndexes = new Set(window.dslPreviewPromptUnmatchedIndexes ?? []);
  const usedStrictValueKeys = new Set(
    window.dslPreviewPromptStrictValueKeys ?? [],
  );
  const isFirstPromptIteration =
    usedIndexes.size === 0 && usedStrictValueKeys.size === 0;
  const selectAllUniqueStrictValues =
    Boolean(strictColumn) && isFirstPromptIteration;
  const selectedEntries = [];

  const buildStrictValueKey = (entry) => {
    if (!strictColumn) {
      return '';
    }
    return (
      strictColumn + '::' + String(entry?.row?.[strictColumn] ?? '').trim()
    );
  };

  if (strictColumn) {
    for (const entry of candidates) {
      if (
        !selectAllUniqueStrictValues &&
        selectedEntries.length >= maxResults
      ) {
        break;
      }
      if (usedIndexes.has(entry.index)) {
        continue;
      }

      const strictValueKey = buildStrictValueKey(entry);
      if (strictValueKey && usedStrictValueKeys.has(strictValueKey)) {
        continue;
      }

      selectedEntries.push(entry);
      if (strictValueKey) {
        usedStrictValueKeys.add(strictValueKey);
      }
    }
  }

  if (!selectAllUniqueStrictValues && selectedEntries.length < maxResults) {
    for (const entry of candidates) {
      if (selectedEntries.length >= maxResults) {
        break;
      }
      if (usedIndexes.has(entry.index)) {
        continue;
      }
      if (
        selectedEntries.some(
          (selectedEntry) => selectedEntry.index === entry.index,
        )
      ) {
        continue;
      }

      selectedEntries.push(entry);

      const strictValueKey = buildStrictValueKey(entry);
      if (strictValueKey) {
        usedStrictValueKeys.add(strictValueKey);
      }
    }
  }

  return {
    selectedEntries: selectedEntries,
    strictColumn: strictColumn,
    usedStrictValueKeys: Array.from(usedStrictValueKeys),
    selectedAllUniqueStrictValues: selectAllUniqueStrictValues,
  };
}

function hasBroadAmountTransactionTypeRules(dslPayload) {
  const valueMappings = Array.isArray(dslPayload?.value_mappings)
    ? dslPayload.value_mappings
    : [];

  return valueMappings.some((mapping) => {
    if (!mapping || typeof mapping !== 'object') {
      return false;
    }
    if (!mapping.set || typeof mapping.set !== 'object') {
      return false;
    }
    if (!String(mapping.set.transaction_type ?? '').trim()) {
      return false;
    }

    const conditionKeys = Object.keys(mapping.when ?? {});
    return conditionKeys.some(
      (conditionKey) =>
        conditionKey.endsWith('_regex') &&
        /kwota|amount/i.test(conditionKey.replace(/_regex$/, '')),
    );
  });
}

function refillDslPreviewMatchedRowsTable(matchedRows) {
  let head = document.getElementById('dsl_preview_matched_table_head');
  let body = document.getElementById('dsl_preview_matched_table_body');

  head.innerHTML = '';
  body.innerHTML = '';
  updateDslPreviewFiltersStatus();
  syncDslPreviewSelectionWithMatchedRows(matchedRows);

  if (!matchedRows || matchedRows.length === 0) {
    updateDslPreviewSelectionSummary();
    return;
  }

  const tableRows = matchedRows.map((entry) => {
    const issueReason = getDslPreviewIssueState(entry.index);

    return {
      _row_index: entry.index,
      _row: entry.index + 1,
      _mapped_transaction_type: entry.mapped.transaction_type ?? '',
      _matched_by: (entry.matchedByRules ?? []).join(', '),
      _matched_fields: (entry.matchedConditionFields ?? []).join(', '),
      _issue_reason: issueReason,
      ...entry.row,
    };
  });
  const filteredTableRows = applyDslPreviewFilters(tableRows);

  const headers = [
    '_selected',
    ...Object.keys(tableRows[0]).filter(
      (headerName) => headerName !== '_row_index',
    ),
  ];
  const headerLabels = {
    _selected: '',
    _row: '#',
    _mapped_transaction_type: 'mapped transaction_type',
    _matched_by: 'matched by',
    _matched_fields: 'matched fields',
    _issue_reason: 'issue reason (fill to mark row as incorrect)',
  };
  let headerRow = document.createElement('tr');
  headers.forEach((headerText) => {
    let header = document.createElement('th');
    if (headerText === '_selected') {
      const selectAllCheckbox = document.createElement('input');
      selectAllCheckbox.type = 'checkbox';
      selectAllCheckbox.id = 'dsl_preview_select_all';
      selectAllCheckbox.className = 'form-check-input';
      selectAllCheckbox.title = 'Select all visible rows';
      header.appendChild(selectAllCheckbox);
    } else {
      header.appendChild(
        document.createTextNode(headerLabels[headerText] ?? headerText),
      );
    }
    headerRow.appendChild(header);
  });
  head.appendChild(headerRow);

  filteredTableRows.forEach((tableRow) => {
    let row = document.createElement('tr');
    headers.forEach((headerText) => {
      let cell = document.createElement('td');

      if (headerText === '_selected') {
        const rowCheckbox = document.createElement('input');
        rowCheckbox.type = 'checkbox';
        rowCheckbox.className = 'form-check-input dsl-preview-select-row';
        rowCheckbox.dataset.rowIndex = String(tableRow._row_index);
        rowCheckbox.checked = isDslPreviewRowSelected(tableRow._row_index);
        cell.classList.add('text-center');
        cell.appendChild(rowCheckbox);
        row.appendChild(cell);
        return;
      }

      if (headerText === '_issue_reason') {
        const issueInput = document.createElement('input');
        issueInput.type = 'text';
        issueInput.className =
          'form-control form-control-sm dsl-preview-issue-reason';
        issueInput.dataset.rowIndex = String(tableRow._row_index);
        issueInput.value = String(tableRow._issue_reason ?? '');
        issueInput.placeholder = 'Describe why this row is wrong';
        cell.appendChild(issueInput);
        row.appendChild(cell);
        return;
      }

      const text = String(tableRow[headerText] ?? '');
      const filterControls = document.createElement('div');
      filterControls.className = 'dsl-cell-filter-controls mb-1';

      const includeButton = document.createElement('button');
      includeButton.type = 'button';
      includeButton.className =
        'btn btn-link btn-sm p-0 me-1 dsl-cell-filter-include';
      includeButton.dataset.column = headerText;
      includeButton.dataset.value = text;
      includeButton.innerHTML =
        '<i class="fa fa-plus-circle text-success" aria-hidden="true"></i>';
      includeButton.setAttribute('aria-label', 'Include value');
      includeButton.title = 'Include value';

      const excludeButton = document.createElement('button');
      excludeButton.type = 'button';
      excludeButton.className =
        'btn btn-link btn-sm p-0 dsl-cell-filter-exclude';
      excludeButton.dataset.column = headerText;
      excludeButton.dataset.value = text;
      excludeButton.innerHTML =
        '<i class="fa fa-minus-circle text-danger" aria-hidden="true"></i>';
      excludeButton.setAttribute('aria-label', 'Exclude value');
      excludeButton.title = 'Exclude value';

      filterControls.appendChild(includeButton);
      filterControls.appendChild(excludeButton);
      cell.appendChild(filterControls);
      cell.appendChild(document.createTextNode(text));
      row.appendChild(cell);
    });
    body.appendChild(row);
  });

  updateDslPreviewSelectionSummary();
}

function refreshPromptFromCurrentPreview() {
  if (!window.csvSampleRows || window.csvSampleRows.length === 0) {
    return {
      promptUnmatchedRows: [],
      flaggedRows: [],
    };
  }

  const promptRows = getPromptRowsFromPreviewState();
  updateAiPromptFromRows(
    window.csvSampleRows,
    promptRows.promptUnmatchedRows,
    promptRows.flaggedRows,
  );

  return promptRows;
}

async function loadImportProfile(profileId) {
  const response = await fetch('/api/import/csv/profiles/' + profileId, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (!response.ok) {
    throw new Error('Unable to load import profile details.');
  }

  const profile = await response.json();
  selectedImportProfile = profile;
  return profile;
}

async function saveDslToSelectedProfile() {
  const profileId = document.getElementById('csv_file').dataset.importProfileId;
  let dslPayload;
  try {
    dslPayload = parseAiDslInput(document.getElementById('ai_dsl_input').value);
  } catch (error) {
    setAiDslStatus(error.message, 'danger');
    return;
  }

  try {
    if (!profileId) {
      const profileName = window.prompt(
        'No profile selected. Enter new profile name:',
      );
      const normalizedProfileName = String(profileName ?? '').trim();
      if (!normalizedProfileName) {
        setAiDslStatus('Save canceled. No profile name provided.', 'warning');
        return;
      }

      const createResponse = await fetch('/api/import/csv/profiles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-TOKEN': window.csrfToken,
        },
        body: JSON.stringify({
          name: normalizedProfileName,
          ...dslPayload,
        }),
      });

      if (!createResponse.ok) {
        throw new Error('Failed to create a new import profile.');
      }

      selectedImportProfile = await createResponse.json();
      document.getElementById('csv_file').dataset.importProfileId =
        selectedImportProfile.id;

      const option = new Option(
        selectedImportProfile.name,
        selectedImportProfile.id,
        true,
        true,
      );
      $('#import_profile').append(option).trigger('change');

      setAiDslStatus('DSL saved to new import profile.', 'success');
      return;
    }

    let profile = selectedImportProfile;
    if (!profile || Number(profile.id) !== Number(profileId)) {
      profile = await loadImportProfile(profileId);
    }

    const updateResponse = await fetch(
      '/api/import/csv/profiles/' + profileId,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-TOKEN': window.csrfToken,
        },
        body: JSON.stringify({
          name: profile.name,
          ...dslPayload,
        }),
      },
    );

    if (!updateResponse.ok) {
      throw new Error('Failed to save DSL to the selected profile.');
    }

    selectedImportProfile = await updateResponse.json();
    setAiDslStatus('DSL saved to selected profile.', 'success');
  } catch (error) {
    setAiDslStatus(error.message, 'danger');
  }
}

function showImportNotification(type, message) {
  const notificationEvent = new CustomEvent('notification', {
    detail: {
      notification: {
        type: type,
        message: message,
        title: null,
        icon: null,
        dismissible: true,
      },
    },
  });
  window.dispatchEvent(notificationEvent);
}

function buildQuickRecordPayloadFromDraft(draft) {
  if (!draft) {
    return { error: 'Draft transaction not found.' };
  }

  if (!draft.quickRecordingPossible) {
    return {
      error:
        'Draft transaction is not ready for quick import (missing required values).',
    };
  }

  const payload = JSON.parse(JSON.stringify(draft));
  payload.action = 'create';
  payload.config_type = 'standard';
  payload.items = [];
  payload.fromModal = true;

  if (
    !payload.config ||
    !payload.config.account_from ||
    !payload.config.account_to ||
    !payload.config.account_from.id ||
    !payload.config.account_to.id
  ) {
    return {
      error: 'Draft transaction is missing source/target account values.',
    };
  }

  payload.config.account_from_id = payload.config.account_from.id;
  payload.config.account_to_id = payload.config.account_to.id;

  if (payload.config.account_to?.config?.category) {
    payload.remaining_payee_default_amount =
      payload.amount ?? payload.config.amount_to;
    payload.remaining_payee_default_category_id =
      payload.config.account_to.config.category.id;
  }

  return { payload: payload };
}

async function quickImportDraftTransaction(draftId, options = {}) {
  const showToast = options.showToast !== false;
  const draft = window.transactions.find(
    (transaction) => Number(transaction.draftId) === Number(draftId),
  );
  const payloadResult = buildQuickRecordPayloadFromDraft(draft);
  if (payloadResult.error) {
    return { ok: false, reason: 'invalid_draft', message: payloadResult.error };
  }

  try {
    const response = await fetch(route('api.transactions.storeStandard'), {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': window.csrfToken,
      },
      body: JSON.stringify(payloadResult.payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        ok: false,
        reason: 'api_error',
        message:
          'Import failed for row #' +
          (Number(draftId) + 1) +
          (errorBody ? ': ' + errorBody : '.'),
      };
    }

    const responseData = await response.json();
    const createdTransaction = responseData.transaction;

    if (draft) {
      draft.handled = true;
    }

    if (showToast && createdTransaction?.id) {
      showImportNotification(
        'success',
        'Transaction added (#' + createdTransaction.id + ')',
      );
    }

    return { ok: true, transaction: createdTransaction };
  } catch (error) {
    return {
      ok: false,
      reason: 'network_error',
      message:
        'Import failed for row #' +
        (Number(draftId) + 1) +
        ': ' +
        String(error?.message ?? error),
    };
  }
}

async function importSelectedDslPreviewRows() {
  if (window.dslBulkImportInProgress) {
    return;
  }

  if (!window.csvDraftsReady) {
    setAiDslStatus(
      'CSV rows are still being processed. Wait for parsing to finish.',
      'warning',
    );
    return;
  }

  const selectedRows = getSelectedDslPreviewMatchedRows();
  if (selectedRows.length === 0) {
    setAiDslStatus('Select at least one matched row to import.', 'warning');
    return;
  }

  window.dslBulkImportInProgress = true;
  updateDslPreviewSelectionSummary();

  const selectedDraftIds = Array.from(
    new Set(
      selectedRows
        .map((entry) => Number(entry.index))
        .filter((draftId) => Number.isFinite(draftId)),
    ),
  );

  let importedCount = 0;
  let skippedManualCount = 0;
  let missingDraftCount = 0;
  const failedImports = [];

  for (const draftId of selectedDraftIds) {
    const draft = window.transactions.find(
      (transaction) => Number(transaction.draftId) === Number(draftId),
    );
    if (!draft) {
      missingDraftCount++;
      continue;
    }

    if (!draft.quickRecordingPossible) {
      skippedManualCount++;
      continue;
    }

    const importResult = await quickImportDraftTransaction(draftId, {
      showToast: false,
    });
    if (importResult.ok) {
      importedCount++;
      setDslPreviewRowSelected(draftId, false);
    } else {
      failedImports.push(importResult.message);
    }
  }

  window.table.clear().rows.add(window.transactions).draw();
  updateDslPreviewSelectionSummary();

  const failedCount = failedImports.length;
  const summaryMessage =
    'Import finished. Selected: ' +
    selectedDraftIds.length +
    ', imported: ' +
    importedCount +
    ', skipped (manual): ' +
    skippedManualCount +
    ', missing drafts: ' +
    missingDraftCount +
    ', failed: ' +
    failedCount +
    '.';
  const summaryTone = failedCount > 0 ? 'warning' : 'success';
  setAiDslStatus(summaryMessage, summaryTone);

  if (importedCount > 0 || failedCount > 0) {
    showImportNotification(
      failedCount > 0 ? 'warning' : 'success',
      summaryMessage,
    );
  }

  window.dslBulkImportInProgress = false;
  updateDslPreviewSelectionSummary();
}

async function importAllAcceptedTransactions() {
  if (window.dslBulkImportInProgress) {
    return;
  }

  if (!window.csvDraftsReady) {
    setAiDslStatus(
      'CSV rows are still being processed. Wait for parsing to finish.',
      'warning',
    );
    return;
  }

  const draftIds = getQuickImportableDraftIds();
  if (draftIds.length === 0) {
    setAiDslStatus(
      'No accepted transactions available for quick import.',
      'warning',
    );
    return;
  }

  window.dslBulkImportInProgress = true;
  updateDslPreviewSelectionSummary();

  let importedCount = 0;
  const failedImports = [];

  for (const draftId of draftIds) {
    const importResult = await quickImportDraftTransaction(draftId, {
      showToast: false,
    });
    if (importResult.ok) {
      importedCount++;
      setDslPreviewRowSelected(draftId, false);
    } else {
      failedImports.push(importResult.message);
    }
  }

  window.table.clear().rows.add(window.transactions).draw();
  updateQuickImportButtonState();
  updateDslPreviewSelectionSummary();

  const failedCount = failedImports.length;
  const summaryMessage =
    'Bulk import finished. Selected: ' +
    draftIds.length +
    ', imported: ' +
    importedCount +
    ', failed: ' +
    failedCount +
    '.';
  setAiDslStatus(summaryMessage, failedCount > 0 ? 'warning' : 'success');
  showImportNotification(
    failedCount > 0 ? 'warning' : 'success',
    summaryMessage,
  );

  window.dslBulkImportInProgress = false;
  updateDslPreviewSelectionSummary();
}

function decodeCsvData(fileData) {
  if (typeof fileData === 'string') {
    return fileData.replace(/^\uFEFF/, '');
  }

  if (!(fileData instanceof ArrayBuffer)) {
    return String(fileData ?? '').replace(/^\uFEFF/, '');
  }

  // Prefer strict UTF-8 and fallback to CP1250 for legacy bank exports.
  try {
    return new TextDecoder('utf-8', { fatal: true })
      .decode(fileData)
      .replace(/^\uFEFF/, '');
  } catch (_error) {
    try {
      return new TextDecoder('windows-1250')
        .decode(fileData)
        .replace(/^\uFEFF/, '');
    } catch (_fallbackError) {
      return new TextDecoder('utf-8').decode(fileData).replace(/^\uFEFF/, '');
    }
  }
}

function parseCsvRowsFallback(csvData, separator) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  while (i < csvData.length) {
    const char = csvData[i];

    if (char === '"') {
      if (inQuotes && csvData[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }

      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (!inQuotes && char === separator) {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      row.push(cell);
      if (!(row.length === 1 && row[0] === '')) {
        rows.push(row);
      }
      row = [];
      cell = '';

      if (char === '\r' && csvData[i + 1] === '\n') {
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    cell += char;
    i++;
  }

  if (inQuotes) {
    throw new Error('CSV parse error: unclosed quoted field');
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (!(row.length === 1 && row[0] === '')) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header, index) => {
    const trimmed = header.trim();
    return trimmed === '' ? `_column_${index + 1}` : trimmed;
  });

  return rows.slice(1).map((values) => {
    const rowObject = {};
    headers.forEach((header, index) => {
      rowObject[header] = values[index] ?? '';
    });

    return rowObject;
  });
}

function parseCsvRows(csvData) {
  const separators = [';', ',', '\t', '|'];
  let firstError = null;

  for (const separator of separators) {
    try {
      const rows = $.csv.toObjects(csvData, { separator: separator });
      if (rows.length === 0) {
        continue;
      }

      // Prefer parsers that actually split multiple columns in header rows.
      const keyCount = Object.keys(rows[0] ?? {}).length;
      if (keyCount > 1) {
        return rows;
      }
    } catch (error) {
      if (!firstError) {
        firstError = error;
      }
    }

    try {
      const fallbackRows = parseCsvRowsFallback(csvData, separator);
      if (fallbackRows.length === 0) {
        continue;
      }

      const keyCount = Object.keys(fallbackRows[0] ?? {}).length;
      if (keyCount > 1) {
        return fallbackRows;
      }
    } catch (error) {
      if (!firstError) {
        firstError = error;
      }
    }
  }

  if (firstError) {
    throw firstError;
  }

  return [];
}

// CSV parse functionality
document
  .getElementById('csv_file')
  .addEventListener('change', async function () {
    if (!this.files || !this.files[0]) {
      return;
    }

    const profileId = this.dataset.importProfileId;
    if (
      profileId &&
      (!selectedImportProfile ||
        Number(selectedImportProfile.id) !== Number(profileId))
    ) {
      try {
        const profile = await loadImportProfile(profileId);
        document.getElementById('ai_dsl_input').value =
          profileDslToTextareaValue(profile);
      } catch (error) {
        setAiDslStatus(error.message, 'danger');
        return;
      }
    }

    // Reset the previous import result before parsing a new file.
    window.transactions = [];
    window.unmatchedRows = [];
    window.csvParsedRows = [];
    window.csvSampleRows = [];
    window.csvHeaders = [];
    window.dslPreviewMatchedRows = [];
    window.dslPreviewUnmatchedEntries = [];
    window.dslPreviewPromptUnmatchedRows = [];
    window.dslPreviewPromptUnmatchedIndexes = [];
    window.dslPreviewPromptStrictValueKeys = [];
    window.dslPreviewIssueRows = {};
    window.dslPreviewSelectedRows = {};
    window.csvDraftsReady = false;
    window.dslBulkImportInProgress = false;
    updateCsvImportSummary(0, 0, 0);
    clearDslPreviewFilters();
    table.clear().draw();
    clearUnmatchedRowsTable();
    clearDslPreviewMatchedRowsTable();
    updateDslPreviewFiltersStatus();
    setSectionVisibility(identifiedTransactionsSectionSelector, false);
    setSectionVisibility(dslPreviewMatchedSectionSelector, false);
    setSectionVisibility(unmatchedRowsSectionSelector, false);
    updateAiPromptFromRows([], [], []);
    resetDslStatusState(0);
    setAiDslStatus('Parsing CSV...', 'muted');

    const myFile = this.files[0];
    const reader = new FileReader();

    reader.addEventListener('load', function (e) {
      const csvData = decodeCsvData(e.target.result);
      let csvRows = [];

      try {
        csvRows = parseCsvRows(csvData);
      } catch (error) {
        console.error(error);
        showImportErrorNotification(
          'CSV parse error. Check delimiter, encoding, and quoted values in the file.',
        );
        setAiDslStatus('CSV parse error. Prompt was not generated.', 'danger');
        return;
      }

      if (csvRows.length === 0) {
        updateCsvImportSummary(0, 0, 0);
        setAiDslStatus('No rows detected in CSV file.', 'warning');
        return;
      }

      csvRows.forEach((row) => {
        delete row[''];
      });

      window.csvParsedRows = csvRows;
      window.csvSampleRows = csvRows.slice(0, aiPromptSampleRowsCount);
      window.csvHeaders = Object.keys(csvRows[0] ?? {});
      window.dslStatusState.totalRows = csvRows.length;
      window.dslStatusState.matchedRows = null;
      window.dslStatusState.unmatchedRows = null;
      window.dslStatusState.strictFields = [];
      renderDslStatusTable();
      updateAiPromptFromRows(window.csvSampleRows, [], []);
      setAiDslStatus(
        'AI prompt generated from ' +
          window.csvSampleRows.length +
          ' sample rows. Validate DSL to scan and add unmatched rows.',
        'success',
      );

      let dslPayload;
      try {
        dslPayload = getActiveDslPayloadForImport();
      } catch (error) {
        window.csvDraftsReady = false;
        window.unmatchedRows = csvRows;
        updateCsvImportSummary(csvRows.length, 0, window.unmatchedRows.length);
        refillUnmatchedRows(window.unmatchedRows);
        setSectionVisibility(unmatchedRowsSectionSelector, true);
        setSectionVisibility(identifiedTransactionsSectionSelector, false);
        setSectionVisibility(dslPreviewMatchedSectionSelector, false);
        setAiDslStatus(error.message, 'warning');
        return;
      }

      let previewResult;
      try {
        previewResult = runDslPreviewScan(dslPayload);
      } catch (error) {
        window.csvDraftsReady = false;
        showImportErrorNotification('DSL preview scan failed.');
        setAiDslStatus(
          'DSL preview scan failed: ' + String(error?.message ?? error),
          'danger',
        );
        return;
      }

      const draftBuildResult = buildTransactionsFromDslPreviewRows(
        previewResult.matchedRows,
        dslPayload,
      );
      const builtDraftIndexes = new Set(
        draftBuildResult.transactions.map((transaction) =>
          Number(transaction.draftId),
        ),
      );
      const matchedRowsWithDrafts = previewResult.matchedRows.filter((entry) =>
        builtDraftIndexes.has(Number(entry.index)),
      );
      const unmatchedEntries = [
        ...previewResult.unmatchedRows,
        ...draftBuildResult.failedEntries,
      ];

      window.transactions = draftBuildResult.transactions;
      window.unmatchedRows = unmatchedEntries.map((entry) => entry.row);
      window.dslPreviewMatchedRows = matchedRowsWithDrafts;
      window.dslPreviewUnmatchedEntries = unmatchedEntries;
      window.csvDraftsReady = true;

      updateDslStatusStateFromPreview(dslPayload, {
        ...previewResult,
        matchedRows: matchedRowsWithDrafts,
        unmatchedRows: unmatchedEntries,
        totalRows: csvRows.length,
      });
      refillDslPreviewMatchedRowsTable(matchedRowsWithDrafts);
      setSectionVisibility(
        dslPreviewMatchedSectionSelector,
        matchedRowsWithDrafts.length > 0,
      );

      if (window.unmatchedRows.length > 0) {
        refillUnmatchedRows(window.unmatchedRows);
        setSectionVisibility(unmatchedRowsSectionSelector, true);
      } else {
        clearUnmatchedRowsTable();
        setSectionVisibility(unmatchedRowsSectionSelector, false);
      }

      updateCsvImportSummary(
        csvRows.length,
        window.transactions.length,
        window.unmatchedRows.length,
      );
      table.clear().rows.add(window.transactions).draw();
      table.columns.adjust().draw();
      setSectionVisibility(
        identifiedTransactionsSectionSelector,
        window.transactions.length > 0,
      );
      updateDslPreviewSelectionSummary();

      if (window.transactions.length > 0) {
        collectSimilarTransactions();
      }

      const parsedWithLabel = selectedImportProfile?.name
        ? ' using profile "' + selectedImportProfile.name + '"'
        : ' using DSL input';
      const conversionFailureCount = draftBuildResult.failedEntries.length;
      const conversionHint =
        conversionFailureCount > 0
          ? ' Conversion skipped for ' +
            conversionFailureCount +
            ' matched rows (missing date/amount/account mapping).'
          : '';
      setAiDslStatus(
        'CSV parsed' +
          parsedWithLabel +
          '. Accepted ' +
          window.transactions.length +
          '/' +
          csvRows.length +
          ' rows.' +
          conversionHint,
        window.transactions.length > 0 ? 'success' : 'warning',
      );
    });

    reader.readAsArrayBuffer(myFile);
  });

function collectSimilarTransactions() {
  // Find min and max date in transactions array
  let minDate = new Date(
    Math.min.apply(
      Math,
      transactions.map(function (o) {
        return o.date;
      }),
    ),
  );
  let maxDate = new Date(
    Math.max.apply(
      Math,
      transactions.map(function (o) {
        return o.date;
      }),
    ),
  );

  // Get all standard transactions in the range of min and max date
  let url = new URL(window.location.origin + '/api/transactions');
  url.searchParams.append('date_from', toIsoDateString(minDate));
  url.searchParams.append('date_to', toIsoDateString(maxDate));

  fetch(url)
    .then(function (response) {
      // TODO: proper error handling
      if (!response.ok) {
        throw new Error('Network response was not OK');
      }
      return response.json();
    })
    .then((data) => {
      let existingTransactions = data.data.map((transaction) => {
        transaction.date = new Date(transaction.date);
        return transaction;
      });

      // Loop all transactions and associate similar transactions
      window.transactions.map(function (transaction) {
        transaction.similarTransactions = [];
        existingTransactions.forEach(function (existingTransaction) {
          // Calculate similarity between transactions using date, amount and accounts

          // Transaction types must match
          if (
            transaction.transaction_type.name !==
            existingTransaction.transaction_type.name
          ) {
            return;
          }

          // Other fields count towards similarity
          let similarityCount = 0;
          const maxSimilarity = 4;

          if (
            toIsoDateString(transaction.date) ===
            toIsoDateString(existingTransaction.date)
          ) {
            similarityCount++;
          }
          if (
            transaction.config.amount_to == existingTransaction.config.amount_to
          ) {
            similarityCount++;
          }
          if (
            transaction.config.account_from?.id ==
            existingTransaction.config.account_from.id
          ) {
            similarityCount++;
          }
          if (
            transaction.config.account_to?.id ==
            existingTransaction.config.account_to.id
          ) {
            similarityCount++;
          }

          if (similarityCount / maxSimilarity > 0.5) {
            transaction.similarTransactions.push(
              Object.assign(
                { similarityScore: similarityCount / maxSimilarity },
                existingTransaction,
              ),
            );
          }
        });

        // Loop the array of schedules to find matches
        transaction.relatedSchedules = [];
        window.schedules.forEach(function (schedule) {
          // Calculate similarity between transactions using amount and accounts

          // Transaction types must match
          if (
            transaction.transaction_type.name !== schedule.transaction_type.name
          ) {
            return;
          }

          // Other fields count towards similarity
          let similarityCount = 0;
          const maxSimilarity = 4;

          if (
            toIsoDateString(transaction.date) ===
            toIsoDateString(schedule.schedule_config.next_date)
          ) {
            similarityCount++;
          }
          if (transaction.config.amount_to == schedule.config.amount_to) {
            similarityCount++;
          }
          if (
            transaction.config.account_from &&
            transaction.config.account_from.id ==
              schedule.config.account_from.id
          ) {
            similarityCount++;
          }
          if (
            transaction.config.account_to &&
            transaction.config.account_to.id == schedule.config.account_to.id
          ) {
            similarityCount++;
          }

          if (similarityCount / maxSimilarity > 0.5) {
            transaction.relatedSchedules.push(
              Object.assign(
                { similarityScore: similarityCount / maxSimilarity },
                schedule,
              ),
            );
          }
        });

        return transaction;
      });
    })
    .finally(() => {
      table.clear().rows.add(transactions).draw();
    });
}

// Function to refill the unmatched rows table
function refillUnmatchedRows(data) {
  let head = document.getElementById('unmatched_table_head');
  let body = document.getElementById('unmatched_table_body');

  // Reset head and body
  head.innerHTML = '';
  body.innerHTML = '';

  if (data.length === 0) {
    return;
  }

  // Add headings
  let headers = Object.keys(data[0]);
  let headerRow = document.createElement('tr');
  headers.forEach((headerText) => {
    let header = document.createElement('th');
    let textNode = document.createTextNode(headerText);
    header.appendChild(textNode);
    headerRow.appendChild(header);
  });
  head.appendChild(headerRow);

  // Add rows
  data.forEach((emp) => {
    let row = document.createElement('tr');
    Object.values(emp).forEach((text) => {
      let cell = document.createElement('td');
      let textNode = document.createTextNode(text);
      cell.appendChild(textNode);
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

$('#import_profile')
  .select2({
    multiple: false,
    ajax: {
      url: '/api/import/csv/profiles',
      dataType: 'json',
      delay: 150,
      data: function (params) {
        return {
          q: params.term,
        };
      },
      processResults: function (data) {
        const results = [
          {
            id: addNewProfileOptionId,
            text: '+ Add new profile',
          },
        ];

        results.push(
          ...data.map(function (profile) {
            let label = profile.name;
            if (profile.is_default) {
              label += ' (' + __('default') + ')';
            }
            return {
              id: profile.id,
              text: label,
            };
          }),
        );

        return {
          results: results,
        };
      },
      cache: true,
    },
    selectOnClose: false,
    placeholder: 'Select import profile',
    allowClear: true,
  })
  .on('select2:select', async function (e) {
    if (String(e.params.data.id) === addNewProfileOptionId) {
      delete document.getElementById('csv_file').dataset.importProfileId;
      selectedImportProfile = null;
      setSectionVisibility(aiAssistantSectionSelector, true);
      document.getElementById('ai_dsl_input').value = '';
      setAiDslStatus(
        'New profile mode enabled. Configure DSL and click Save to selected profile.',
        'muted',
      );
      return;
    }

    setSectionVisibility(aiAssistantSectionSelector, false);
    // Keep selected profile ID for profile-based parsing.
    document.getElementById('csv_file').dataset.importProfileId =
      e.params.data.id;

    try {
      const profile = await loadImportProfile(e.params.data.id);
      document.getElementById('ai_dsl_input').value =
        profileDslToTextareaValue(profile);
      setAiDslStatus('Import profile loaded.', 'muted');
    } catch (error) {
      setAiDslStatus(error.message, 'danger');
    }
  })
  .on('select2:unselect', function () {
    delete document.getElementById('csv_file').dataset.importProfileId;
    selectedImportProfile = null;
    setSectionVisibility(aiAssistantSectionSelector, false);
  })
  .on('select2:clear', function () {
    delete document.getElementById('csv_file').dataset.importProfileId;
    selectedImportProfile = null;
    setSectionVisibility(aiAssistantSectionSelector, false);
  });

document
  .getElementById('ai_generate_prompt')
  .addEventListener('click', function () {
    if (!window.csvSampleRows || window.csvSampleRows.length === 0) {
      setAiDslStatus(
        'Load a CSV file first to generate a prompt from sample rows.',
        'warning',
      );
      return;
    }

    refreshPromptFromCurrentPreview();
    setAiDslStatus('Prompt regenerated from current sample rows.', 'success');
  });

document
  .getElementById('ai_copy_prompt')
  .addEventListener('click', async () => {
    const promptText = document.getElementById('ai_dsl_prompt_output').value;
    if (!promptText.trim()) {
      setAiDslStatus('Prompt is empty.', 'warning');
      return;
    }

    try {
      await navigator.clipboard.writeText(promptText);
      setAiDslStatus('Prompt copied to clipboard.', 'success');
    } catch (_error) {
      setAiDslStatus('Unable to copy prompt to clipboard.', 'danger');
    }
  });

document.getElementById('ai_validate_dsl').addEventListener('click', () => {
  try {
    const dslPayload = parseAiDslInput(
      document.getElementById('ai_dsl_input').value,
    );

    if (!window.csvParsedRows || window.csvParsedRows.length === 0) {
      setAiDslStatus(
        'DSL JSON is valid. Load a CSV file to run preview scan.',
        'success',
      );
      return;
    }

    const previewResult = runDslPreviewScan(dslPayload);
    window.dslPreviewMatchedRows = previewResult.matchedRows;
    window.dslPreviewUnmatchedEntries = previewResult.unmatchedRows;

    // Keep issue marks only for rows that are still matched in current preview.
    const matchedIndexes = new Set(
      previewResult.matchedRows.map((entry) => String(entry.index)),
    );
    Object.keys(window.dslPreviewIssueRows).forEach((rowIndex) => {
      if (!matchedIndexes.has(rowIndex)) {
        delete window.dslPreviewIssueRows[rowIndex];
      }
    });

    // Add new unmatched rows to prompt memory.
    // First test run: collect all unique values from strict column.
    // Next runs: collect up to aiPromptExtraUnmatchedRowsCount unique rows.
    const nextPromptSelection = pickNextPromptUnmatchedEntries(
      previewResult.unmatchedRows,
      previewResult.strictColumns,
      aiPromptExtraUnmatchedRowsCount,
    );
    const nextPromptEntries = nextPromptSelection.selectedEntries;
    window.dslPreviewPromptStrictValueKeys =
      nextPromptSelection.usedStrictValueKeys;
    nextPromptEntries.forEach((entry) => {
      window.dslPreviewPromptUnmatchedIndexes.push(entry.index);
      window.dslPreviewPromptUnmatchedRows.push(entry.row);
    });
    updateDslStatusStateFromPreview(dslPayload, previewResult);

    refillDslPreviewMatchedRowsTable(previewResult.matchedRows);
    setSectionVisibility(
      dslPreviewMatchedSectionSelector,
      previewResult.matchedRows.length > 0,
    );
    const previewUnmatchedRows = previewResult.unmatchedRows.map(
      (entry) => entry.row,
    );
    if (previewUnmatchedRows.length > 0) {
      refillUnmatchedRows(previewUnmatchedRows);
      setSectionVisibility(unmatchedRowsSectionSelector, true);
    } else {
      clearUnmatchedRowsTable();
      setSectionVisibility(unmatchedRowsSectionSelector, false);
    }

    const promptRows = refreshPromptFromCurrentPreview();

    const broadAmountHint =
      previewResult.matchedRows.length === previewResult.totalRows &&
      hasBroadAmountTransactionTypeRules(dslPayload)
        ? ' All rows matched; broad amount-based rules (e.g., Kwota_regex/amount_regex) may be matching every row.'
        : '';
    const strictColumnsHint =
      previewResult.strictColumns.length > 0
        ? ' Strict columns active: ' +
          previewResult.strictColumns.join(', ') +
          '.'
        : ' No strict source column detected. Set column_mapping.type to enable strict type-based matching.';
    const issueRowsHint =
      promptRows.flaggedRows.length > 0
        ? ' Flagged rows sent to prompt: ' + promptRows.flaggedRows.length + '.'
        : '';
    const iterationHint =
      nextPromptEntries.length > 0
        ? nextPromptSelection.selectedAllUniqueStrictValues
          ? ' First test run: added all unmatched rows with unique values from strict column "' +
            (nextPromptSelection.strictColumn || 'n/a') +
            '" (' +
            nextPromptEntries.length +
            ' rows, prompt unmatched total: ' +
            window.dslPreviewPromptUnmatchedRows.length +
            ').'
          : ' Added ' +
            nextPromptEntries.length +
            ' new unmatched rows in this test run based on unique strict values from "' +
            (nextPromptSelection.strictColumn || 'n/a') +
            '" (prompt unmatched total: ' +
            window.dslPreviewPromptUnmatchedRows.length +
            ').'
        : ' No new unmatched rows added in this test run.';

    setAiDslStatus(
      'DSL JSON is valid. Preview scan matched ' +
        previewResult.matchedRows.length +
        '/' +
        previewResult.totalRows +
        ' rows. Prompt unmatched total: ' +
        promptRows.promptUnmatchedRows.length +
        '.' +
        iterationHint +
        strictColumnsHint +
        issueRowsHint +
        broadAmountHint,
      'success',
    );
  } catch (error) {
    clearUnmatchedRowsTable();
    clearDslPreviewMatchedRowsTable();
    updateDslPreviewFiltersStatus();
    setSectionVisibility(dslPreviewMatchedSectionSelector, false);
    setSectionVisibility(unmatchedRowsSectionSelector, false);
    window.dslStatusState.matchedRows = null;
    window.dslStatusState.unmatchedRows = null;
    window.dslStatusState.strictFields = [];
    renderDslStatusTable();
    setAiDslStatus(error.message, 'danger');
  }
});

$('#dsl_preview_clear_filters').on('click', function () {
  clearDslPreviewFilters();
  refillDslPreviewMatchedRowsTable(window.dslPreviewMatchedRows ?? []);
  refreshPromptFromCurrentPreview();
  setAiDslStatus('DSL preview filters cleared.', 'muted');
});

$(document).on(
  'change',
  '#dsl_preview_matched_table .dsl-preview-select-row',
  function () {
    const rowIndex = Number(this.dataset.rowIndex);
    if (!Number.isFinite(rowIndex)) {
      return;
    }

    setDslPreviewRowSelected(rowIndex, this.checked);
    updateDslPreviewSelectionSummary();
  },
);

$(document).on('change', '#dsl_preview_select_all', function () {
  const isChecked = this.checked;
  const visibleRowIndexes = getVisibleDslPreviewRowIndexes();
  visibleRowIndexes.forEach((rowIndex) => {
    setDslPreviewRowSelected(rowIndex, isChecked);
  });

  document
    .querySelectorAll('#dsl_preview_matched_table .dsl-preview-select-row')
    .forEach((checkbox) => {
      checkbox.checked = isChecked;
    });

  updateDslPreviewSelectionSummary();
});

$(document).on(
  'click',
  '#dsl_preview_matched_table .dsl-cell-filter-include',
  function () {
    const column = String(this.dataset.column ?? '');
    const value = String(this.dataset.value ?? '');
    if (!column) {
      return;
    }

    addDslPreviewFilterValue('include', column, value);
    removeDslPreviewFilterValue('exclude', column, value);

    refillDslPreviewMatchedRowsTable(window.dslPreviewMatchedRows ?? []);
    setAiDslStatus(
      'Added include filter: ' + column + ' = "' + value + '".',
      'muted',
    );
  },
);

$(document).on(
  'click',
  '#dsl_preview_matched_table .dsl-cell-filter-exclude',
  function () {
    const column = String(this.dataset.column ?? '');
    const value = String(this.dataset.value ?? '');
    if (!column) {
      return;
    }

    addDslPreviewFilterValue('exclude', column, value);
    removeDslPreviewFilterValue('include', column, value);

    refillDslPreviewMatchedRowsTable(window.dslPreviewMatchedRows ?? []);
    setAiDslStatus(
      'Added exclude filter: ' + column + ' != "' + value + '".',
      'muted',
    );
  },
);

$(document).on(
  'input',
  '#dsl_preview_matched_table .dsl-preview-issue-reason',
  function () {
    const rowIndex = Number(this.dataset.rowIndex);
    if (!Number.isFinite(rowIndex)) {
      return;
    }

    setDslPreviewIssueState(rowIndex, this.value);

    const promptRows = refreshPromptFromCurrentPreview();

    setAiDslStatus(
      'Issue description saved. Flagged rows added to AI prompt: ' +
        promptRows.flaggedRows.length +
        '.',
      'success',
    );
  },
);

document
  .getElementById('ai_import_matched_dsl')
  .addEventListener('click', importSelectedDslPreviewRows);

document
  .getElementById('import_all_quick_transactions')
  .addEventListener('click', importAllAcceptedTransactions);

document
  .getElementById('ai_save_dsl_profile')
  .addEventListener('click', saveDslToSelectedProfile);

setAiDslStatus('Load a CSV file to generate an AI prompt.', 'muted');
updateDslPreviewFiltersStatus();
updateDslPreviewSelectionSummary();
updateCsvImportSummary(0, 0, 0);
setSectionVisibility(aiAssistantSectionSelector, false);
resetDslStatusState(0);

// Select 2 functionality for account select
$('#account')
  .select2({
    multiple: false,
    ajax: {
      url: '/api/assets/account',
      dataType: 'json',
      delay: 150,
      data: function (params) {
        return {
          q: params.term,
        };
      },
      processResults: function (data) {
        return {
          results: data.map(function (account) {
            return {
              id: account.id,
              text: account.name,
            };
          }),
        };
      },
      cache: true,
    },
    selectOnClose: false,
    placeholder: 'Select account',
    allowClear: true,
  })
  .on('select2:select', function (e) {
    $.ajax({
      url: '/api/assets/account/' + e.params.data.id,
      data: {
        _token: csrfToken,
      },
    }).done((data) => {
      window.account_currency = data.config.currency;

      // Enable the file input
      document.getElementById('csv_file').disabled = false;
    });
  })
  .on('select2:unselect', function (e) {
    window.account_currency = {};

    // Disable the file input
    document.getElementById('csv_file').disabled = true;
  });

const tableSelector = '#dataTable';

window.table = $(tableSelector).DataTable({
  data: window.transactions,
  columns: [
    {
      data: 'date',
      title: 'Date',
      render: function (data) {
        if (!data) {
          return data;
        }
        return data.toLocaleDateString(window.YAFFA.locale);
      },
      className: 'dt-nowrap',
    },
    {
      title: 'Type',
      render: function (_data, _type, row) {
        return dataTableHelpers.transactionTypeIcon(
          row.transaction_config_type,
          row.transaction_type.name,
        );
      },
      className: 'text-center',
    },
    {
      title: 'From',
      render: function (_data, _type, row) {
        if (row.config && row.config.account_from) {
          return row.config.account_from.name;
        }

        return 'Not set';
      },
    },
    {
      title: 'To',
      render: function (_data, _type, row) {
        if (row.config && row.config.account_to) {
          return row.config.account_to.name;
        }

        return 'Not set';
      },
    },
    {
      title: 'Default category',
      render: function (_data, _type, row) {
        // No default category for transfers
        if (row.transaction_type.name === 'transfer') {
          return 'Not applicable';
        }

        // Set the relevant account type based on the transaction type
        const accountType =
          row.transaction_type.name === 'deposit'
            ? 'account_from'
            : 'account_to';
        // Check if payee is set
        if (!row.config[accountType]) {
          return 'Not set';
        }

        // Check if default category is set for the payee
        if (!row.config[accountType].config.category) {
          return 'Not set';
        }

        return row.config[accountType].config.category.full_name;
      },
      orderable: false,
    },
    {
      title: 'Amount',
      render: function (_data, _type, row) {
        if (!row.config.amount_to) {
          return 'Not set';
        }
        let prefix = '';
        if (row.transaction_type.amount_multiplier === -1) {
          prefix = '- ';
        }
        if (row.transaction_type.amount_multiplier === 1) {
          prefix = '+ ';
        }
        return (
          prefix +
          toFormattedCurrency(
            row.config.amount_to,
            window.YAFFA.locale,
            window.account_currency,
          )
        );
      },
      className: 'dt-nowrap',
    },
    {
      title: 'Comment',
      data: 'comment',
      render: function (data) {
        // Empty
        if (!data) {
          return 'Not set';
        }

        return data;
      },
    },
    {
      title: 'Similar transactions',
      data: 'similarTransactions',
      render: function (data, type) {
        if (type === 'filter') {
          return data && data.length > 0 ? 'Yes' : 'No';
        }

        // Display

        // Initial unset value
        if (data === false) {
          return '<i class="fa fa-spinner fa-spin"></i>';
        }

        if (!data || data.length === 0) {
          return 'Not found';
        }

        let html = '';
        data.forEach(function (similarTransaction) {
          html +=
            '<button class="btn btn-sm ' +
            (similarTransaction.similarityScore === 1
              ? 'btn-success'
              : 'btn-warning') +
            ' transaction-similar transaction-basic transaction-quickview" data-id="' +
            similarTransaction.id +
            '" type="button"><i class="fa fa-fw fa-eye" title="Quick view"></i></button> ';
        });

        return html;
      },
    },
    {
      title: 'Related schedules',
      data: 'relatedSchedules',
      render: function (data, type, row) {
        if (type === 'filter') {
          return data && data.length > 0 ? 'Yes' : 'No';
        }

        // Display

        // Initial unset value
        if (data === false) {
          return '<i class="fa fa-spinner fa-spin"></i>';
        }

        if (!data || data.length === 0) {
          return 'Not found';
        }

        var html = '';
        data.forEach(function (relatedTransaction) {
          html +=
            '<button class="btn btn-sm ' +
            (relatedTransaction.similarityScore === 1
              ? 'btn-success'
              : 'btn-warning') +
            ' transaction-related transaction-quickview" data-draft="' +
            row.draftId +
            '" data-id="' +
            relatedTransaction.id +
            '" type="button"><i class="fa fa-fw fa-eye" title="Quick view"></i></button> ';
        });

        return html;
      },
    },
    {
      title: 'Handled',
      data: 'handled',
      render: function (data, type) {
        return dataTableHelpers.booleanToTableIcon(data, type);
      },
      className: 'text-center',
    },
    {
      title: 'Actions',
      data: 'draftId',
      orderable: false,
      render: function (data, _type, row) {
        return (
          '<button class="btn btn-xs btn-primary create-transaction-from-draft" data-draft="' +
          data +
          '" type="button" title="' +
          __('Quick create') +
          '"><i class="fa fa-fw fa-plus"></i></button> ' +
          (row.quickRecordingPossible
            ? '<button class="btn btn-xs btn-success record" data-draft="' +
              data +
              '" type="button" title="' +
              __('Create from existing values') +
              '"><i class="fa fa-fw fa-bolt"></i></button> '
            : '') +
          '<button class="btn btn-xs btn-info handled" data-draft="' +
          data +
          '" type="button" title="' +
          __('Mark as handled') +
          '"><i class="fa fa-fw fa-check"></i></button> '
        );
      },
    },
  ],
  createdRow: function (row, data) {
    // Account from name
    dataTableHelpers.muteCellWithValue($('td:eq(2)', row), 'Not set');
    // Account to name
    dataTableHelpers.muteCellWithValue($('td:eq(3)', row), 'Not set');
    // Default category
    dataTableHelpers.muteCellWithValue($('td:eq(4)', row), 'Not set');
    dataTableHelpers.muteCellWithValue($('td:eq(4)', row), 'Not applicable');
    // Comment
    if (!data.comment) {
      $('td:eq(6)', row).addClass('text-muted text-italic');
    }
    //Similar transactions
    dataTableHelpers.muteCellWithValue($('td:eq(7)', row), 'Not found');
    //Related schedules
    dataTableHelpers.muteCellWithValue($('td:eq(8)', row), 'Not found');
  },
  // Apply initial filters
  initComplete: function () {
    // Initially filter by handled
    $(tableSelector).DataTable().column(9).search('No').draw();
  },
});

// Set up event listener that stores the currently selected transaction and dispatches an event
$(tableSelector).on(
  'click',
  'button.create-transaction-from-draft',
  function () {
    // TODO: should this data passed back and forth instead of storing it?
    recentTransactionDraftId = Number($(this).data('draft'));

    // Retrieve the transaction draft based on stored draft ID
    const draft = window.transactions.find(
      (transaction) => transaction.draftId === recentTransactionDraftId,
    );
    const transaction = Object.assign({}, draft);

    // Some transformations
    // TODO: these variations should be unified at source
    transaction.transaction_items = [];
    // Should not cause any problems, but does not needed for the form either
    delete transaction.similarTransactions;
    delete transaction.relatedSchedules;

    // Dispatch event
    const event = new CustomEvent('initiateCreateFromDraft', {
      detail: {
        transaction: transaction,
        type: 'standard',
      },
    });
    window.dispatchEvent(event);
  },
);

// Quick view for similar transactions
// Initiate display, without any actions
$(tableSelector).on(
  'click',
  'button.transaction-similar.transaction-basic.transaction-quickview',
  function () {
    let icon = this.querySelector('i');
    // If spinner is displayed, do not initiate another request
    if (icon.classList.contains('fa-spinner')) {
      return false;
    }

    const originalIconClass = icon.className;
    icon.className = 'fa fa-fw fa-spin fa-spinner';

    fetch('/api/transaction/' + this.dataset.id)
      .then(function (response) {
        if (!response.ok) {
          throw Error(response.statusText);
        }
        return response;
      })
      .then((response) => response.json())
      .then(function (data) {
        let transaction = data.transaction;

        // Convert dates to Date objects
        if (transaction.date) {
          transaction.date = new Date(transaction.date);
        }
        if (transaction.transaction_schedule) {
          if (transaction.transaction_schedule.start_date) {
            transaction.transaction_schedule.start_date = new Date(
              transaction.transaction_schedule.start_date,
            );
          }
          if (transaction.transaction_schedule.end_date) {
            transaction.transaction_schedule.end_date = new Date(
              transaction.transaction_schedule.end_date,
            );
          }
          if (transaction.transaction_schedule.next_date) {
            transaction.transaction_schedule.next_date = new Date(
              transaction.transaction_schedule.next_date,
            );
          }
        }

        // Emit global event for modal to display
        let event = new CustomEvent('showTransactionQuickViewModal', {
          detail: {
            transaction: transaction,
            controls: {
              show: false,
              edit: false,
              clone: false,
              skip: false,
              enter: false,
              delete: false,
            },
          },
        });
        window.dispatchEvent(event);
      })
      .catch((error) => {
        console.log(error);
      })
      .finally(() => {
        icon.className = originalIconClass;
      });
  },
);

// Quick view for related schedules
// Initiate display and store draft id
// TODO: unify functionality with similar transaction display
$(tableSelector).on(
  'click',
  'button.transaction-related.transaction-quickview',
  function () {
    window.recentTransactionDraftId = $(this).data('draft');

    let icon = this.querySelector('i');
    // If spinner is displayed, do not initiate another request
    if (icon.classList.contains('fa-spinner')) {
      return false;
    }

    const originalIconClass = icon.className;
    icon.className = 'fa fa-fw fa-spin fa-spinner';

    fetch('/api/transaction/' + this.dataset.id)
      .then(function (response) {
        if (!response.ok) {
          throw Error(response.statusText);
        }
        return response;
      })
      .then((response) => response.json())
      .then(function (data) {
        let transaction = data.transaction;

        // Convert dates to Date objects
        if (transaction.date) {
          transaction.date = new Date(transaction.date);
        }
        if (transaction.transaction_schedule) {
          if (transaction.transaction_schedule.start_date) {
            transaction.transaction_schedule.start_date = new Date(
              transaction.transaction_schedule.start_date,
            );
          }
          if (transaction.transaction_schedule.end_date) {
            transaction.transaction_schedule.end_date = new Date(
              transaction.transaction_schedule.end_date,
            );
          }
          if (transaction.transaction_schedule.next_date) {
            transaction.transaction_schedule.next_date = new Date(
              transaction.transaction_schedule.next_date,
            );
          }
        }

        // Emit global event for modal to display
        let event = new CustomEvent('showTransactionQuickViewModal', {
          detail: {
            transaction: transaction,
            controls: {
              show: false,
              edit: false,
              clone: false,
              skip: true,
              enter: true,
              delete: false,
            },
          },
        });
        window.dispatchEvent(event);
      })
      .catch((error) => {
        console.log(error);
      })
      .finally(() => {
        icon.className = originalIconClass;
      });
  },
);

// Set up an event listener for the recently created transaction
window.addEventListener('transaction-created', function (event) {
  // Add the newly created transaction as a similar transaction to the current one
  let transaction = window.transactions.find(
    (transaction) => transaction.draftId == recentTransactionDraftId,
  );
  transaction.similarTransactions.push(event.detail.transaction);

  // Also mark the transaction as being handled by the user
  transaction.handled = true;

  // Update the table
  window.table.clear().rows.add(window.transactions).draw();
  updateQuickImportButtonState();
  updateDslPreviewSelectionSummary();
});

// Set up an event listener for immediately creating a transaction
$(tableSelector).on('click', 'button.record', async function () {
  const draftId = Number($(this).data('draft'));
  if (!Number.isFinite(draftId)) {
    return;
  }
  recentTransactionDraftId = draftId;

  const result = await quickImportDraftTransaction(draftId, {
    showToast: true,
  });
  if (!result.ok) {
    setAiDslStatus(result.message, 'warning');
    console.error(result.message);
    return;
  }

  window.table.clear().rows.add(window.transactions).draw();
  updateQuickImportButtonState();
  updateDslPreviewSelectionSummary();
});

// Event listener for marking a transaction as handled
$(tableSelector).on('click', 'button.handled', function () {
  let transactionId = $(this).data('draft');
  let transaction = window.transactions.find(
    (transaction) => transaction.draftId == transactionId,
  );
  transaction.handled = true;
  window.table.clear().rows.add(window.transactions).draw();

  // Remove this button from the table
  $(this).remove();
  updateQuickImportButtonState();
  updateDslPreviewSelectionSummary();
});

// Set up filtering
$('input[name=has_similar]').on('change', function () {
  table.column(7).search(this.value).draw();
});
$('input[name=handled]').on('change', function () {
  table.column(9).search(this.value).draw();
});

// Form reset functionality
$('#reset').on('click', function () {
  // Confirm the reset
  if (!confirm('Are you sure you want to reset the form?')) {
    return;
  }

  // Reset select2
  $('#account').val(null).trigger('change');
  $('#import_profile').val(null).trigger('change');

  // Reset file input and make it disabled
  $('#csv_file').val(null);
  $('#csv_file').prop('disabled', true);
  delete document.getElementById('csv_file').dataset.importProfileId;

  // Reset global variables
  window.recentTransactionDraftId = null;
  window.transactions = [];
  window.account_currency = {};
  window.unmatchedRows = [];
  window.csvParsedRows = [];
  window.csvSampleRows = [];
  window.csvHeaders = [];
  window.dslPreviewMatchedRows = [];
  window.dslPreviewUnmatchedEntries = [];
  window.dslPreviewPromptUnmatchedRows = [];
  window.dslPreviewPromptUnmatchedIndexes = [];
  window.dslPreviewPromptStrictValueKeys = [];
  window.dslPreviewIssueRows = {};
  window.dslPreviewSelectedRows = {};
  window.csvDraftsReady = false;
  window.dslBulkImportInProgress = false;
  clearDslPreviewFilters();
  selectedImportProfile = null;
  document.getElementById('ai_dsl_prompt_output').value = '';
  document.getElementById('ai_dsl_input').value = '';
  updateDslPreviewFiltersStatus();
  updateCsvImportSummary(0, 0, 0);
  clearDslPreviewMatchedRowsTable();
  setSectionVisibility(dslPreviewMatchedSectionSelector, false);
  setSectionVisibility(aiAssistantSectionSelector, false);
  resetDslStatusState(0);
  setAiDslStatus('Form reset.', 'muted');

  // Reset the main DataTable
  table.clear().rows.add(transactions).draw();

  // Reset table sections
  clearUnmatchedRowsTable();
  setSectionVisibility(identifiedTransactionsSectionSelector, false);
  setSectionVisibility(unmatchedRowsSectionSelector, false);
  updateQuickImportButtonState();
});

// Load active schedules via API
fetch('/api/transactions/get_scheduled_items/schedule')
  .then((response) => response.json())
  .then((data) => {
    window.schedules = data.transactions
      // Take only standard transaction (ignore investments)
      .filter(
        (transaction) => transaction.transaction_config_type === 'standard',
      )
      // Take only transactions with a next date
      .filter((transaction) => transaction.schedule_config.next_date)
      .map(function (transaction) {
        transaction.schedule_config.start_date = new Date(
          transaction.schedule_config.start_date,
        );
        if (transaction.schedule_config.next_date) {
          transaction.schedule_config.next_date = new Date(
            transaction.schedule_config.next_date,
          );
        }
        if (transaction.schedule_config.end_date) {
          transaction.schedule_config.end_date = new Date(
            transaction.schedule_config.end_date,
          );
        }

        // Create rule
        transaction.schedule_config.rule = new RRule({
          freq: RRule[transaction.schedule_config.frequency],
          interval: transaction.schedule_config.interval,
          dtstart: transaction.schedule_config.start_date,
          until: transaction.schedule_config.end_date,
        });

        transaction.schedule_config.active =
          !!transaction.schedule_config.rule.after(new Date(), true);

        return transaction;
      })
      .filter(function (transaction) {
        return transaction.schedule_config.active;
      });
  })
  .catch((error) => {
    console.error(error);
  });

// Initialize Vue for the quick view
import { createApp } from 'vue';

const app = createApp({});

// Add global translator function
app.config.globalProperties.__ = window.__;

import TransactionShowModal from './../components/TransactionDisplay/Modal.vue';
import TransactionCreateModal from './../components/TransactionForm/ModalStandard.vue';

app.component('transaction-show-modal', TransactionShowModal);
app.component('transaction-create-standard-modal', TransactionCreateModal);

app.mount('#app');
