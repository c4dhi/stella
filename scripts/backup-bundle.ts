#!/usr/bin/env ts-node
/**
 * Host-side bundle finalizer/preparer for the wizard backup scripts (#378).
 *
 * The in-pod CLI (src/backup/backup.cli.ts) produces a DATA bundle (DB +
 * packages). This helper, run on the deploy host, owns the deploy-layer
 * concerns — folding in the deployment config and optional at-rest encryption —
 * so all config/secret handling lives in the wizard layer, not the backend.
 *
 *   finalize  <dataBundle> <envFile> <out>
 *       Embed the deployment .env into the bundle, then (if BACKUP_PASSPHRASE is
 *       set) encrypt the whole thing → <out>.
 *
 *   prepare-restore <bundle> <outDataBundle> <outEnvFile>
 *       Decrypt if needed (BACKUP_PASSPHRASE), extract the embedded .env →
 *       <outEnvFile>, and write the plain data bundle → <outDataBundle>.
 *
 * Reuses the backend's bundle-crypto + adm-zip so on-disk formats match exactly.
 */
import AdmZip from 'adm-zip'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as crypto from 'crypto'
import {
  encryptBundle,
  decryptBundle,
  isEncryptedBundle,
} from '../src/backup/bundle-crypto'

// Where the deployment .env is parked inside the bundle.
const CONFIG_ENTRY = 'config/deployment.env'

function tmp(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(6).toString('hex')}.zip`)
}

async function finalize(
  dataBundle: string,
  envFile: string,
  out: string,
): Promise<void> {
  const zip = new AdmZip(dataBundle)
  zip.addFile(CONFIG_ENTRY, await fs.readFile(envFile))

  const passphrase = process.env.BACKUP_PASSPHRASE
  if (passphrase) {
    const plain = tmp('stella-fin')
    zip.writeZip(plain)
    await encryptBundle(plain, out, passphrase)
    await fs.rm(plain, { force: true })
  } else {
    zip.writeZip(out)
  }
}

async function prepareRestore(
  bundle: string,
  outDataBundle: string,
  outEnvFile: string,
): Promise<void> {
  let zipPath = bundle
  let decrypted: string | null = null

  if (await isEncryptedBundle(bundle)) {
    const passphrase = process.env.BACKUP_PASSPHRASE
    if (!passphrase) {
      throw new Error('bundle is encrypted; set BACKUP_PASSPHRASE to decrypt it')
    }
    decrypted = tmp('stella-dec')
    await decryptBundle(bundle, decrypted, passphrase)
    zipPath = decrypted
  }

  const zip = new AdmZip(zipPath)
  const cfg = zip.getEntry(CONFIG_ENTRY)
  if (!cfg) {
    throw new Error('bundle has no embedded deployment config (config/deployment.env)')
  }
  await fs.writeFile(outEnvFile, cfg.getData())

  // The data bundle for the pod import. The embedded config entry is harmless —
  // the importer only reads manifest.json, tables/*, and packages/*.
  zip.writeZip(outDataBundle)

  if (decrypted) await fs.rm(decrypted, { force: true })
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'finalize') {
    const [dataBundle, envFile, out] = rest
    if (!dataBundle || !envFile || !out) {
      throw new Error('usage: backup-bundle finalize <dataBundle> <envFile> <out>')
    }
    await finalize(dataBundle, envFile, out)
  } else if (command === 'prepare-restore') {
    const [bundle, outDataBundle, outEnvFile] = rest
    if (!bundle || !outDataBundle || !outEnvFile) {
      throw new Error(
        'usage: backup-bundle prepare-restore <bundle> <outDataBundle> <outEnvFile>',
      )
    }
    await prepareRestore(bundle, outDataBundle, outEnvFile)
  } else {
    throw new Error('usage: backup-bundle <finalize|prepare-restore> ...')
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.message ?? err}\n`)
  process.exit(1)
})
