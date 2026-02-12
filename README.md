<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/stella-banner.png">
    <source media="(prefers-color-scheme: light)" srcset=".github/stella-banner.png">
    <img alt="STELLA - System for Testing and Engineering LLM-based Conversational Agents" src=".github/stella-banner.png" width="800">
  </picture>
</p>

<h1 align="center">STELLA</h1>

<p align="center">
  <strong>System for Testing and Engineering LLM-based Conversational Agents</strong><br>
  Open-source conversational AI infrastructure — focus on your agent, we handle the rest.
</p>

<p align="center">
  <a href="https://github.com/c4dhi/STELLA/stargazers"><img src="https://img.shields.io/github/stars/c4dhi/STELLA?style=flat-square" alt="GitHub Stars"></a>
  <a href="https://github.com/c4dhi/STELLA/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-TBD-lightgrey?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/version-0.3.0-blue?style=flat-square" alt="Version 0.3.0">
  <a href="https://c4dhi.github.io/STELLA_Documentation/"><img src="https://img.shields.io/badge/docs-live-green?style=flat-square" alt="Documentation"></a>
  <a href="https://github.com/c4dhi/STELLA/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome"></a>
</p>

---

<!-- Add session overview screenshot here -->
<!-- Caption: STELLA Session Overview — deploy and interact with voice AI agents in real time -->

## What is STELLA?

STELLA is an open-source platform for building, deploying, and testing voice-enabled conversational AI agents. It handles audio/video streaming, orchestration, and infrastructure so developers can focus on agent logic.

Built with **NestJS** (backend), **React** (frontend), and a **Python Agent SDK**, STELLA uses **LiveKit** for WebRTC media streaming and **Kubernetes** for on-demand agent orchestration.

## Key Features

- Voice & text conversations via WebRTC (LiveKit)
- On-demand Kubernetes agent orchestration
- Python Agent SDK with built-in STT/TTS pipeline
- Multi-agent support (stella-agent, stella-light-agent, custom agents)
- Plan-driven conversation flows with state machine
- Project & session management with role-based access
- Real-time transcript & event timeline
- Admin dashboard with live metrics
- One-command deployment (`./scripts/start-k8s.sh`)

## Quick Start

```bash
git clone https://github.com/c4dhi/STELLA.git && cd STELLA
cp .env.example .env   # Add your LiveKit + OpenAI keys
./scripts/start-k8s.sh
```

**Frontend** at `http://localhost:5173` | **API** at `http://localhost:3000`

> For full setup instructions including prerequisites and LiveKit configuration, see the [Getting Started](https://c4dhi.github.io/STELLA_Documentation/docs/getting-started/prerequisites) guide.

## Architecture

```
LiveKit Server (external)  <-->  Agent Pods (Python)
         |                            |
   Frontend UI (React)  <-->  Backend API (NestJS)  <-->  PostgreSQL
         |
   STT/TTS Services (gRPC)
```

All services run inside a single **Kubernetes cluster** (OrbStack on macOS, K3s on Linux) and are deployed automatically by the startup script. Agent pods are created on-demand per session.

## Documentation

Full documentation is available at **[c4dhi.github.io/STELLA_Documentation](https://c4dhi.github.io/STELLA_Documentation/)**.

| Section | Description |
|---------|-------------|
| [Getting Started](https://c4dhi.github.io/STELLA_Documentation/docs/getting-started/prerequisites) | Prerequisites, installation, first agent |
| [Architecture](https://c4dhi.github.io/STELLA_Documentation/docs/architecture/overview) | System design and component overview |
| [Building Agents](https://c4dhi.github.io/STELLA_Documentation/docs/building-agents/agent-overview) | Create custom conversational agents |
| [Agent SDK Reference](https://c4dhi.github.io/STELLA_Documentation/docs/agent-sdk/overview) | Python SDK API reference |
| [Deployment](https://c4dhi.github.io/STELLA_Documentation/docs/deployment/overview) | Production deployment guide |
| [Contributing](https://c4dhi.github.io/STELLA_Documentation/docs/contributing) | How to contribute |

## Contributing

We welcome contributions of all kinds — bug reports, feature requests, documentation improvements, and code. Please read our [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

## Community & Support

- [GitHub Issues](https://github.com/c4dhi/STELLA/issues) — Bug reports and feature requests
- [Documentation](https://c4dhi.github.io/STELLA_Documentation/) — Guides, tutorials, and API reference
