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

<p align="center">
  <img src=".github/stella-session-screenshot.png" alt="STELLA Session Overview — deploy and interact with voice AI agents in real time" width="800">
</p>

---

## 🏠 What is STELLA?

STELLA is an open-source platform for building, deploying, and testing voice-enabled conversational AI agents. Deploy an agent, have a conversation, iterate — it's that simple.

You bring the agent logic. STELLA handles the audio/video streaming, orchestration, and infrastructure. Built with **NestJS**, **React**, a **Python Agent SDK**, **LiveKit** for WebRTC, and **Kubernetes** for on-demand agent orchestration.

## ✨ Key Features

- 🎙️ Voice & text conversations via WebRTC (LiveKit)
- ☸️ On-demand Kubernetes agent orchestration
- 🐍 Python Agent SDK with built-in STT/TTS pipeline
- 🤖 Multi-agent support (stella-v2-agent, stella-light-agent, custom agents)
- 📋 Plan-driven conversation flows with state machine
- 🔐 Project & session management with role-based access
- 💬 Real-time transcript & event timeline
- 📊 Admin dashboard with live metrics
- 🚀 One-command deployment (`./scripts/start-k8s.sh`)

## 🚀 Quick Start

Three commands. That's it.

```bash
git clone https://github.com/c4dhi/STELLA.git && cd STELLA
cp .env.example .env   # Add your LiveKit + OpenAI keys
./scripts/start-k8s.sh
```

**Frontend** at `http://localhost:5173` · **API** at `http://localhost:3000`

> New here? The [Getting Started](https://c4dhi.github.io/STELLA_Documentation/docs/getting-started/prerequisites) guide walks you through everything — prerequisites, LiveKit setup, and deploying your first agent.

## 🏗️ Architecture

```
LiveKit Server (external)  <-->  Agent Pods (Python)
         |                            |
   Frontend UI (React)  <-->  Backend API (NestJS)  <-->  PostgreSQL
         |
   STT/TTS Services (gRPC)
```

Everything runs inside a single **Kubernetes cluster** (OrbStack on macOS, K3s on Linux), deployed automatically by the startup script. Agent pods spin up on-demand per session and clean up after themselves.

## 📖 Documentation

Full docs live at **[c4dhi.github.io/STELLA_Documentation](https://c4dhi.github.io/STELLA_Documentation/)**.

| | Section | What you'll find |
|---|---------|-----------------|
| 🚀 | [Getting Started](https://c4dhi.github.io/STELLA_Documentation/docs/getting-started/prerequisites) | Prerequisites, installation, first agent |
| 🏗️ | [Architecture](https://c4dhi.github.io/STELLA_Documentation/docs/architecture/overview) | System design and component deep-dive |
| 🤖 | [Building Agents](https://c4dhi.github.io/STELLA_Documentation/docs/building-agents/agent-overview) | Create your own conversational agents |
| 📦 | [Agent SDK Reference](https://c4dhi.github.io/STELLA_Documentation/docs/agent-sdk/overview) | Python SDK API reference |
| 🚢 | [Deployment](https://c4dhi.github.io/STELLA_Documentation/docs/deployment/overview) | Production deployment guide |
| 🤝 | [Contributing](https://c4dhi.github.io/STELLA_Documentation/docs/contributing) | How to get involved |

## 🤝 Contributing

We'd love your help! Whether it's bug reports, feature ideas, docs improvements, or code — all contributions are welcome. Check out the [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) to get started.

## 💬 Community & Support

- [GitHub Issues](https://github.com/c4dhi/STELLA/issues) — Bug reports and feature requests
- [Documentation](https://c4dhi.github.io/STELLA_Documentation/) — Guides, tutorials, and API reference
