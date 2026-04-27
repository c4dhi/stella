# Agent Failure Collection

We maintain a dedicated folder at [`docs/agent-failures/`](../../../docs/agent-failures) where we systematically collect agent failures and edge cases as we encounter them. These entries serve as regression test cases and feed into agent documentation.

## Purpose

- **Regression testing** — each documented failure becomes a future test case
- **Knowledge sharing** — the team can learn from past failures without re-discovering them
- **Documentation** — known pitfalls and edge cases are captured alongside the code

## How to Add a Failure Entry

1. Navigate to `docs/agent-failures/`
2. Copy `TEMPLATE.md` to a new file: `YYYY-MM-DD_short-description.md`
3. Fill in all sections of the template
4. Update the index table in `docs/agent-failures/README.md`
5. Commit and open a PR

### Entry Template

Each entry captures:

| Section | Description |
|---------|-------------|
| **What Happened** | Brief description of the failure |
| **Steps to Reproduce** | Numbered steps to trigger the issue |
| **Relevant Configuration** | Plan, agent config, K8s settings, or environment details |
| **Expected Behavior** | What should have happened |
| **Actual Behavior** | What actually happened (with logs/errors) |
| **Root Cause** | Analysis of why it happened |
| **Workaround** | Any temporary fix |

### Severity Levels

| Level | Meaning |
|-------|---------|
| **critical** | Agent becomes unusable or data is lost |
| **high** | Core functionality broken, no workaround |
| **medium** | Functionality impaired, workaround exists |
| **low** | Minor issue, cosmetic, or rare edge case |

## Current Entries

| Entry | Severity | Status | Description |
|-------|----------|--------|-------------|
| Pod Creation Timeout | high | open | Log streaming fails if K8s pod takes >60s to start |
| Status Sync Race Condition | critical | open | Agent stuck in STOPPED after restart due to concurrent status sync |

## Guidelines

- **Add entries as you encounter them** — don't wait for a formal process
- **Be specific** — include file paths, line numbers, and actual error messages
- **Update status** — mark entries as `resolved` once a fix is merged
- **Link related issues** — reference GitHub issues or PRs where applicable
