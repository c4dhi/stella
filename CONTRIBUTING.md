# 🤝 Contributing to STELLA

Thank you for your interest in contributing to STELLA! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### 📋 Prerequisites

- Node.js 20+
- Python 3.11+
- Docker and kubectl
- A Kubernetes cluster (local like minikube/kind or remote)

### 🔧 Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/c4dhi/stella.git
   cd stella
   ```

2. **Set up environment variables**

   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Install dependencies**

   ```bash
   # Backend
   npm install

   # Frontend
   cd frontend-ui && npm install
   ```

4. **Start development servers**

   ```bash
   # Start everything with Kubernetes
   ./scripts/start-k8s.sh

   # Or for local development
   npm run dev
   ```

## 💡 How to Contribute

### 🐛 Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/c4dhi/stella/issues)
2. If not, create a new issue using the bug report template
3. Include as much detail as possible:
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details
   - Relevant logs

### ✨ Suggesting Features

1. Check existing [Issues](https://github.com/c4dhi/stella/issues) for similar requests
2. Create a new issue using the feature request template
3. Describe the use case and proposed solution

### 📝 Submitting Code

1. **Fork the repository** and create a new branch

   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Make your changes**

   - Follow the code style guidelines
   - Add tests where applicable
   - Update documentation if needed

3. **Test your changes**

   ```bash
   npm test
   npm run lint
   npm run build
   ```

4. **Commit your changes**

   - Use clear, descriptive commit messages
   - Reference related issues

   ```bash
   git commit -m "feat: add voice activity detection to agent SDK

   - Implement VAD using Silero
   - Add configuration options
   - Update documentation

   Fixes #123"
   ```

5. **Push and create a Pull Request**

   ```bash
   git push origin feature/your-feature-name
   ```

   Then create a PR on GitHub using the pull request template.

## 🎨 Code Style

### TypeScript/JavaScript

- Use TypeScript for all new code
- Follow the existing code style (enforced by ESLint)
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

### Python (Agent SDK)

- Follow PEP 8 style guidelines
- Use type hints
- Add docstrings for public functions and classes
- Use `black` for formatting

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

## 📁 Project Structure

```
STELLA/
├── src/                    # Backend source code
│   ├── controllers/        # API route handlers
│   ├── services/           # Business logic
│   ├── models/             # Database models
│   └── middleware/         # Express middleware
├── frontend-ui/            # React frontend
├── agent-sdk/              # Python SDK for agents
├── agents/                 # Agent implementations
│   ├── stella-agent/       # Full-featured agent
│   └── echo-agent/         # Reference implementation
├── k8s/                    # Kubernetes manifests
├── scripts/                # Deployment scripts
└── docs-site/              # Documentation (Docusaurus)
```

## 🧪 Testing

### Backend Tests

```bash
npm test
npm run test:coverage
```

### Frontend Tests

```bash
cd frontend-ui
npm test
```

### Agent Tests

```bash
cd agents/stella-agent
python -m pytest tests/
```

## 📚 Documentation

- Documentation is in `docs-site/` using Docusaurus
- Run locally: `cd docs-site && npm start`
- Update docs when adding/changing features

## 🆘 Getting Help

- Check the [documentation](https://c4dhi.github.io/stella/)
- Ask in [Discussions](https://github.com/c4dhi/stella/discussions)
- Join our community chat (if available)

## 📄 License

By contributing, you agree that your contributions will be licensed under the project's license.
