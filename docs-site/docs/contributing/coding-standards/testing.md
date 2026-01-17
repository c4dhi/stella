---
sidebar_position: 6
title: Testing
description: Testing standards and practices for STELLA
---

# Testing

Testing standards and practices for all STELLA components.

## Backend (NestJS)

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:cov

# Run specific test file
npm test -- session.service.spec.ts

# Run tests in watch mode
npm run test:watch
```

### Test Structure

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { SessionService } from './session.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SessionService', () => {
  let service: SessionService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        {
          provide: PrismaService,
          useValue: {
            session: {
              create: jest.fn(),
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('create', () => {
    it('should create a session with pending status', async () => {
      const dto = { projectId: 'proj-1', agentType: 'stella-agent' };
      const expected = { id: 'sess-1', ...dto, status: 'PENDING' };

      jest.spyOn(prisma.session, 'create').mockResolvedValue(expected);

      const result = await service.create(dto);

      expect(result).toEqual(expected);
      expect(prisma.session.create).toHaveBeenCalledWith({
        data: { ...dto, status: 'PENDING' },
      });
    });
  });

  describe('findOne', () => {
    it('should return session if found', async () => {
      const session = { id: 'sess-1', status: 'ACTIVE' };
      jest.spyOn(prisma.session, 'findUnique').mockResolvedValue(session);

      const result = await service.findOne('sess-1');

      expect(result).toEqual(session);
    });

    it('should throw NotFoundException if session not found', async () => {
      jest.spyOn(prisma.session, 'findUnique').mockResolvedValue(null);

      await expect(service.findOne('invalid')).rejects.toThrow(
        'Session invalid not found',
      );
    });
  });
});
```

## Frontend (React)

### Running Tests

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### Component Testing

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Message } from './Message';

describe('Message', () => {
  it('renders the message text', () => {
    render(<Message text="Hello" speaker="user" />);

    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('applies correct class for speaker', () => {
    const { container } = render(<Message text="Hi" speaker="assistant" />);

    expect(container.firstChild).toHaveClass('message--assistant');
  });

  it('shows timestamp when provided', () => {
    const date = new Date('2024-01-15T10:30:00');
    render(<Message text="Test" speaker="user" timestamp={date} />);

    expect(screen.getByText(/10:30/)).toBeInTheDocument();
  });
});
```

### Hook Testing

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { useSession } from './useSession';
import { api } from '../api';

jest.mock('../api');

describe('useSession', () => {
  it('fetches session data', async () => {
    const mockSession = { id: 'sess-1', status: 'ACTIVE' };
    (api.getSession as jest.Mock).mockResolvedValue(mockSession);

    const { result } = renderHook(() => useSession('sess-1'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.session).toEqual(mockSession);
    expect(result.current.error).toBeNull();
  });
});
```

## Agents (Python)

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src

# Run specific test file
pytest tests/test_agent.py

# Run specific test
pytest tests/test_agent.py::test_greeting

# Run with verbose output
pytest -v
```

### Test Structure

```python
"""Tests for the customer support agent."""

import pytest
from unittest.mock import AsyncMock, patch

from stella_agent.agent import CustomerSupportAgent


@pytest.fixture
def agent():
    """Create a test agent instance."""
    return CustomerSupportAgent()


@pytest.fixture
def mock_openai():
    """Mock OpenAI client."""
    with patch('stella_agent.agent.AsyncOpenAI') as mock:
        client = AsyncMock()
        mock.return_value = client
        yield client


class TestCustomerSupportAgent:
    """Tests for CustomerSupportAgent."""

    @pytest.mark.asyncio
    async def test_on_connect_sends_greeting(self, agent):
        """Agent should send greeting on connect."""
        agent.speak = AsyncMock()

        await agent.on_connect()

        agent.speak.assert_called_once()
        assert "help" in agent.speak.call_args[0][0].lower()

    @pytest.mark.asyncio
    async def test_on_transcript_ignores_partial(self, agent):
        """Agent should ignore non-final transcripts."""
        agent._generate_response = AsyncMock()

        await agent.on_transcript("Hello", is_final=False)

        agent._generate_response.assert_not_called()

    @pytest.mark.asyncio
    async def test_on_transcript_processes_final(self, agent, mock_openai):
        """Agent should process final transcripts."""
        agent.speak = AsyncMock()
        mock_openai.chat.completions.create.return_value.choices[0].message.content = "Hi there!"

        await agent.on_transcript("Hello", is_final=True)

        assert len(agent.history) == 1
        assert agent.history[0]["content"] == "Hello"
        agent.speak.assert_called_once_with("Hi there!")
```

### Testing Tools

```python
"""Tests for agent tools."""

import pytest
from unittest.mock import AsyncMock, patch

from stella_agent.tools import search_knowledge


@pytest.mark.asyncio
async def test_search_knowledge_returns_results():
    """Search should return formatted results."""
    mock_results = [
        type('Article', (), {'title': 'FAQ', 'summary': 'Common questions'})(),
    ]

    with patch('stella_agent.tools.db.search', new_callable=AsyncMock) as mock_search:
        mock_search.return_value = mock_results

        result = await search_knowledge("help")

        assert result["found"] is True
        assert len(result["articles"]) == 1
        assert result["articles"][0]["title"] == "FAQ"


@pytest.mark.asyncio
async def test_search_knowledge_handles_no_results():
    """Search should handle empty results."""
    with patch('stella_agent.tools.db.search', new_callable=AsyncMock) as mock_search:
        mock_search.return_value = []

        result = await search_knowledge("nonexistent")

        assert result["found"] is False
        assert result["articles"] == []
```

## Best Practices

### General

- Write tests before or alongside code (TDD/BDD)
- Test behavior, not implementation
- Use descriptive test names that explain the scenario
- Keep tests focused and independent
- Avoid testing external dependencies directly

### Coverage Goals

| Component | Target Coverage |
|-----------|-----------------|
| Backend | 80%+ |
| Frontend | 70%+ |
| Agents | 80%+ |

### What to Test

**Do test:**
- Business logic and edge cases
- Error handling
- User interactions
- API contracts

**Don't test:**
- Framework code
- Third-party libraries
- Simple getters/setters
- Implementation details
