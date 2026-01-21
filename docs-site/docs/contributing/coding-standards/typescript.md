---
sidebar_position: 2
title: TypeScript
description: TypeScript coding standards for the STELLA backend
---

# TypeScript (Backend)

Standards for the NestJS backend codebase.

## Style Guide

We follow the [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript) with TypeScript extensions.

## Formatting

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

## Linting

```bash
# Run linter
npm run lint

# Fix auto-fixable issues
npm run lint:fix
```

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `SessionService` |
| Interfaces | PascalCase | `CreateSessionDto` |
| Functions | camelCase | `createSession` |
| Variables | camelCase | `sessionCount` |
| Constants | UPPER_SNAKE | `MAX_SESSIONS` |
| Files (classes) | kebab-case | `session.service.ts` |

## Code Examples

### Service

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

### DTO

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

## File Organization

```
src/
├── session/
│   ├── dto/
│   │   ├── create-session.dto.ts
│   │   └── update-session.dto.ts
│   ├── session.controller.ts
│   ├── session.service.ts
│   ├── session.module.ts
│   └── session.service.spec.ts
├── prisma/
│   ├── prisma.service.ts
│   └── prisma.module.ts
└── app.module.ts
```

## Best Practices

- Use `readonly` for injected dependencies
- Prefer `async/await` over raw Promises
- Use DTOs for all request/response bodies
- Add Swagger decorators for API documentation
- Handle errors with NestJS exception filters
