---
sidebar_position: 5
title: Backup & Restore
description: Full-system export/import for disaster recovery and machine-to-machine migration
---

# Backup & Restore

STELLA can export an **entire deployment** to a single bundle and restore it onto
another machine — an exact clone with secrets intact. Use this for
disaster-recovery backups and for moving a deployment to new hardware.

A bundle contains:

- **The database** — every application table (users, projects, sessions,
  messages, agent types, env-var templates, …), exported as JSON.
- **The agent packages** — every uploaded custom-agent zip from
  `AGENT_STORAGE_PATH`.
- **The deployment config** — the wizard's `.env` (secrets + settings:
  `ENV_VAR_ENCRYPTION_KEY`, `JWT_SECRET`, API keys, LiveKit, TTS, …), so the
  clone comes up identical.
- **A manifest** — metadata that makes a bundle safe to move between machines
  (see [What the manifest guards](#what-the-manifest-guards)).

Excluded by design (rebuilt on the target, not data): agent Docker images,
TTS/STT model weights, and live LiveKit rooms.

The backup engine is pure Node + Postgres — no database-specific tooling such as
`pg_dump` or `zip` is needed anywhere. Table fidelity (timestamps, big integers)
is handled by Postgres itself, so a restore reproduces the source exactly. (The
scripts still use the host's normal deploy toolchain — `node` and `kubectl`; see
[Prerequisites](#prerequisites).)

:::danger A bundle is a full credential
Because the bundle embeds the deployment config, it contains **every secret** —
password hashes, `ENV_VAR_ENCRYPTION_KEY`, API keys. A leaked bundle is a total
compromise. **Encrypt it** (see below) and store/transfer it only over trusted
channels.
:::

## Optional encryption

Export can encrypt the whole bundle with a passphrase (AES-256-GCM, scrypt-derived
key — pure Node, no external tools). An encrypted bundle is named `…​.zip.enc`.
Restore detects encryption and asks for the passphrase. **Carry the passphrase
separately from the bundle** — it is the one secret that is never written into the
file.

## Who can do this

- **Export** runs only as a **wizard/deploy script** (`scripts/backup-export.sh`),
  because gathering the data, the agent-package volume, and the deployment config
  together is a deploy-layer operation. There is no UI export.
- **Restore** is a **wizard/deploy script** (`scripts/backup-restore.sh`) for a
  full relocation (config + data), or a **data-only** import from the
  **Admin Dashboard** (`/settings/admin`, SystemAdmin only) when the deployment
  is already configured.

## Prerequisites

The export/restore scripts run on the **deploy host** (the machine you run
`start-k8s.sh` from) and need its standard toolchain — **`node`, `npx`, and
`kubectl`**. These are already required to deploy STELLA, and the scripts check
for them up front, failing with the exact install command if any is missing.

Export is a **logical** backup, so it needs a **running system**:

- **Postgres must be running** — the database is read live (a stopped database
  is just opaque files and cannot be exported).
- **The backend pod must be running** — the export engine runs inside it (the
  only place that can see both the database and the agent-package volume).

`backup-export.sh` verifies both before doing anything and tells you which part
is down if not. A fully wound-down deployment cannot be exported — bring it up
(or scale Postgres + backend up) first.

## Export

```bash
# Writes ./stella-backup-<timestamp>.zip
./scripts/backup-export.sh [--production|--local]

# Include the high-volume metrics/observability tables (larger bundle)
./scripts/backup-export.sh --include-metrics

# Encrypt the bundle at rest (prompts for a passphrase) → ….zip.enc
./scripts/backup-export.sh --encrypt
```

Under the hood the script execs the in-pod backup CLI to produce the data bundle
(only the backend pod can see both the database and the package volume), copies
it out, embeds the deployment `.env`, and optionally encrypts the result.

## Restore — full relocation (script)

:::warning Restore overwrites everything
This **permanently replaces ALL data and config** in the target namespace. It
cannot be undone.
:::

```bash
./scripts/backup-restore.sh --in stella-backup-<timestamp>.zip [--production|--local]
```

The script: backs up the current `.env`, installs the restored config, recreates
the `stella-ai-secrets` secret and restarts the backend (so the restored
`ENV_VAR_ENCRYPTION_KEY` and keys take effect), then imports the database and
agent packages in-pod — overwriting all data. Intended for a fresh target
already brought up with [`start-k8s.sh`](./kubernetes.md).

## Restore — data only (admin UI)

When the target is already configured with the matching `ENV_VAR_ENCRYPTION_KEY`,
an admin can restore just the **data** from the dashboard:

1. **Settings → Admin Dashboard → Restore from backup**.
2. **Import backup…**, choose the bundle, enter the passphrase if it is encrypted.
3. Confirm **Overwrite everything?**.

This path restores data + packages but **not** deployment config — so the target
must already have the correct encryption key, or the key-fingerprint guard will
stop the import.

## What the manifest guards

Before any data is written, import checks the bundle's manifest against the
target server:

| Guard | Behaviour on mismatch |
|---|---|
| **Format version** | Hard abort — the bundle layout isn't understood. |
| **Migration head** | Hard abort — the bundle's schema doesn't match the target's migrations. Deploy the matching app version first, then retry. |
| **Encryption-key fingerprint** | Hard abort — restored secrets would not decrypt. |

The full restore script recreates the secret from the bundle's config *before*
importing, so the encryption-key guard passes automatically. For the data-only
UI path, the target must already run the original key. A `--allow-key-mismatch`
override exists (data-only "I'll re-enter secrets" restores) but is intentionally
not surfaced in the dashboard.

## Relocating to a new machine — runbook

1. **On the source**, run `./scripts/backup-export.sh --encrypt` and copy the
   `…​.zip.enc` to the target. Keep the passphrase separate.
2. **On the target**, bring up the stack with
   [`start-k8s.sh`](./kubernetes.md) and the **same app version** (so the
   migration head matches).
3. **Restore**: `./scripts/backup-restore.sh --in <bundle>` — it applies the
   config, recreates secrets, restarts the backend, and imports the data.
4. **Verify**: login works, projects/sessions/messages are present, agent
   packages resolve, and env-var-template secrets decrypt.

:::note
This restores persistent data and config and keeps encrypted secrets usable. It
is a disaster-recovery / relocation capability, **not** a zero-downtime cutover —
in-flight voice sessions are not migrated.
:::
