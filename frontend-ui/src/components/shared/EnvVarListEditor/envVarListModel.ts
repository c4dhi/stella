/**
 * Pure, framework-free core for the shared env-var list editor.
 *
 * All add/update/delete/validation/reconciliation logic lives here so it can be
 * unit-tested without a DOM (matching the repo's existing pure-function test
 * style, e.g. PromptComposer.test.ts). The React hook (useEnvVarListEditor) is a
 * thin wrapper over these functions.
 */
import { generateUUID } from '../../../lib/uuid'

/** Where a row came from. Drives lockability and badges in the UI. */
export type EnvVarOrigin = 'required' | 'optional' | 'custom'

export interface EnvVarRow {
  id: string // stable for the lifetime of the row (never derived from index)
  key: string
  value: string
  origin: EnvVarOrigin
  /**
   * Edit mode only: this key already exists server-side with an encrypted value
   * that is never returned to the browser. A blank input therefore means "keep
   * the stored value", not "set empty". Becomes false once the user types.
   */
  valuePreserved: boolean
}

export type EditorMode = 'create' | 'edit'

/** Env var keys are conventionally SCREAMING_SNAKE_CASE. */
export const ENV_KEY_PATTERN = /^[A-Z0-9_]+$/

/**
 * Normalize a key to a valid form. Used only by the explicit "Fix" action.
 * Separators (dashes, dots, spaces, …) collapse to a single underscore so
 * `API-KEY` becomes `API_KEY` rather than the lossy `APIKEY`.
 */
export function normalizeKey(key: string): string {
  return key
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function makeRow(
  key: string,
  value: string,
  origin: EnvVarOrigin,
  valuePreserved = false,
): EnvVarRow {
  return { id: generateUUID(), key, value, origin, valuePreserved }
}

export interface BuildInitialRowsOptions {
  requiredKeys?: string[]
  optionalKeys?: string[]
  /** Pre-existing custom key/value pairs (template prefill, or existing template keys in edit mode). */
  initial?: Record<string, string>
  mode?: EditorMode
}

/**
 * Build the initial ordered row list: declared required keys first, then declared
 * optional keys, then any remaining custom keys from `initial`. Declared keys take
 * their value from `initial` when present. In edit mode, rows with no provided
 * value are marked `valuePreserved` (their stored value is kept untouched).
 */
export function buildInitialRows({
  requiredKeys = [],
  optionalKeys = [],
  initial = {},
  mode = 'create',
}: BuildInitialRowsOptions): EnvVarRow[] {
  const rows: EnvVarRow[] = []
  const used = new Set<string>()

  const pushDeclared = (key: string, origin: EnvVarOrigin) => {
    if (used.has(key)) return
    used.add(key)
    const hasValue = key in initial
    const value = hasValue ? initial[key] : ''
    // In edit mode a declared key that came from the server with no plaintext is preserved.
    const preserved = mode === 'edit' && hasValue && value === ''
    rows.push(makeRow(key, value, origin, preserved))
  }

  requiredKeys.forEach((k) => pushDeclared(k, 'required'))
  optionalKeys.forEach((k) => pushDeclared(k, 'optional'))

  // Remaining custom keys, preserving insertion order of `initial`.
  Object.keys(initial).forEach((key) => {
    if (used.has(key)) return
    used.add(key)
    const value = initial[key]
    const preserved = mode === 'edit' && value === ''
    rows.push(makeRow(key, value, 'custom', preserved))
  })

  if (rows.length === 0) {
    // Always start with at least one editable blank custom row to fill.
    rows.push(makeRow('', '', 'custom'))
  }

  return rows
}

export interface EnvVarValidation {
  duplicateIds: Set<string>
  invalidKeyIds: Set<string>
  emptyKeyIds: Set<string> // blank key but a value was entered
  missingValueIds: Set<string> // value required (declared) but empty — only when !allowEmptyValues
  isValid: boolean
}

export interface ValidateOptions {
  /** Create-template allows empty values; deploy requires declared values to be filled. */
  allowEmptyValues?: boolean
  /**
   * Edit mode after the variable set was touched: the backend does a full replace,
   * so EVERY key (including server-preserved ones) must carry a value. Overrides
   * `allowEmptyValues` for all non-blank-key rows.
   */
  requireAllValues?: boolean
}

export function validateRows(
  rows: EnvVarRow[],
  { allowEmptyValues = true, requireAllValues = false }: ValidateOptions = {},
): EnvVarValidation {
  const duplicateIds = new Set<string>()
  const invalidKeyIds = new Set<string>()
  const emptyKeyIds = new Set<string>()
  const missingValueIds = new Set<string>()

  // Group by normalized (trimmed, upper) key to detect case-insensitive collisions.
  const byKey = new Map<string, EnvVarRow[]>()
  for (const row of rows) {
    const trimmed = row.key.trim()
    if (trimmed === '') {
      // Blank key is only an error if the user typed a value next to it.
      if (row.value.trim() !== '') emptyKeyIds.add(row.id)
      continue
    }
    if (!ENV_KEY_PATTERN.test(trimmed)) {
      invalidKeyIds.add(row.id)
    }
    const norm = trimmed.toUpperCase()
    const bucket = byKey.get(norm)
    if (bucket) bucket.push(row)
    else byKey.set(norm, [row])
  }

  for (const bucket of byKey.values()) {
    if (bucket.length > 1) {
      bucket.forEach((row) => duplicateIds.add(row.id))
    }
  }

  if (requireAllValues) {
    // Full-replace edit: every keyed row must carry a value (preserved no longer counts).
    for (const row of rows) {
      if (row.key.trim() === '') continue
      if (row.value.trim() === '') missingValueIds.add(row.id)
    }
  } else if (!allowEmptyValues) {
    for (const row of rows) {
      if (row.key.trim() === '') continue
      if (row.origin === 'custom') continue // optional user-added: empty allowed
      // Declared required rows must have a value, unless preserved from server.
      if (row.origin === 'required' && !row.valuePreserved && row.value.trim() === '') {
        missingValueIds.add(row.id)
      }
    }
  }

  const isValid =
    duplicateIds.size === 0 &&
    invalidKeyIds.size === 0 &&
    emptyKeyIds.size === 0 &&
    missingValueIds.size === 0

  return { duplicateIds, invalidKeyIds, emptyKeyIds, missingValueIds, isValid }
}

export interface ToVariablesMapOptions {
  mode?: EditorMode
  allowEmptyValues?: boolean
}

/**
 * Serialize rows into the `Record<string,string>` the API expects.
 * Returns null when the rows are invalid.
 *
 * In edit mode, rows whose value is still preserved (untouched) are omitted so
 * the backend keeps the existing encrypted value. Callers pair this with
 * `variablesTouched` to decide whether to send `variables` at all.
 */
export function toVariablesMap(
  rows: EnvVarRow[],
  { mode = 'create', allowEmptyValues = true }: ToVariablesMapOptions = {},
): Record<string, string> | null {
  const validation = validateRows(rows, { allowEmptyValues })
  if (!validation.isValid) return null

  const out: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (key === '') continue
    if (mode === 'edit' && row.valuePreserved && row.value === '') continue
    out[key] = row.value
  }
  return out
}

/**
 * Whether the variable set was meaningfully edited (used in edit mode to decide
 * if the PATCH should include `variables` at all). True when any value was
 * touched, any custom key exists, or the declared key set changed.
 */
export function hasVariableEdits(rows: EnvVarRow[], initialKeys: string[]): boolean {
  const initialSet = new Set(initialKeys)
  const currentKeys = rows.map((r) => r.key.trim()).filter((k) => k !== '')
  const currentSet = new Set(currentKeys)

  // Key set changed (added or removed).
  if (currentSet.size !== initialSet.size) return true
  for (const k of currentSet) if (!initialSet.has(k)) return true

  // Any value typed (preserved rows that were touched are no longer preserved).
  for (const row of rows) {
    if (row.key.trim() === '') continue
    if (!row.valuePreserved && row.value !== '') return true
    if (!row.valuePreserved && !initialSet.has(row.key.trim())) return true
  }
  return false
}

export interface ReconcileResult {
  rows: EnvVarRow[]
  /** True when the user already entered values or custom keys (caller should confirm before applying). */
  hasUserContent: boolean
}

/**
 * Reconcile the row list to a newly-selected agent type's declared vars.
 *
 * Guarantees:
 * - Adds the new type's declared keys (required then optional), empty.
 * - Reuses an existing row when the key already exists (preserving its value).
 * - Drops ONLY previously-declared rows that are still empty (auto-added by the
 *   prior type and never filled in).
 * - Never drops a row that has a value or is custom; a now-undeclared but valued
 *   row is re-tagged `origin:'custom'` so the user keeps it.
 */
export function reconcileAgentType(
  rows: EnvVarRow[],
  newRequiredKeys: string[],
  newOptionalKeys: string[],
): ReconcileResult {
  const hasUserContent =
    rows.some((r) => r.value.trim() !== '') ||
    rows.some((r) => r.origin === 'custom' && r.key.trim() !== '')

  const declaredOrigin = new Map<string, EnvVarOrigin>()
  newRequiredKeys.forEach((k) => declaredOrigin.set(k, 'required'))
  newOptionalKeys.forEach((k) => {
    if (!declaredOrigin.has(k)) declaredOrigin.set(k, 'optional')
  })

  // Index existing rows by trimmed key (keep first occurrence).
  const existingByKey = new Map<string, EnvVarRow>()
  for (const row of rows) {
    const key = row.key.trim()
    if (key !== '' && !existingByKey.has(key)) existingByKey.set(key, row)
  }

  const result: EnvVarRow[] = []
  const consumed = new Set<string>()

  // 1) Declared keys for the new type, in declared order.
  for (const [key, origin] of declaredOrigin) {
    consumed.add(key)
    const existing = existingByKey.get(key)
    if (existing) {
      result.push({ ...existing, origin, key })
    } else {
      result.push(makeRow(key, '', origin))
    }
  }

  // 2) Surviving rows that are NOT newly-declared.
  for (const row of rows) {
    const key = row.key.trim()
    if (key !== '' && consumed.has(key)) continue
    const wasDeclared = row.origin === 'required' || row.origin === 'optional'
    // Drop previously-declared rows that the user never filled in.
    if (wasDeclared && row.value.trim() === '') continue
    // Keep custom rows (incl. a blank trailing row) and any valued row;
    // re-tag a now-undeclared but valued row as custom so the user keeps it.
    result.push(wasDeclared ? { ...row, origin: 'custom' } : row)
  }

  // Ensure at least one editable row remains.
  if (result.length === 0) result.push(makeRow('', '', 'custom'))

  return { rows: result, hasUserContent }
}

/** Append a blank custom row; returns the new rows and the new row's id (for focus). */
export function appendBlankRow(rows: EnvVarRow[]): { rows: EnvVarRow[]; id: string } {
  const row = makeRow('', '', 'custom')
  return { rows: [...rows, row], id: row.id }
}

export function updateRowKey(rows: EnvVarRow[], id: string, key: string): EnvVarRow[] {
  return rows.map((r) => (r.id === id ? { ...r, key } : r))
}

export function updateRowValue(rows: EnvVarRow[], id: string, value: string): EnvVarRow[] {
  // Typing a value clears the "preserved" flag — it's now an explicit value.
  return rows.map((r) => (r.id === id ? { ...r, value, valuePreserved: false } : r))
}

export function removeRow(rows: EnvVarRow[], id: string): EnvVarRow[] {
  return rows.filter((r) => r.id !== id)
}

export function fixRowKey(rows: EnvVarRow[], id: string): EnvVarRow[] {
  return rows.map((r) => (r.id === id ? { ...r, key: normalizeKey(r.key) } : r))
}
