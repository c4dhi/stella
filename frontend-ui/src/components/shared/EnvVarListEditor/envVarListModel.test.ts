import { describe, it, expect } from 'vitest'
import {
  buildInitialRows,
  validateRows,
  normalizeKey,
  toVariablesMap,
  hasVariableEdits,
  reconcileAgentType,
  appendBlankRow,
  updateRowKey,
  updateRowValue,
  removeRow,
  fixRowKey,
  type EnvVarRow,
} from './envVarListModel'

describe('buildInitialRows', () => {
  it('orders required, then optional, then custom keys', () => {
    const rows = buildInitialRows({
      requiredKeys: ['API_KEY'],
      optionalKeys: ['REGION'],
      initial: { EXTRA: 'v' },
    })
    expect(rows.map((r) => [r.key, r.origin])).toEqual([
      ['API_KEY', 'required'],
      ['REGION', 'optional'],
      ['EXTRA', 'custom'],
    ])
  })

  it('gives every row a unique id', () => {
    const rows = buildInitialRows({ requiredKeys: ['A', 'B', 'C'] })
    const ids = new Set(rows.map((r) => r.id))
    expect(ids.size).toBe(3)
  })

  it('starts with a single blank custom row when nothing is declared', () => {
    const rows = buildInitialRows({})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: '', value: '', origin: 'custom' })
  })

  it('marks edit-mode declared keys with no plaintext as preserved', () => {
    const rows = buildInitialRows({
      initial: { API_KEY: '' },
      mode: 'edit',
    })
    expect(rows[0]).toMatchObject({ key: 'API_KEY', valuePreserved: true })
  })

  it('orders template keys after declared keys and before custom', () => {
    const rows = buildInitialRows({
      requiredKeys: ['API_KEY'],
      optionalKeys: ['REGION'],
      templateKeys: ['OPENAI_KEY', 'MODEL'],
      initial: { EXTRA: 'v' },
    })
    expect(rows.map((r) => [r.key, r.origin])).toEqual([
      ['API_KEY', 'required'],
      ['REGION', 'optional'],
      ['OPENAI_KEY', 'template'],
      ['MODEL', 'template'],
      ['EXTRA', 'custom'],
    ])
  })

  it('renders template keys as preserved default rows (blank = use template value)', () => {
    const rows = buildInitialRows({ templateKeys: ['OPENAI_KEY'] })
    expect(rows[0]).toMatchObject({
      key: 'OPENAI_KEY',
      value: '',
      origin: 'template',
      valuePreserved: true,
    })
  })

  it('pre-fills a saved override on a template key (no longer preserved)', () => {
    const rows = buildInitialRows({
      templateKeys: ['OPENAI_KEY'],
      initial: { OPENAI_KEY: 'sk-override' },
    })
    expect(rows[0]).toMatchObject({
      key: 'OPENAI_KEY',
      value: 'sk-override',
      origin: 'template',
      valuePreserved: false,
    })
  })

  it('does not duplicate a key declared as both required and template', () => {
    const rows = buildInitialRows({
      requiredKeys: ['SHARED'],
      templateKeys: ['SHARED'],
    })
    expect(rows.filter((r) => r.key === 'SHARED')).toHaveLength(1)
    // required wins (seeded first)
    expect(rows[0].origin).toBe('required')
  })
})

describe('add / update / delete row identity', () => {
  it('delete-a-middle-row-then-add does not collide ids and edits the right row', () => {
    // Repro of the EnvVarBuilderModal index-based id bug.
    let rows = buildInitialRows({ initial: { A: '1', B: '2', C: '3' } })
    expect(rows).toHaveLength(3)

    // Delete the middle row (B).
    rows = removeRow(rows, rows[1].id)
    expect(rows.map((r) => r.key)).toEqual(['A', 'C'])

    // Add a new row.
    const added = appendBlankRow(rows)
    rows = added.rows
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length) // all unique

    // Edit the newly added row by its id — only that row changes.
    rows = updateRowKey(rows, added.id, 'D')
    rows = updateRowValue(rows, added.id, '4')
    expect(rows.find((r) => r.id === added.id)).toMatchObject({ key: 'D', value: '4' })
    expect(rows.find((r) => r.key === 'A')).toMatchObject({ value: '1' })
    expect(rows.find((r) => r.key === 'C')).toMatchObject({ value: '3' })
  })

  it('typing a value clears the preserved flag', () => {
    let rows = buildInitialRows({ initial: { API_KEY: '' }, mode: 'edit' })
    expect(rows[0].valuePreserved).toBe(true)
    rows = updateRowValue(rows, rows[0].id, 'secret')
    expect(rows[0]).toMatchObject({ value: 'secret', valuePreserved: false })
  })
})

describe('validateRows', () => {
  const row = (key: string, value = '', origin: EnvVarRow['origin'] = 'custom'): EnvVarRow => ({
    id: key + value + origin,
    key,
    value,
    origin,
    valuePreserved: false,
  })

  it('flags every row sharing a key, case-insensitively', () => {
    const rows = [row('API_KEY'), row('api_key'), row('OTHER')]
    const v = validateRows(rows)
    expect(v.duplicateIds.has(rows[0].id)).toBe(true)
    expect(v.duplicateIds.has(rows[1].id)).toBe(true)
    expect(v.duplicateIds.has(rows[2].id)).toBe(false)
    expect(v.isValid).toBe(false)
  })

  it('flags invalid key characters', () => {
    const rows = [row('API-KEY')]
    const v = validateRows(rows)
    expect(v.invalidKeyIds.has(rows[0].id)).toBe(true)
    expect(v.isValid).toBe(false)
  })

  it('flags a blank key only when a value was entered', () => {
    const blankNoValue = validateRows([row('', '')])
    expect(blankNoValue.emptyKeyIds.size).toBe(0)
    expect(blankNoValue.isValid).toBe(true)

    const blankWithValue = validateRows([row('', 'orphan')])
    expect(blankWithValue.emptyKeyIds.size).toBe(1)
    expect(blankWithValue.isValid).toBe(false)
  })

  it('allows empty values by default (create)', () => {
    const v = validateRows([row('API_KEY', '')])
    expect(v.isValid).toBe(true)
  })

  it('requires required-row values when allowEmptyValues is false (deploy)', () => {
    const rows = [row('API_KEY', '', 'required'), row('OPT', '', 'custom')]
    const v = validateRows(rows, { allowEmptyValues: false })
    expect(v.missingValueIds.has(rows[0].id)).toBe(true)
    expect(v.missingValueIds.has(rows[1].id)).toBe(false) // custom empty allowed
    expect(v.isValid).toBe(false)
  })

  it('never requires a value for a template row (blank = use template default)', () => {
    const rows = [row('OPENAI_KEY', '', 'template')]
    const v = validateRows(rows, { allowEmptyValues: false })
    expect(v.missingValueIds.size).toBe(0)
    expect(v.isValid).toBe(true)
  })
})

describe('normalizeKey / fixRowKey', () => {
  it('upcases and collapses separators to underscore', () => {
    expect(normalizeKey('API-KEY')).toBe('API_KEY')
    expect(normalizeKey('api key')).toBe('API_KEY')
    expect(normalizeKey('a-b_c')).toBe('A_B_C')
    expect(normalizeKey('API-key.v2')).toBe('API_KEY_V2')
    expect(normalizeKey('-leading-trailing-')).toBe('LEADING_TRAILING')
  })

  it('fixRowKey normalizes only the targeted row', () => {
    let rows = buildInitialRows({ initial: { 'A-B': '1', GOOD: '2' } })
    const badRow = rows.find((r) => r.key === 'A-B')!
    rows = fixRowKey(rows, badRow.id)
    expect(rows.find((r) => r.id === badRow.id)!.key).toBe('A_B')
    expect(rows.find((r) => r.key === 'GOOD')).toBeTruthy()
  })
})

describe('toVariablesMap', () => {
  it('returns null while invalid', () => {
    const rows = buildInitialRows({ initial: { 'A-B': 'x' } })
    expect(toVariablesMap(rows)).toBeNull()
  })

  it('serializes valid rows, dropping blank keys', () => {
    let rows = buildInitialRows({ initial: { A: '1' } })
    rows = appendBlankRow(rows).rows // trailing blank row ignored
    expect(toVariablesMap(rows)).toEqual({ A: '1' })
  })

  it('edit mode omits untouched preserved rows', () => {
    let rows = buildInitialRows({ initial: { KEEP: '', CHANGE: '' }, mode: 'edit' })
    const changeRow = rows.find((r) => r.key === 'CHANGE')!
    rows = updateRowValue(rows, changeRow.id, 'new')
    expect(toVariablesMap(rows, { mode: 'edit' })).toEqual({ CHANGE: 'new' })
  })

  it('omits untouched template rows but includes overridden ones (create)', () => {
    let rows = buildInitialRows({ templateKeys: ['KEEP', 'OVERRIDE'] })
    const overrideRow = rows.find((r) => r.key === 'OVERRIDE')!
    rows = updateRowValue(rows, overrideRow.id, 'mine')
    // KEEP stays blank -> server uses the template value; OVERRIDE is sent.
    expect(toVariablesMap(rows)).toEqual({ OVERRIDE: 'mine' })
  })
})

describe('hasVariableEdits', () => {
  it('is false when nothing changed in edit mode', () => {
    const rows = buildInitialRows({ initial: { A: '', B: '' }, mode: 'edit' })
    expect(hasVariableEdits(rows, ['A', 'B'])).toBe(false)
  })

  it('is true when a value is touched', () => {
    let rows = buildInitialRows({ initial: { A: '', B: '' }, mode: 'edit' })
    rows = updateRowValue(rows, rows[0].id, 'x')
    expect(hasVariableEdits(rows, ['A', 'B'])).toBe(true)
  })

  it('is true when a key is added or removed', () => {
    const base = buildInitialRows({ initial: { A: '', B: '' }, mode: 'edit' })
    expect(hasVariableEdits(removeRow(base, base[0].id), ['A', 'B'])).toBe(true)
    const appended = appendBlankRow(base)
    const added = updateRowKey(appended.rows, appended.id, 'C')
    expect(hasVariableEdits(added, ['A', 'B'])).toBe(true)
  })
})

describe('reconcileAgentType', () => {
  it('adds new declared keys and drops empty old declared rows', () => {
    const rows = buildInitialRows({ requiredKeys: ['OLD_REQ'], optionalKeys: ['OLD_OPT'] })
    const { rows: next } = reconcileAgentType(rows, ['NEW_REQ'], ['NEW_OPT'])
    const keys = next.map((r) => r.key)
    expect(keys).toContain('NEW_REQ')
    expect(keys).toContain('NEW_OPT')
    expect(keys).not.toContain('OLD_REQ')
    expect(keys).not.toContain('OLD_OPT')
  })

  it('never drops a row that has a value; re-tags it custom', () => {
    let rows = buildInitialRows({ requiredKeys: ['OLD_REQ'] })
    rows = updateRowValue(rows, rows[0].id, 'kept')
    const { rows: next, hasUserContent } = reconcileAgentType(rows, ['NEW_REQ'], [])
    expect(hasUserContent).toBe(true)
    const survivor = next.find((r) => r.key === 'OLD_REQ')
    expect(survivor).toMatchObject({ value: 'kept', origin: 'custom' })
    expect(next.find((r) => r.key === 'NEW_REQ')).toBeTruthy()
  })

  it('preserves the value of a key that is declared by both types', () => {
    let rows = buildInitialRows({ requiredKeys: ['SHARED'] })
    rows = updateRowValue(rows, rows[0].id, 'v')
    const { rows: next } = reconcileAgentType(rows, ['SHARED'], [])
    expect(next.find((r) => r.key === 'SHARED')).toMatchObject({ value: 'v', origin: 'required' })
  })

  it('keeps custom rows untouched', () => {
    let rows = buildInitialRows({ requiredKeys: ['OLD_REQ'], initial: { OLD_REQ: '' } })
    const appended = appendBlankRow(rows)
    rows = updateRowKey(appended.rows, appended.id, 'MY_CUSTOM')
    const customRow = rows.find((r) => r.key === 'MY_CUSTOM')!
    rows = updateRowValue(rows, customRow.id, 'c')
    const { rows: next } = reconcileAgentType(rows, ['NEW_REQ'], [])
    expect(next.find((r) => r.key === 'MY_CUSTOM')).toMatchObject({ value: 'c', origin: 'custom' })
  })

  it('reports no user content for a fresh declared-only list', () => {
    const rows = buildInitialRows({ requiredKeys: ['OLD_REQ'] })
    const { hasUserContent } = reconcileAgentType(rows, ['NEW_REQ'], [])
    expect(hasUserContent).toBe(false)
  })
})
