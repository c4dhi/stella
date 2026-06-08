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

**Agent Configurator — Expert Module**
- Deterministic, literature-informed **verdict responses**: each expert verdict maps to an action (`inform`/`prepend`/`override`/`short_circuit`) + template, applied by priority in the arbitration layer so safety-critical output doesn't depend on the LLM's interpretation
- **Generic, editable verdict labels** with LLM-facing explanations (label + explanation handed to the classifier; action stays in arbitration); fixed output interface
- Agent-declared expert defaults published from `config/experts/*.json` to `AgentType.expertDefaults`, **capability-gated** (`task_extraction` ← `plans`, assessment pool ← `experts`)
- Unified prompt editor in the New Custom Expert form (#178), Always-Triggered toggle on creation (#175), and an unsaved-changes discard guard on close (#177)

**Stella Light**
- **Barge-in support** at parity with stella-v2: a configurable Barge-in Evaluator (COMMIT/RESUME classifier) with an editable prompt/model in the Configurator, plus `BARGE_IN_ENABLED` / `BARGE_IN_EVAL_TIMEOUT_MS` env controls

### Changed

**State machine — task completion (#291)**
- Task completion is now derived from collected data: a task with deliverables is addressed automatically once its **required** deliverables are collected (or, for an all-optional task, once **every** declared deliverable is in), with no separate "mark complete" step. Deliverable-less tasks still require an explicit complete/skip. A state advances only once **every** task (required *and* optional) is addressed, and is never vacuously complete on entry.

### Fixed

**Progress / to-do rendering (#291)**
- A skipped task no longer renders as pending — it shows as skipped and counts toward "tasks done". Skipping a task now also marks its uncollected deliverables `skipped`.
- **stella-v2:** skipping a task no longer makes the whole state disappear from the route view (group status now follows the state machine's authoritative status), and the progress percentage is no longer mis-scaled.
- Live and historical-replay views now share one progress→to-do conversion, so they can't disagree about task status.
- Follow-up #310 will consolidate the shared `full_state → progress` transform into the SDK so the agents stop drifting.

---

## [0.3.0] - 2025-01-29

### Added

**Participant Experience**
- Text-only interface for participant screen (#24)
- Marketing landing page (#12)
- Mobile-ready participant screen with responsive design (#25)
- Session transcript export functionality (#50)
- Public web interface for interviewees (#3)

**Agent & System Capabilities**
- Agent Toolkit/Toolbox implementation for extensible agent capabilities (#20)
- Enhanced Conversational Agent with improved dialogue handling (#88)
- Whisper integration for Text-to-Speech (#7)
- Public Projects feature for shared access (#4)
- Environment variable override support in DeployAgentModal

**Project & User Management**
- Per-user project basis with sharing capabilities (#34)
- Environment Variable Templates for Agent Types (#28)
- System-wide state persistence (#31)

**Documentation & Onboarding**
- Adaptive documentation system (#29)
- Dynamic onboarding through start-script (#56)
- Custom Tools guide for extending agent capabilities
- Database Schema documentation with complete Prisma model reference
- Custom Agent Visualizers guide for creating face visualizers
- Environment Variables reference documentation
- Message Recording deployment guide
- Authentication guide with JWT implementation details

### Changed
- Refactored Conversational AI Agent to SDK architecture (#10)
- Migrated system from Minikube to K3S with enforced microservice architecture for STT and TTS (#14)
- Improved start script and repository structure (#16)
- Improved code block styling with automatic word wrapping
- Updated architecture overview with database references
- Enhanced cross-linking between documentation pages

### Fixed
- Fixed Whisper warmup functions not existing (#70)
- Fixed Whisper not reliably transcribing speech (#49) [P0]
- Fixed double texting issue (#9)
- Fixed new user error when no projects exist (#36)
- Fixed initial message bug (#6)
- Fixed unselecting Debug in Session Overview not working (#11)
- Fixed environment variables not reaching agent pods when modified in deploy modal
- Fixed LiveKit Production page title formatting

---

## [0.2.0] - 2025-01-17

### Added
- Complete documentation site with Docusaurus
- Getting Started guides (Quick Start, Installation, First Agent)
- Architecture documentation (Overview, Data Flow, Session Lifecycle, Kubernetes)
- SDK Reference (Overview, Base Agent, Plans, Tools, Streaming, TypeScript Types)
- Deployment guides (Kubernetes, Production, Production Checklist)
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
