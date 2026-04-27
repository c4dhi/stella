# Agent Failure Collection

This folder collects agent failures, edge cases, and unexpected behaviors as we encounter them. Each entry documents what went wrong, how to reproduce it, and what the expected behavior should be.

## Purpose

- Build a library of **regression test cases** from real-world failures
- Feed into **agent documentation** so known pitfalls are well-understood
- Provide a shared reference for the team when debugging similar issues

## How to Add an Entry

1. Copy `TEMPLATE.md` to a new file named `YYYY-MM-DD_short-description.md` (e.g. `2026-04-01_pod-creation-timeout.md`)
2. Fill in all sections of the template
3. Commit and open a PR (or add to an existing branch)

## Naming Convention

Use the format: `YYYY-MM-DD_short-kebab-case-description.md`

The date should be when the failure was first observed or documented.

## Severity Levels

| Level | Meaning |
|-------|---------|
| **critical** | Agent becomes unusable or data is lost |
| **high** | Core functionality broken, no workaround |
| **medium** | Functionality impaired, workaround exists |
| **low** | Minor issue, cosmetic, or rare edge case |

## Index

| Entry | Severity | Status |
|-------|----------|--------|
| [Pod Creation Timeout](2026-04-01_pod-creation-timeout.md) | high | open |
| [Status Sync Race Condition](2026-04-01_status-sync-race-condition.md) | critical | open |
