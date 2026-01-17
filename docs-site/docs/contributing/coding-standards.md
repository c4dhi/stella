---
sidebar_position: 3
title: Coding Standards
description: Code style and conventions for STELLA
---

# Coding Standards

Consistent code style makes the codebase easier to read and maintain. This guide covers our standards for TypeScript, Python, and React code.

## TypeScript (Backend)

### Style Guide

We follow the [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript) with TypeScript extensions.

### Formatting

```bash
# Format code
npm run format

# Check formatting
npm run format:check
```

Configuration (`.prettierrc`):

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 100
}
```

### Linting

```bash
# Run linter
npm run lint

# Fix auto-fixable issues
npm run lint:fix
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `SessionService` |
| Interfaces | PascalCase | `CreateSessionDto` |
| Functions | camelCase | `createSession` |
| Variables | camelCase | `sessionCount` |
| Constants | UPPER_SNAKE | `MAX_SESSIONS` |
| Files (classes) | kebab-case | `session.service.ts` |

### Code Examples

**Service:**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { Session } from '@prisma/client';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSessionDto): Promise<Session> {
    return this.prisma.session.create({
      data: {
        projectId: dto.projectId,
        agentType: dto.agentType,
        status: 'PENDING',
      },
    });
  }

  async findOne(id: string): Promise<Session> {
    const session = await this.prisma.session.findUnique({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException(`Session ${id} not found`);
    }

    return session;
  }
}
```

**DTO:**

```typescript
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSessionDto {
  @ApiProperty({ description: 'Project ID' })
  @IsString()
  projectId: string;

  @ApiProperty({ description: 'Agent type to use' })
  @IsEnum(['stella-agent', 'stella-light', 'echo-agent'])
  agentType: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  config?: string;
}
```

## Python (Agents)

### Style Guide

We follow [PEP 8](https://pep8.org/) with [Black](https://black.readthedocs.io/) formatting.

### Formatting

```bash
# Format code
black src/

# Check formatting
black --check src/
```

### Linting

```bash
# Run linter
pylint src/

# Type checking
mypy src/
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `BaseAgent` |
| Functions | snake_case | `on_transcript` |
| Variables | snake_case | `session_id` |
| Constants | UPPER_SNAKE | `MAX_RETRIES` |
| Private | _leading | `_internal_state` |
| Files | snake_case | `audio_pipeline.py` |

### Code Examples

**Agent:**

```python
"""Customer support agent implementation."""

from typing import Optional

from openai import AsyncOpenAI
from stella_sdk import BaseAgent, AudioPipeline, tool

from .config import settings


class CustomerSupportAgent(BaseAgent):
    """Agent for handling customer support conversations."""

    def __init__(self) -> None:
        super().__init__()
        self.pipeline = AudioPipeline(
            stt_provider=settings.stt_provider,
            tts_provider=settings.tts_provider,
        )
        self.openai = AsyncOpenAI()
        self.history: list[dict] = []

    async def on_connect(self) -> None:
        """Handle connection to the LiveKit room."""
        greeting = "Hello! How can I help you today?"
        await self.speak(greeting)

    async def on_transcript(self, text: str, is_final: bool) -> None:
        """Process transcribed speech.

        Args:
            text: The transcribed text
            is_final: Whether this is a final transcription
        """
        if not is_final:
            return

        self.history.append({"role": "user", "content": text})
        response = await self._generate_response(text)
        await self.speak(response)

    async def _generate_response(self, user_input: str) -> str:
        """Generate a response using the LLM."""
        result = await self.openai.chat.completions.create(
            model=settings.openai_model,
            messages=self.history,
        )
        return result.choices[0].message.content
```

**Tool:**

```python
"""Search tools for the agent."""

from typing import Optional

from stella_sdk import tool

from .database import db


@tool
async def search_knowledge(
    query: str,
    category: Optional[str] = None,
    limit: int = 5,
) -> dict:
    """Search the knowledge base for relevant articles.

    Args:
        query: The search query
        category: Optional category filter
        limit: Maximum number of results

    Returns:
        dict: Search results with articles
    """
    results = await db.search(query, category=category, limit=limit)

    return {
        "found": len(results) > 0,
        "articles": [
            {"title": r.title, "summary": r.summary}
            for r in results
        ],
    }
```

## React (Frontend)

### Style Guide

We follow the [React TypeScript Cheatsheet](https://react-typescript-cheatsheet.netlify.app/).

### Component Structure

```tsx
// Good: Functional component with TypeScript
interface MessageProps {
  text: string;
  speaker: 'user' | 'assistant';
  timestamp?: Date;
}

export function Message({ text, speaker, timestamp }: MessageProps) {
  return (
    <div className={`message message--${speaker}`}>
      <p>{text}</p>
      {timestamp && <time>{timestamp.toLocaleTimeString()}</time>}
    </div>
  );
}
```

### File Organization

```
components/
├── Message/
│   ├── Message.tsx         # Component
│   ├── Message.test.tsx    # Tests
│   └── index.ts            # Export
├── Chat/
│   ├── Chat.tsx
│   ├── ChatInput.tsx
│   ├── ChatMessages.tsx
│   └── index.ts
```

### Hooks

```tsx
// Custom hook with TypeScript
function useSession(sessionId: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchSession() {
      try {
        const data = await api.getSession(sessionId);
        setSession(data);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    }

    fetchSession();
  }, [sessionId]);

  return { session, loading, error };
}
```

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `style` | Formatting (no code change) |
| `refactor` | Code restructuring |
| `perf` | Performance improvement |
| `test` | Adding tests |
| `chore` | Maintenance tasks |

### Examples

```bash
# Feature
git commit -m "feat(agents): add support for custom TTS providers"

# Bug fix
git commit -m "fix(backend): handle null session in cleanup"

# Documentation
git commit -m "docs: add streaming guide to SDK docs"

# Breaking change
git commit -m "feat(api)!: change session create response format

BREAKING CHANGE: The session create endpoint now returns
a different response structure."
```

## Testing

### Backend

```bash
# Run all tests
npm test

# Run with coverage
npm run test:cov

# Run specific test
npm test -- session.service.spec.ts
```

### Frontend

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage
```

### Agents

```bash
# Run tests
pytest

# Run with coverage
pytest --cov=src

# Run specific test
pytest tests/test_agent.py::test_greeting
```

## Next Steps

- [Pull Request Process](/docs/contributing/pull-request-process) - Submit your changes
- [Development Setup](/docs/contributing/development-setup) - Environment setup
