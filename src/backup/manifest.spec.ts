import {
  BACKUP_FORMAT_VERSION,
  BackupManifest,
  ImportTarget,
  validateForImport,
} from './manifest'

/** A manifest that, against `matchingTarget()`, passes every guard. */
function baseManifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: '1.2.3',
    exportedAt: '2026-06-29T00:00:00.000Z',
    migrationHead: '20260101000000_init',
    encryptionKeyFingerprint: 'fp-abc',
    includesMetrics: false,
    tables: { User: 3 },
    packages: [],
    packageCount: 0,
    ...overrides,
  }
}

function matchingTarget(overrides: Partial<ImportTarget> = {}): ImportTarget {
  return {
    migrationHead: '20260101000000_init',
    encryptionKeyFingerprint: 'fp-abc',
    ...overrides,
  }
}

describe('validateForImport', () => {
  it('accepts a bundle that matches the target on every guard', () => {
    const result = validateForImport(baseManifest(), matchingTarget())
    expect(result.ok).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('blocks an unsupported format version', () => {
    const result = validateForImport(
      baseManifest({ formatVersion: BACKUP_FORMAT_VERSION + 1 }),
      matchingTarget(),
    )
    expect(result.ok).toBe(false)
    expect(result.blockers.join(' ')).toMatch(/format version/i)
  })

  it('blocks a migration-head mismatch with no override available', () => {
    const result = validateForImport(
      baseManifest({ migrationHead: '20260101000000_init' }),
      matchingTarget({ migrationHead: '20260202000000_later' }),
      { allowKeyMismatch: true }, // override must NOT rescue a migration mismatch
    )
    expect(result.ok).toBe(false)
    expect(result.blockers.join(' ')).toMatch(/migration head mismatch/i)
  })

  it('blocks an encryption-key mismatch by default', () => {
    const result = validateForImport(
      baseManifest({ encryptionKeyFingerprint: 'fp-OLD' }),
      matchingTarget({ encryptionKeyFingerprint: 'fp-NEW' }),
    )
    expect(result.ok).toBe(false)
    expect(result.blockers.join(' ')).toMatch(/encryption-key mismatch/i)
    expect(result.warnings).toEqual([])
  })

  it('downgrades an encryption-key mismatch to a warning under override', () => {
    const result = validateForImport(
      baseManifest({ encryptionKeyFingerprint: 'fp-OLD' }),
      matchingTarget({ encryptionKeyFingerprint: 'fp-NEW' }),
      { allowKeyMismatch: true },
    )
    expect(result.ok).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.warnings.join(' ')).toMatch(/encryption-key mismatch/i)
  })

  it('treats key-present-vs-absent as a mismatch', () => {
    const result = validateForImport(
      baseManifest({ encryptionKeyFingerprint: 'fp-abc' }),
      matchingTarget({ encryptionKeyFingerprint: null }),
    )
    expect(result.ok).toBe(false)
    expect(result.blockers.join(' ')).toMatch(/encryption-key mismatch/i)
  })

  it('accepts when both source and target have encryption disabled (null fp)', () => {
    const result = validateForImport(
      baseManifest({ encryptionKeyFingerprint: null }),
      matchingTarget({ encryptionKeyFingerprint: null }),
    )
    expect(result.ok).toBe(true)
  })

  it('reports every failing guard at once', () => {
    const result = validateForImport(
      baseManifest({
        formatVersion: 999,
        migrationHead: 'a',
        encryptionKeyFingerprint: 'x',
      }),
      matchingTarget({ migrationHead: 'b', encryptionKeyFingerprint: 'y' }),
    )
    expect(result.ok).toBe(false)
    expect(result.blockers.length).toBe(3)
  })
})
