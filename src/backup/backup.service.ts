import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import AdmZip from 'adm-zip'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { EncryptionService } from '../env-var-templates/encryption.service'
import {
  buildManifest,
  countTables,
  readMigrationHead,
  tablesForExport,
  validateForImport,
  BackupManifest,
  PackageEntry,
  CORE_TABLES,
  METRICS_TABLES,
} from './manifest'
import {
  encryptBundle,
  decryptBundle,
  isEncryptedBundle,
} from './bundle-crypto'

/** Every table name we will ever trust from an (untrusted) uploaded manifest. */
const KNOWN_TABLES = new Set<string>([...CORE_TABLES, ...METRICS_TABLES])

export interface BackupExportOptions {
  /** Include the high-volume metrics/observability tables (default false). */
  includeMetrics?: boolean
  /** When set, encrypt the whole bundle at rest under this passphrase. */
  passphrase?: string
}

export interface BackupExportResult {
  /** Absolute path of the finished bundle, ready to stream to the client. */
  bundlePath: string
  filename: string
  byteLength: number
  manifest: BackupManifest
  /** Remove the bundle's temp directory. Call once the bundle is fully sent. */
  cleanup: () => Promise<void>
}

export interface BackupImportOptions {
  /** Absolute path of the uploaded bundle on disk. */
  bundlePath: string
  /** Explicit acknowledgement that import OVERWRITES all existing data. */
  confirmOverwrite: boolean
  /** Passphrase to decrypt the bundle (required iff it was exported encrypted). */
  passphrase?: string
  /** Proceed despite an encryption-key fingerprint mismatch. */
  allowKeyMismatch?: boolean
}

export interface TableVerification {
  name: string
  expected: number
  actual: number
  match: boolean
}

export interface BackupImportReport {
  warnings: string[]
  tables: TableVerification[]
  packages: {
    expected: number
    restored: number
    missingOnDisk: string[]
  }
  orphanPackagePaths: string[]
  keyStatus: 'match' | 'mismatch-overridden'
}

/**
 * Full-system data export/import (#378).
 *
 * Engine: pure Prisma + Postgres, no external binaries (no pg_dump / zip / kubectl).
 * The same code runs identically on a developer's Mac, a dev box, and a
 * production Kubernetes pod — nothing has to be installed on any host.
 *
 * Fidelity is delegated to Postgres itself: each table is exported as
 * `json_agg(row)::text` and re-imported via `json_populate_recordset`, which
 * casts the JSON back through the table's own column types. The aggregate is
 * kept as TEXT end-to-end (never parsed in JS), so even int8/BigInt values
 * round-trip with full precision. Bundling uses adm-zip (pure JS).
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly encryption: EncryptionService,
  ) {}

  async export(
    options: BackupExportOptions = {},
  ): Promise<BackupExportResult> {
    const includeMetrics = options.includeMetrics ?? false
    const zip = new AdmZip()

    // 1. Table data — one JSON file per table (raw json_agg text).
    for (const table of tablesForExport(includeMetrics)) {
      const json = await this.dumpTableJson(table)
      zip.addFile(`tables/${table}.json`, Buffer.from(json, 'utf8'))
    }

    // 2. Agent-package files (added to the zip + checksummed).
    const packages = await this.addPackagesToZip(zip)

    // 3. Manifest — the safety record that gates import.
    const manifest = await buildManifest({
      prisma: this.prisma,
      appVersion: await this.readAppVersion(),
      exportedAt: new Date().toISOString(),
      encryptionKeyFingerprint: this.encryption.getKeyFingerprint(),
      includeMetrics,
      packages,
    })
    zip.addFile(
      'manifest.json',
      Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    )

    // 4. Write the bundle to a temp file and hand back a stream-able path.
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stella-backup-'))
    const stamp = manifest.exportedAt.replace(/[:.]/g, '-')
    let filename = `stella-backup-${manifest.appVersion}-${stamp}.zip`
    let bundlePath = path.join(outDir, filename)
    zip.writeZip(bundlePath)

    // 5. Optionally encrypt the whole bundle at rest.
    if (options.passphrase) {
      const encPath = `${bundlePath}.enc`
      await encryptBundle(bundlePath, encPath, options.passphrase)
      await fs.rm(bundlePath, { force: true })
      bundlePath = encPath
      filename = `${filename}.enc`
    }

    const { size } = await fs.stat(bundlePath)
    this.logger.log(
      `Export ready: ${filename} (${size} bytes, ${packages.length} packages, ` +
        `metrics=${includeMetrics}, encrypted=${Boolean(options.passphrase)})`,
    )

    return {
      bundlePath,
      filename,
      byteLength: size,
      manifest,
      cleanup: () => this.removeDir(outDir),
    }
  }

  async import(options: BackupImportOptions): Promise<BackupImportReport> {
    if (!options.confirmOverwrite) {
      throw new BadRequestException(
        'Import not confirmed: this operation overwrites all existing data ' +
          'and must be explicitly acknowledged.',
      )
    }

    let decryptedPath: string | null = null
    try {
      // Decrypt first if the bundle was exported with a passphrase.
      let bundlePath = options.bundlePath
      if (await isEncryptedBundle(options.bundlePath)) {
        if (!options.passphrase) {
          throw new BadRequestException(
            'This backup is encrypted. Provide the passphrase to import it.',
          )
        }
        decryptedPath = path.join(
          os.tmpdir(),
          `stella-dec-${crypto.randomBytes(8).toString('hex')}.zip`,
        )
        try {
          await decryptBundle(options.bundlePath, decryptedPath, options.passphrase)
        } catch {
          throw new BadRequestException(
            'Could not decrypt the backup — wrong passphrase or corrupted file.',
          )
        }
        bundlePath = decryptedPath
      }

      const zip = this.openBundle(bundlePath)
      const manifest = this.readManifest(zip)

      // --- Guards: refuse before any write ---------------------------------
      const target = {
        migrationHead: await readMigrationHead(this.prisma),
        encryptionKeyFingerprint: this.encryption.getKeyFingerprint(),
      }
      const guard = validateForImport(manifest, target, {
        allowKeyMismatch: options.allowKeyMismatch,
      })
      if (!guard.ok) {
        throw new BadRequestException({
          message: 'Backup import rejected before any changes were made.',
          blockers: guard.blockers,
        })
      }

      // Only allowlisted table names are ever trusted from the uploaded manifest.
      const bundleTables = Object.keys(manifest.tables).filter((t) =>
        KNOWN_TABLES.has(t),
      )

      // --- Destructive phase -----------------------------------------------
      this.logger.warn(
        `Importing backup — OVERWRITING ${bundleTables.length} tables and the ` +
          `agent-package store.`,
      )
      await this.truncateTables(bundleTables)

      // Insert parents before children so foreign keys hold (no superuser tricks).
      const order = this.insertionOrder().filter((t) =>
        bundleTables.includes(t),
      )
      for (const table of order) {
        const entry = zip.getEntry(`tables/${table}.json`)
        if (!entry) continue
        await this.restoreTableJson(table, entry.getData().toString('utf8'))
      }

      await this.restorePackages(zip)

      // --- Verify ----------------------------------------------------------
      const report = await this.verifyRestore(manifest, bundleTables)
      report.warnings.push(...guard.warnings)
      this.logger.log(
        `Import complete: ${report.tables.length} tables, ` +
          `${report.packages.restored}/${report.packages.expected} packages, ` +
          `key=${report.keyStatus}`,
      )
      return report
    } finally {
      // The uploaded bundle (and any decrypted copy) is a credential — delete.
      await fs.rm(options.bundlePath, { force: true }).catch(() => undefined)
      if (decryptedPath) {
        await fs.rm(decryptedPath, { force: true }).catch(() => undefined)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Table data — Postgres does the type round-trip; JS never parses the rows.
  // ---------------------------------------------------------------------------

  /** Export one table as a JSON array string (kept as text for fidelity). */
  private async dumpTableJson(table: string): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ data: string }>>(
      `SELECT coalesce(json_agg(t)::text, '[]') AS data FROM "${table}" t`,
    )
    return rows[0]?.data ?? '[]'
  }

  /** Restore one table from a JSON array string via json_populate_recordset. */
  private async restoreTableJson(table: string, json: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "${table}" SELECT * FROM json_populate_recordset(NULL::"${table}", $1::json)`,
      json,
    )
  }

  /** Empty the given tables. CASCADE + RESTART IDENTITY so order/sequences are
   * irrelevant. Names are allowlist-checked already. */
  private async truncateTables(tables: string[]): Promise<void> {
    if (tables.length === 0) return
    const quoted = tables.map((t) => `"${t}"`).join(', ')
    await this.prisma.$executeRawUnsafe(
      `TRUNCATE ${quoted} RESTART IDENTITY CASCADE`,
    )
  }

  /**
   * Topological insert order (dependencies first) derived from the live Prisma
   * schema, so it adapts to schema changes instead of being hand-maintained.
   * A model "depends on" any model it holds a foreign key to (relationFromFields).
   */
  private insertionOrder(): string[] {
    const models = Prisma.dmmf.datamodel.models
    const names = new Set(models.map((m) => m.name))
    const deps = new Map<string, Set<string>>()
    for (const m of models) {
      const set = new Set<string>()
      for (const f of m.fields) {
        if (
          f.kind === 'object' &&
          f.relationFromFields &&
          f.relationFromFields.length > 0 &&
          f.type !== m.name &&
          names.has(f.type)
        ) {
          set.add(f.type)
        }
      }
      deps.set(m.name, set)
    }

    const order: string[] = []
    const visited = new Set<string>()
    const inProgress = new Set<string>()
    const visit = (n: string) => {
      if (visited.has(n) || inProgress.has(n)) return // skip done / break cycles
      inProgress.add(n)
      for (const d of deps.get(n) ?? []) visit(d)
      inProgress.delete(n)
      visited.add(n)
      order.push(n)
    }
    for (const m of models) visit(m.name)
    return order
  }

  // ---------------------------------------------------------------------------
  // Agent-package files
  // ---------------------------------------------------------------------------

  /** Add the whole agent-package tree to the zip under `packages/`, returning a
   * checksum manifest. Returns [] when no packages exist yet. */
  private async addPackagesToZip(zip: AdmZip): Promise<PackageEntry[]> {
    const root = this.storage.getStorageRoot()
    try {
      await fs.access(root)
    } catch {
      return []
    }
    return this.walkPackages(zip, root, root)
  }

  private async walkPackages(
    zip: AdmZip,
    dir: string,
    base: string,
  ): Promise<PackageEntry[]> {
    const entries: PackageEntry[] = []
    const dirents = await fs.readdir(dir, { withFileTypes: true })
    for (const dirent of dirents) {
      const abs = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        entries.push(...(await this.walkPackages(zip, abs, base)))
      } else if (dirent.isFile()) {
        const data = await fs.readFile(abs)
        const rel = path.relative(base, abs)
        zip.addFile(`packages/${rel}`, data)
        entries.push({
          path: rel,
          bytes: data.length,
          sha256: crypto.createHash('sha256').update(data).digest('hex'),
        })
      }
    }
    return entries
  }

  /** Replace the entire agent-package store with the bundle's `packages/` tree. */
  private async restorePackages(zip: AdmZip): Promise<void> {
    const root = this.storage.getStorageRoot()
    await fs.rm(root, { recursive: true, force: true })
    await fs.mkdir(root, { recursive: true })
    const prefix = 'packages/'
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue
      const rel = entry.entryName.slice(prefix.length)
      const dest = this.storage.getAbsolutePath(rel)
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, entry.getData())
    }
  }

  // ---------------------------------------------------------------------------
  // Bundle + manifest helpers
  // ---------------------------------------------------------------------------

  private openBundle(bundlePath: string): AdmZip {
    try {
      return new AdmZip(bundlePath)
    } catch {
      throw new BadRequestException('Invalid bundle: not a readable .zip archive.')
    }
  }

  private readManifest(zip: AdmZip): BackupManifest {
    const entry = zip.getEntry('manifest.json')
    if (!entry) {
      throw new BadRequestException('Invalid bundle: manifest.json is missing.')
    }
    try {
      return JSON.parse(entry.getData().toString('utf8')) as BackupManifest
    } catch {
      throw new BadRequestException('Invalid bundle: manifest.json is unreadable.')
    }
  }

  private async verifyRestore(
    manifest: BackupManifest,
    tableNames: string[],
  ): Promise<BackupImportReport> {
    const actual = await countTables(this.prisma, tableNames)
    const tables: TableVerification[] = tableNames.map((name) => {
      const expected = manifest.tables[name] ?? 0
      const got = actual[name] ?? 0
      return { name, expected, actual: got, match: expected === got }
    })

    const missingOnDisk: string[] = []
    for (const pkg of manifest.packages) {
      try {
        await fs.access(this.storage.getAbsolutePath(pkg.path))
      } catch {
        missingOnDisk.push(pkg.path)
      }
    }

    // Referential integrity: every AgentType.packagePath must resolve to a file.
    const orphanPackagePaths: string[] = []
    const agentTypes = await this.prisma.agentType.findMany({
      where: { packagePath: { not: null } },
      select: { packagePath: true },
    })
    for (const at of agentTypes) {
      if (!at.packagePath) continue
      try {
        await fs.access(this.storage.getAbsolutePath(at.packagePath))
      } catch {
        orphanPackagePaths.push(at.packagePath)
      }
    }

    return {
      warnings: [],
      tables,
      packages: {
        expected: manifest.packages.length,
        restored: manifest.packages.length - missingOnDisk.length,
        missingOnDisk,
      },
      orphanPackagePaths,
      keyStatus:
        manifest.encryptionKeyFingerprint ===
        this.encryption.getKeyFingerprint()
          ? 'match'
          : 'mismatch-overridden',
    }
  }

  private async readAppVersion(): Promise<string> {
    try {
      const raw = await fs.readFile(
        path.join(process.cwd(), 'package.json'),
        'utf8',
      )
      return (JSON.parse(raw).version as string) ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  private async removeDir(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true })
    } catch (err) {
      this.logger.warn(`Failed to remove temp dir ${dir}: ${String(err)}`)
    }
  }
}
