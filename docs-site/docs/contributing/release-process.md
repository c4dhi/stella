---
sidebar_position: 5
title: Release Process
description: How STELLA versions and releases work
---

# Release Process

This document describes how we version, release, and distribute STELLA.

## Versioning

We use [Semantic Versioning](https://semver.org/) (SemVer):

```
MAJOR.MINOR.PATCH

Examples:
1.0.0  - First stable release
1.1.0  - New features, backward compatible
1.1.1  - Bug fixes
2.0.0  - Breaking changes
```

### Version Meaning

| Version Change | When to Use | Example |
|---------------|-------------|---------|
| MAJOR | Breaking API changes | Renamed endpoints |
| MINOR | New features (backward compatible) | New agent type |
| PATCH | Bug fixes | Fix crash on disconnect |

### Pre-release Versions

```
1.0.0-alpha.1  - Early testing
1.0.0-beta.1   - Feature complete, testing
1.0.0-rc.1     - Release candidate
```

## Release Schedule

| Type | Frequency | Contents |
|------|-----------|----------|
| Major | As needed | Breaking changes |
| Minor | Monthly | New features |
| Patch | As needed | Bug fixes, security |

## Release Checklist

### 1. Prepare Release

```bash
# Ensure on main branch
git checkout main
git pull upstream main

# Create release branch
git checkout -b release/v1.2.0
```

### 2. Update Version Numbers

```bash
# Root package.json
npm version minor

# Frontend
cd frontend-ui && npm version minor && cd ..

# Agents (pyproject.toml or setup.py)
# Update version manually
```

### 3. Update Changelog

Add entry to `CHANGELOG.md`:

```markdown
## [1.2.0] - 2024-01-15

### Added
- New feature X (#123)
- Support for Y (#124)

### Changed
- Improved performance of Z (#125)

### Fixed
- Bug in session cleanup (#126)

### Security
- Updated dependency A to fix CVE-XXXX (#127)
```

### 4. Run Full Test Suite

```bash
# Backend
npm test
npm run test:e2e

# Frontend
cd frontend-ui && npm test

# Agents
cd agents/stella-agent && pytest
cd agents/stella-light && pytest
```

### 5. Create Release PR

```bash
git add .
git commit -m "chore: prepare release v1.2.0"
git push origin release/v1.2.0
```

Create PR: `release/v1.2.0` → `main`

### 6. After PR Merge

```bash
# Create and push tag
git checkout main
git pull
git tag -a v1.2.0 -m "Release v1.2.0"
git push upstream v1.2.0
```

### 7. Create GitHub Release

1. Go to GitHub Releases
2. Click "Create a new release"
3. Select tag `v1.2.0`
4. Title: "v1.2.0"
5. Description: Copy from CHANGELOG
6. Publish release

### 8. Build and Push Images

```bash
# Backend
docker build -t ghcr.io/c4dhi/stella-backend:1.2.0 .
docker push ghcr.io/c4dhi/stella-backend:1.2.0

# Agents
cd agents/stella-agent
docker build -t ghcr.io/c4dhi/stella-agent:1.2.0 .
docker push ghcr.io/c4dhi/stella-agent:1.2.0

# Tag as latest
docker tag ghcr.io/c4dhi/stella-backend:1.2.0 ghcr.io/c4dhi/stella-backend:latest
docker push ghcr.io/c4dhi/stella-backend:latest
```

## Hotfix Process

For urgent bug fixes:

```bash
# Create hotfix branch from tag
git checkout -b hotfix/v1.2.1 v1.2.0

# Make fix
git add .
git commit -m "fix: critical bug in X"

# Update version
npm version patch

# Create PR to main
git push origin hotfix/v1.2.1
```

After merge:
1. Tag as `v1.2.1`
2. Create GitHub release
3. Build and push images

## Docker Image Tags

| Tag | Description |
|-----|-------------|
| `latest` | Most recent stable release |
| `1.2.0` | Specific version |
| `1.2` | Latest patch of 1.2.x |
| `1` | Latest minor of 1.x.x |
| `main` | Latest from main branch |

## Documentation Releases

Documentation is deployed automatically:

- **main branch** → https://c4dhi.github.io/STELLA_backend/
- **Pull requests** → Preview builds (if configured)

## Changelog Format

We follow [Keep a Changelog](https://keepachangelog.com/):

```markdown
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- New features not yet released

## [1.2.0] - 2024-01-15

### Added
- Feature description (#PR)

### Changed
- Change description (#PR)

### Deprecated
- Deprecated feature (#PR)

### Removed
- Removed feature (#PR)

### Fixed
- Bug fix description (#PR)

### Security
- Security fix description (#PR)
```

## Breaking Changes

When introducing breaking changes:

1. **Document clearly** in CHANGELOG
2. **Provide migration guide**
3. **Deprecate first** when possible
4. **Major version bump**

Example migration guide:

```markdown
## Migration Guide: v1.x to v2.0

### Session API Changes

**Before (v1.x):**
```json
POST /api/sessions
{
  "projectId": "..."
}
```

**After (v2.0):**
```json
POST /api/v2/sessions
{
  "project_id": "...",
  "agent_config": {}
}
```

### Required Changes

1. Update API endpoints to use `/api/v2/`
2. Change `projectId` to `project_id`
3. Add required `agent_config` field
```

## Next Steps

- [Pull Request Process](/docs/contributing/pull-request-process) - Submit changes
- [Coding Standards](/docs/contributing/coding-standards) - Style guide
