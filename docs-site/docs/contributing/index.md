---
sidebar_position: 1
title: Contributing Overview
description: How to contribute to STELLA
---

# Contributing to STELLA

:::info Lead Maintainer
For questions, collaboration inquiries, or guidance on contributing, please reach out to the lead maintainer:

**Felix Moser**
📧 [felix.moser@unisg.ch](mailto:felix.moser@unisg.ch)
💼 [LinkedIn](https://www.linkedin.com/in/felix-moser-a2b7a9176/)

We welcome contributions of all kinds and are happy to help you get started!
:::

Thank you for your interest in contributing to STELLA! This guide will help you get started with contributing code, documentation, and bug reports.

## Ways to Contribute

### Code Contributions

- **Bug fixes**: Fix issues in the backlog
- **Features**: Implement new functionality
- **Performance**: Optimize existing code
- **Tests**: Improve test coverage

### Documentation

- **Guides**: Write tutorials and how-to guides
- **API docs**: Document code and APIs
- **Examples**: Create example projects
- **Translations**: Help translate docs

### Community

- **Bug reports**: Report issues you find
- **Feature requests**: Suggest improvements
- **Discussions**: Help others in discussions
- **Code reviews**: Review pull requests

## Quick Start

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Set up development environment** (see [Development Setup](/docs/contributing/development-setup))
4. **Create a branch** for your changes
5. **Make your changes** following our [coding standards](/docs/contributing/coding-standards)
6. **Submit a pull request** following our [PR process](/docs/contributing/pull-request-process)

```bash
# Fork on GitHub, then:
git clone https://github.com/YOUR_USERNAME/STELLA.git
cd STELLA
git checkout -b feature/my-new-feature
```

## Code of Conduct

We are committed to providing a welcoming and inclusive experience for everyone. Please read and follow our [Code of Conduct](https://github.com/c4dhi/STELLA/blob/main/CODE_OF_CONDUCT.md).

## Getting Help

- **GitHub Discussions**: Ask questions and discuss ideas
- **GitHub Issues**: Report bugs and request features
- **Discord**: Chat with the community (coming soon)

## Repository Structure

```
STELLA/
├── src/                    # Backend source (NestJS)
├── agents/                 # Agent implementations
│   ├── stella-agent/       # Full-featured agent
│   ├── stella-light/       # Lightweight agent
│   └── echo-agent/         # Testing agent
├── frontend-ui/            # React frontend
├── docs-site/              # Documentation (Docusaurus)
├── k8s/                    # Kubernetes manifests
├── scripts/                # Utility scripts
└── prisma/                 # Database schema
```

## Development Workflow

```
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│  Fork & Clone  │───▶│  Create Branch │───▶│  Make Changes  │
└────────────────┘    └────────────────┘    └────────────────┘
                                                    │
                                                    ▼
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│    Merged!     │◀───│  Code Review   │◀───│  Submit PR     │
└────────────────┘    └────────────────┘    └────────────────┘
```

## Next Steps

- [Development Setup](/docs/contributing/development-setup) - Set up your environment
- [Coding Standards](/docs/contributing/coding-standards) - Code style guidelines
- [Pull Request Process](/docs/contributing/pull-request-process) - PR workflow
- [Release Process](/docs/contributing/release-process) - How we release
