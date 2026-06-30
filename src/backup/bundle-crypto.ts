import * as crypto from 'crypto'
import * as fs from 'fs/promises'

/**
 * Optional at-rest encryption for a backup bundle (#378).
 *
 * A bundle holds password hashes and (when wizard config is included) secrets,
 * so the operator may choose to encrypt it with a passphrase at export time.
 * Pure Node crypto — no openssl/ gpg binary — so it works identically on every
 * platform, matching the dependency-free backup engine.
 *
 * Format (single file):
 *   MAGIC(9) | salt(16) | iv(12) | authTag(16) | ciphertext
 *
 * AES-256-GCM (authenticated) with a scrypt-derived key. The auth tag means a
 * wrong passphrase or any tampering fails closed on decrypt rather than
 * yielding garbage.
 */
const MAGIC = Buffer.from('STELLABK1') // bundle format marker, 9 bytes
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
// scrypt cost: ~16 MB, well within Node's default maxmem.
const SCRYPT: crypto.ScryptOptions = { N: 16384, r: 8, p: 1 }

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, KEY_LEN, SCRYPT)
}

/** Encrypt `plainPath` → `encPath` under `passphrase`. */
export async function encryptBundle(
  plainPath: string,
  encPath: string,
  passphrase: string,
): Promise<void> {
  const plaintext = await fs.readFile(plainPath)
  const salt = crypto.randomBytes(SALT_LEN)
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  await fs.writeFile(encPath, Buffer.concat([MAGIC, salt, iv, tag, ciphertext]))
}

/** True if `filePath` begins with the encrypted-bundle marker. */
export async function isEncryptedBundle(filePath: string): Promise<boolean> {
  const fd = await fs.open(filePath, 'r')
  try {
    const head = Buffer.alloc(MAGIC.length)
    const { bytesRead } = await fd.read(head, 0, MAGIC.length, 0)
    return bytesRead === MAGIC.length && head.equals(MAGIC)
  } finally {
    await fd.close()
  }
}

/**
 * Decrypt `encPath` → `plainPath` with `passphrase`. Throws if the passphrase
 * is wrong or the file was tampered with (GCM auth failure).
 */
export async function decryptBundle(
  encPath: string,
  plainPath: string,
  passphrase: string,
): Promise<void> {
  const data = await fs.readFile(encPath)
  let offset = MAGIC.length
  const salt = data.subarray(offset, (offset += SALT_LEN))
  const iv = data.subarray(offset, (offset += IV_LEN))
  const tag = data.subarray(offset, (offset += TAG_LEN))
  const ciphertext = data.subarray(offset)
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveKey(passphrase, salt),
    iv,
  )
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(), // throws on wrong passphrase / tampering
  ])
  await fs.writeFile(plainPath, plaintext)
}
