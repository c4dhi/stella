/**
 * Thin React wrapper over envVarListModel. Owns the row array as state and
 * exposes memoized actions + derived validation. All non-trivial logic lives in
 * the pure model so it stays unit-testable without a DOM.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  appendBlankRow,
  buildInitialRows,
  fixRowKey,
  hasVariableEdits,
  reconcileAgentType,
  removeRow as removeRowModel,
  toVariablesMap,
  updateRowKey,
  updateRowValue,
  validateRows,
  type BuildInitialRowsOptions,
  type EditorMode,
  type EnvVarRow,
  type EnvVarValidation,
} from './envVarListModel'

export interface UseEnvVarListEditorOptions extends BuildInitialRowsOptions {
  mode?: EditorMode
  /** Create-template allows empty values; deploy requires declared values to be filled. */
  allowEmptyValues?: boolean
  /**
   * Edit mode: once the variable set is touched the backend does a full replace,
   * so every key must carry a value. When true, validation enforces that as soon
   * as `variablesTouched` becomes true.
   */
  requireAllValuesWhenTouched?: boolean
}

export interface EnvVarListEditor {
  rows: EnvVarRow[]
  validation: EnvVarValidation
  /** Append a blank custom row and return its id (so the caller can focus it). */
  addRow: () => string
  updateKey: (id: string, key: string) => void
  updateValue: (id: string, value: string) => void
  removeRow: (id: string) => void
  fixKey: (id: string) => void
  /**
   * Reconcile to a newly-selected agent type's declared vars. Returns whether
   * the user had entered content (so the caller can confirm before applying) and
   * an `apply` thunk that performs the reconcile when the caller is ready.
   */
  applyAgentType: (
    requiredKeys: string[],
    optionalKeys: string[],
  ) => { hasUserContent: boolean; apply: () => void }
  /** Replace the entire row set (e.g. when switching template prefill). */
  reset: (options: UseEnvVarListEditorOptions) => void
  toVariablesMap: () => Record<string, string> | null
  /** Edit mode: whether `variables` should be sent in the PATCH at all. */
  variablesTouched: boolean
}

export function useEnvVarListEditor(options: UseEnvVarListEditorOptions = {}): EnvVarListEditor {
  const mode: EditorMode = options.mode ?? 'create'
  const allowEmptyValues = options.allowEmptyValues ?? true

  const [rows, setRows] = useState<EnvVarRow[]>(() => buildInitialRows({ ...options, mode }))
  // Keys the template started with (edit mode) — drives variablesTouched.
  const initialKeysRef = useRef<string[]>(
    Object.keys(options.initial ?? {}),
  )

  // Keep a ref so callbacks can read the latest rows without a stale closure.
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const variablesTouched = useMemo(
    () => hasVariableEdits(rows, initialKeysRef.current),
    [rows],
  )

  const requireAllValues = (options.requireAllValuesWhenTouched ?? false) && variablesTouched

  const validation = useMemo(
    () => validateRows(rows, { allowEmptyValues, requireAllValues }),
    [rows, allowEmptyValues, requireAllValues],
  )

  const addRow = useCallback(() => {
    const { rows: next, id } = appendBlankRow(rowsRef.current)
    setRows(next)
    return id
  }, [])

  const updateKey = useCallback((id: string, key: string) => {
    setRows((prev) => updateRowKey(prev, id, key))
  }, [])

  const updateValue = useCallback((id: string, value: string) => {
    setRows((prev) => updateRowValue(prev, id, value))
  }, [])

  const removeRow = useCallback((id: string) => {
    setRows((prev) => removeRowModel(prev, id))
  }, [])

  const fixKey = useCallback((id: string) => {
    setRows((prev) => fixRowKey(prev, id))
  }, [])

  const applyAgentType = useCallback((requiredKeys: string[], optionalKeys: string[]) => {
    const { rows: next, hasUserContent } = reconcileAgentType(
      rowsRef.current,
      requiredKeys,
      optionalKeys,
    )
    return { hasUserContent, apply: () => setRows(next) }
  }, [])

  const reset = useCallback((opts: UseEnvVarListEditorOptions) => {
    initialKeysRef.current = Object.keys(opts.initial ?? {})
    setRows(buildInitialRows({ ...opts, mode: opts.mode ?? mode }))
  }, [mode])

  const toMap = useCallback(
    () => toVariablesMap(rows, { mode, allowEmptyValues }),
    [rows, mode, allowEmptyValues],
  )

  return {
    rows,
    validation,
    addRow,
    updateKey,
    updateValue,
    removeRow,
    fixKey,
    applyAgentType,
    reset,
    toVariablesMap: toMap,
    variablesTouched,
  }
}
