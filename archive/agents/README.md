# Archived Agents

Agents in this directory are **retired**. They are kept here for historical
reference only and are intentionally excluded from the live system:

- They are **not** under `agents/`, so the Prisma seed (`prisma/seed.ts`) no
  longer discovers them and the deactivation pass flips any leftover DB rows to
  `REJECTED` — removing them from the agent gallery.
- They are **not** in the build registry (`src/agent-image/agent-image.service.ts`)
  or the agent startup-test CI workflow, so no images are built for them.
- They are removed from the backend's `allowedAgentTypes`, so they cannot be
  deployed.

## Contents

| Agent | Retired in favour of |
|-------|----------------------|
| `echo-agent` | — (test-only agent, no replacement) |
| `stella-agent` | `stella-v2-agent` (full pipeline) / `stella-light-agent` (lightweight) |

To revive one, move its directory back under `agents/`, re-add it to the build
registry and CI workflow, and re-run the seed.
