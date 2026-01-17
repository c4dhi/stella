---
sidebar_position: 5
title: Git & Commits
description: Git workflow and commit message conventions
---

# Git & Commits

Version control standards and commit message conventions for STELLA.

## Branch Naming

Use descriptive branch names with a category prefix:

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New features | `feature/custom-tts-provider` |
| `fix/` | Bug fixes | `fix/session-cleanup-null` |
| `docs/` | Documentation | `docs/streaming-guide` |
| `refactor/` | Code refactoring | `refactor/agent-pipeline` |
| `test/` | Test improvements | `test/session-service-coverage` |
| `chore/` | Maintenance | `chore/update-dependencies` |

```bash
# Create a feature branch
git checkout -b feature/add-voice-selection

# Create a fix branch
git checkout -b fix/audio-sync-issue
```

## Keep Branches Updated

```bash
# Update your branch with main
git fetch origin
git rebase origin/main

# Or merge (if you prefer)
git merge origin/main
```

## Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/) for clear, consistent commit history.

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**Structure breakdown:**

- **type**: Category of the change (required)
- **scope**: Component or area affected (optional but recommended)
- **subject**: Short description in imperative mood (required)
- **body**: Detailed explanation if needed (optional)
- **footer**: Breaking changes, issue references (optional)

## Commit Types

| Type | When to Use | Example |
|------|-------------|---------|
| `feat` | New feature or capability | `feat(agents): add voice selection API` |
| `fix` | Bug fix | `fix(audio): resolve sync delay on reconnect` |
| `docs` | Documentation only | `docs: add WebSocket troubleshooting guide` |
| `style` | Formatting, no code change | `style: fix indentation in service files` |
| `refactor` | Code change without fix/feature | `refactor(pipeline): extract audio processor` |
| `perf` | Performance improvement | `perf(stt): reduce transcription latency` |
| `test` | Adding or fixing tests | `test(session): add cleanup edge cases` |
| `build` | Build system or dependencies | `build: upgrade to Node.js 20` |
| `ci` | CI/CD configuration | `ci: add Python lint workflow` |
| `chore` | Maintenance, tooling | `chore: update .gitignore patterns` |
| `revert` | Reverting a previous commit | `revert: feat(agents): add voice selection` |

## Writing Good Commit Messages

### The Subject Line

- **Use imperative mood**: "Add feature" not "Added feature" or "Adds feature"
- **Don't capitalize** first letter after type
- **No period** at the end
- **Keep under 72 characters** (50 is ideal)
- **Be specific**: "fix audio" → "fix audio dropout on network switch"

```bash
# Good
fix(stt): handle empty audio buffer gracefully
feat(agents): add ElevenLabs TTS provider support
refactor(backend): extract session validation logic

# Bad
fix: fixed the bug                    # Too vague
feat: Add New Feature.                # Wrong case, has period
update code                           # No type, too vague
fix(stt): this commit fixes the issue where the audio buffer was empty and causing crashes  # Too long
```

### The Body (When Needed)

Use the body to explain **what** and **why**, not how (code shows how):

```bash
git commit -m "fix(audio): prevent dropout during network transitions

The audio pipeline was dropping frames when the network
connection briefly interrupted. This adds a 500ms buffer
that smooths over short connectivity gaps.

Closes #234"
```

### Breaking Changes

Mark breaking changes with `!` after the type/scope and add a `BREAKING CHANGE` footer:

```bash
git commit -m "feat(api)!: change session response format

BREAKING CHANGE: Session create now returns { session, token }
instead of just the session object. Update clients to
destructure the response."
```

## Scopes for STELLA

Use these scopes to identify the affected area:

| Scope | Area |
|-------|------|
| `api` | REST API endpoints |
| `agents` | Agent implementations |
| `stt` | Speech-to-text |
| `tts` | Text-to-speech |
| `llm` | Language model integration |
| `audio` | Audio pipeline |
| `session` | Session management |
| `k8s` | Kubernetes configs |
| `frontend` | React UI |
| `docs` | Documentation site |
| `db` | Database/Prisma |
| `auth` | Authentication |

## Examples by Scenario

**Adding a new feature:**
```bash
git commit -m "feat(agents): add support for custom wake words

Agents can now be configured with custom wake words
through the plan configuration. Supports multiple
wake words per agent.

Refs #156"
```

**Fixing a bug:**
```bash
git commit -m "fix(tts): resolve audio clipping on long responses

Audio was being clipped when TTS responses exceeded
30 seconds. Increased buffer size and added chunked
streaming for long responses."
```

**Refactoring code:**
```bash
git commit -m "refactor(pipeline): split AudioProcessor into components

Extract VAD, STT, and TTS into separate processor
classes to improve testability and reduce coupling."
```

## Git Best Practices

### Atomic Commits

Each commit should represent **one logical change**:

```bash
# Good: Separate commits for separate concerns
git commit -m "fix(auth): validate JWT expiration correctly"
git commit -m "test(auth): add JWT validation edge cases"
git commit -m "docs: update auth configuration guide"

# Bad: Mixing unrelated changes
git commit -m "fix auth, update docs, and misc cleanup"
```

### Commit Frequently

- Commit when you have a working, testable unit of change
- Don't wait until the end of the day
- Each commit should pass tests and lint

### Review Before Committing

```bash
# Check what's changed
git status
git diff

# Stage specific files (recommended)
git add src/session/session.service.ts

# Review staged changes
git diff --staged

# Commit with editor for longer messages
git commit

# Or inline for simple commits
git commit -m "fix(audio): handle null audio context"
```

### Rewriting History (Before Pushing)

Clean up commits before pushing to a PR:

```bash
# Interactive rebase to squash/reword commits
git rebase -i HEAD~3

# Amend the last commit
git commit --amend

# Amend without changing message
git commit --amend --no-edit
```

**Never rewrite history that's been pushed** unless you're the only one working on the branch.

## Useful Git Aliases

Add these to your `~/.gitconfig`:

```ini
[alias]
    # Short status
    st = status -sb

    # Pretty log
    lg = log --oneline --graph --decorate -20

    # Amend without editing message
    amend = commit --amend --no-edit

    # Undo last commit (keep changes)
    undo = reset HEAD~1 --mixed

    # Show what you're about to push
    unpushed = log @{u}..HEAD --oneline
```

## Handling Mistakes

```bash
# Undo last commit (keep changes staged)
git reset --soft HEAD~1

# Undo last commit (keep changes unstaged)
git reset HEAD~1

# Completely discard last commit
git reset --hard HEAD~1

# Revert a pushed commit (creates new commit)
git revert <commit-hash>

# Fix commit message before pushing
git commit --amend -m "fix(audio): correct message here"
```

## Commit Message Template

Create `.gitmessage` in your home directory:

```
# <type>(<scope>): <subject>
#
# <body>
#
# <footer>
#
# Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
# Scopes: api, agents, stt, tts, llm, audio, session, k8s, frontend, docs, db, auth
#
# Subject: imperative mood, no capital, no period, max 72 chars
# Body: explain what and why (not how)
# Footer: BREAKING CHANGE, Closes #issue, Refs #issue
```

Configure Git to use it:

```bash
git config --global commit.template ~/.gitmessage
```
