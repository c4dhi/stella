---
sidebar_position: 100
title: Changelog
description: Release history and notable changes
---

# Changelog

All notable changes to STELLA are documented here. For the full changelog, see [CHANGELOG.md](https://github.com/c4dhi/STELLA_backend/blob/main/CHANGELOG.md) on GitHub.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and STELLA uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Version Policy

- **Major (X.0.0)**: Breaking changes to APIs or configuration
- **Minor (0.X.0)**: New features, backward compatible
- **Patch (0.0.X)**: Bug fixes, backward compatible

## [Unreleased]

### Added
- Custom Tools guide for extending agent capabilities
- Database Schema documentation with complete Prisma model reference
- Custom Agent Visualizers guide for creating face visualizers
- Environment Variables reference documentation
- Message Recording deployment guide
- Authentication guide with JWT implementation details

### Changed
- Improved code block styling with automatic word wrapping
- Updated architecture overview with database references
- Enhanced cross-linking between documentation pages

---

## [0.2.0] - 2025-01-17

### Added
- Complete documentation site with Docusaurus
- Getting Started guides (Quick Start, Installation, First Agent)
- Architecture documentation (Overview, Data Flow, Session Lifecycle, Kubernetes)
- SDK Reference (Overview, Base Agent, Plans, Tools, Streaming, TypeScript Types)
- Deployment guides (Kubernetes, Nginx, Production Checklist)
- LiveKit integration documentation
- Contributing guidelines (Development Setup, Coding Standards, PR Process)
- Plan Structure documentation with state machine details

### Changed
- Migrated documentation from standalone markdown files to Docusaurus
- Reorganized documentation structure for better navigation

---

## [0.1.0] - 2025-01-10

### Added
- Initial STELLA backend release
- NestJS-based session management server
- LiveKit integration for real-time audio/video
- PostgreSQL database with Prisma ORM
- Kubernetes orchestration for agent pods
- STELLA Agent SDK for Python agents
- State machine for conversation flow management
- React frontend with visualizer gallery
- JWT-based authentication system
- Project and session management APIs

---

## Upgrade Guides

When upgrading between versions, check for:

1. **Breaking Changes**: Listed under each version's "Changed" or "Removed" sections
2. **Database Migrations**: Run `npx prisma migrate deploy` after updating
3. **Configuration Changes**: Compare your `.env` with `.env.example`
4. **SDK Updates**: Update agent dependencies to match backend version

## Documentation Versions

This documentation supports versioning. Use the version dropdown in the navbar to access documentation for older releases. The "Next" version contains unreleased changes from the `main` branch.
