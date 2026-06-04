import { describe, it, expect } from 'vitest'
import { resolveBlockDisplay } from './PromptComposer'

const DEFAULT = 'You are a helpful expert.'

describe('resolveBlockDisplay', () => {
  it('shows the built-in default when there is no override (value === undefined)', () => {
    const r = resolveBlockDisplay(undefined, DEFAULT)
    expect(r.isOverridden).toBe(false)
    expect(r.showDefault).toBe(true)
    expect(r.displayValue).toBe(DEFAULT)
  })

  it('shows a custom override verbatim', () => {
    const r = resolveBlockDisplay('custom prompt', DEFAULT)
    expect(r.isOverridden).toBe(true)
    expect(r.showDefault).toBe(false)
    expect(r.displayValue).toBe('custom prompt')
  })

  // Regression for #174: clearing the textarea must NOT snap the default back.
  it('treats an explicit empty string as an override and renders empty', () => {
    const r = resolveBlockDisplay('', DEFAULT)
    expect(r.isOverridden).toBe(true)
    expect(r.showDefault).toBe(false)
    expect(r.displayValue).toBe('')
  })

  it('renders empty (no default available) for a cleared custom expert', () => {
    const r = resolveBlockDisplay('', undefined)
    expect(r.isOverridden).toBe(true)
    expect(r.showDefault).toBe(false)
    expect(r.displayValue).toBe('')
  })

  it('does not show a default badge when none exists and there is no override', () => {
    const r = resolveBlockDisplay(undefined, undefined)
    expect(r.isOverridden).toBe(false)
    expect(r.showDefault).toBe(false)
    expect(r.displayValue).toBe('')
  })
})
