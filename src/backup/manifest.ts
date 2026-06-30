import { PrismaService } from '../prisma/prisma.service'

/**
 * Full-system backup manifest (#378).
 *
 * The manifest is the small JSON file that travels inside every backup bundle
 * and makes a bundle SAFE to move between machines. It records what the bundle
 * was made from so that {@link validateForImport} can refuse a restore that
 * would silently corrupt the target:
 *   - the migration head, so a bundle whose schema predates/postdates the
 *     target's migrations is rejected before any data is written, and
 *   - a non-reversible fingerprint of ENV_VAR_ENCRYPTION_KEY, so a bundle
 *     exported under a different key is caught instead of restoring secrets
 *     that can never be decrypted (the single biggest correctness risk).
 *
 * The key itself is NEVER written to the bundle — only its SHA-256 fingerprint.
 */

/** Bump when the bundle layout or manifest shape changes incompatibly. */
export const BACKUP_FORMAT_VERSION = 1

/**
 * High-volume, low-migration-value observability tables. Excluded from the
 * bundle by default; included only when the operator passes the metrics flag.
 */
export const METRICS_TABLES = [
  'UsageMetricsSnapshot',
  'ServerMetricsSnapshot',
  'SessionActivityLog',
  'RoomEvent',
  'AgentBuildLog',
] as const

/**
 * The durable application data — the FK graph that defines a deployment. These
 * are always exported. Quoted with their Prisma model names, which equal the
 * Postgres table names (the schema declares no @@map).
 */
export const CORE_TABLES = [
  'User',
  'ProjectMembership',
  'Project',
  'Session',
  'SessionState',
  'Room',
  'AgentType',
  'AgentInstance',
  'Participant',
  'Invitation',
  'Message',
  'PlanTemplate',
  'EnvVarTemplate',
  'UserMessage',
  'ProjectInvitation',
  'AgentConfiguration',
] as const

/** Resolve the set of tables to count/restore for the chosen metrics policy. */
export function tablesForExport(includeMetrics: boolean): string[] {
  return includeMetrics
    ? [...CORE_TABLES, ...METRICS_TABLES]
    : [...CORE_TABLES]
}

/** One bundled agent-package file (from AGENT_STORAGE_PATH). */
export interface PackageEntry {
  /** Path relative to the storage root — matches AgentType.packagePath. */
  path: string
  bytes: number
  sha256: string
}

export interface BackupManifest {
  formatVersion: number
  /** STELLA app version at export time (package.json). */
  appVersion: string
  /** ISO-8601 export timestamp. */
  exportedAt: string
  /** Latest applied Prisma migration on the source DB (null if none). */
  migrationHead: string | null
  /** SHA-256 of ENV_VAR_ENCRYPTION_KEY (null when encryption was disabled). */
  encryptionKeyFingerprint: string | null
  /** Whether the high-volume metrics tables were included. */
  includesMetrics: boolean
  /** Per-table row counts, for post-restore verification. */
  tables: Record<string, number>
  packages: PackageEntry[]
  packageCount: number
}

/**
 * The latest applied (non-rolled-back) Prisma migration on a database — the
 * "migration head". Two deployments are schema-compatible iff their heads match.
 */
export async function readMigrationHead(
  prisma: PrismaService,
): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
    `SELECT migration_name FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
       ORDER BY finished_at DESC
       LIMIT 1`,
  )
  return rows.length > 0 ? rows[0].migration_name : null
}

/**
 * Count rows for each given table. Names come exclusively from the hardcoded
 * CORE_TABLES/METRICS_TABLES constants — never user input — so interpolating
 * them into the query is safe.
 */
export async function countTables(
  prisma: PrismaService,
  tables: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM "${table}"`,
    )
    counts[table] = Number(rows[0]?.count ?? 0)
  }
  return counts
}

/** Inputs gathered by the export service before writing the manifest. */
export interface BuildManifestInput {
  prisma: PrismaService
  appVersion: string
  exportedAt: string
  encryptionKeyFingerprint: string | null
  includeMetrics: boolean
  packages: PackageEntry[]
}

export async function buildManifest(
  input: BuildManifestInput,
): Promise<BackupManifest> {
  const tables = await countTables(
    input.prisma,
    tablesForExport(input.includeMetrics),
  )
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: input.appVersion,
    exportedAt: input.exportedAt,
    migrationHead: await readMigrationHead(input.prisma),
    encryptionKeyFingerprint: input.encryptionKeyFingerprint,
    includesMetrics: input.includeMetrics,
    tables,
    packages: input.packages,
    packageCount: input.packages.length,
  }
}

/** The live state of the deployment a bundle is about to be imported into. */
export interface ImportTarget {
  migrationHead: string | null
  encryptionKeyFingerprint: string | null
}

export interface ImportGuardOptions {
  /** Proceed despite an encryption-key fingerprint mismatch (downgrades the
   * hard block to a loud warning — secrets will NOT decrypt). */
  allowKeyMismatch?: boolean
}

export interface ImportGuardResult {
  ok: boolean
  /** Reasons the import must not proceed. Non-empty ⇒ abort. */
  blockers: string[]
  /** Non-fatal concerns to surface to the operator. */
  warnings: string[]
}

/**
 * Decide whether a bundle may be restored onto a target. Pure and synchronous
 * so every branch is unit-testable without a database. Guards, in order:
 *
 *  1. Format version — an unknown bundle layout can't be trusted; hard block.
 *  2. Migration head — a schema mismatch would restore data into the wrong
 *     shape; hard block, no override (the operator must align migrations first).
 *  3. Encryption-key fingerprint — a mismatch means restored secrets can't be
 *     decrypted; hard block UNLESS allowKeyMismatch, which downgrades it to a
 *     warning so a deliberate "data only, I'll re-enter secrets" restore is
 *     possible.
 */
export function validateForImport(
  manifest: BackupManifest,
  target: ImportTarget,
  options: ImportGuardOptions = {},
): ImportGuardResult {
  const blockers: string[] = []
  const warnings: string[] = []

  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    blockers.push(
      `Unsupported bundle format version ${manifest.formatVersion} ` +
        `(this server supports ${BACKUP_FORMAT_VERSION}).`,
    )
  }

  if (manifest.migrationHead !== target.migrationHead) {
    blockers.push(
      `Migration head mismatch: bundle was exported at ` +
        `"${manifest.migrationHead ?? '(none)'}" but this server is at ` +
        `"${target.migrationHead ?? '(none)'}". Align migrations before importing.`,
    )
  }

  if (
    manifest.encryptionKeyFingerprint !== target.encryptionKeyFingerprint
  ) {
    const detail =
      `Encryption-key mismatch: the bundle was exported under a different ` +
      `ENV_VAR_ENCRYPTION_KEY than this server. Encrypted env-var templates ` +
      `and agent secrets will NOT decrypt after restore.`
    if (options.allowKeyMismatch) {
      warnings.push(`${detail} Proceeding because key-mismatch override is set.`)
    } else {
      blockers.push(
        `${detail} Restore the original key, or pass the key-mismatch ` +
          `override to import anyway (secrets must then be re-entered).`,
      )
    }
  }

  return { ok: blockers.length === 0, blockers, warnings }
}
