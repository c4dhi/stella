#!/usr/bin/env ts-node

import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import { Client } from 'pg';
import { randomUUID } from 'crypto';

type AdminBootstrapPayload = {
  email_b64?: string;
  password_b64?: string;
};

// Decode a base64-encoded string from the bootstrap payload.
function decodeBase64(value: string): string {
  return Buffer.from(value, 'base64').toString('utf8');
}

// Read and validate the one-time bootstrap file, returning plain credentials.
function parseBootstrapFile(path: string): { email: string; password: string } {
  if (!fs.existsSync(path)) {
    throw new Error(`Bootstrap file not found: ${path}`);
  }

  const raw = fs.readFileSync(path, 'utf8');
  const payload = JSON.parse(raw) as AdminBootstrapPayload;

  if (!payload.email_b64 || !payload.password_b64) {
    throw new Error('Invalid bootstrap payload: missing email/password');
  }

  const email = decodeBase64(payload.email_b64).trim();
  const password = decodeBase64(payload.password_b64);

  if (!email || !password) {
    throw new Error('Invalid bootstrap payload: empty email/password');
  }

  if (!email.includes('@')) {
    throw new Error('Invalid bootstrap payload: email format is invalid');
  }

  return { email, password };
}

// Create or update the initial admin user with verified/system-admin flags.
async function main() {
  const bootstrapFile = process.argv[2];
  if (!bootstrapFile) {
    throw new Error('Usage: ts-node scripts/bootstrap-initial-admin.ts <bootstrap-file>');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for admin bootstrap');
  }

  const { email, password } = parseBootstrapFile(bootstrapFile);
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    const passwordHash = await bcrypt.hash(password, 12);

    const existing = await client.query<{ id: string }>(
      'SELECT "id" FROM "User" WHERE "email" = $1 LIMIT 1',
      [email],
    );

    if (existing.rowCount && existing.rows[0]?.id) {
      await client.query(
        `UPDATE "User"
         SET "password" = $1,
             "verified" = true,
             "isSystemAdmin" = true,
             "updatedAt" = NOW()
         WHERE "id" = $2`,
        [passwordHash, existing.rows[0].id],
      );
      console.log(`Updated existing user as verified system admin: ${email}`);
      return;
    }

    const id = randomUUID();
    await client.query(
      `INSERT INTO "User" ("id", "email", "password", "name", "verified", "isSystemAdmin", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, true, true, NOW(), NOW())`,
      [id, email, passwordHash, 'Initial Admin'],
    );
    console.log(`Created initial verified system admin: ${email}`);
  } finally {
    await client.end();
  }
}

// Entrypoint wrapper: prints a concise error and exits non-zero on failure.
main().catch((error) => {
  console.error('Initial admin bootstrap failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
