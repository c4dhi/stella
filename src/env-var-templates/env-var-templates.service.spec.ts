import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from './encryption.service';
import { EnvVarTemplatesService } from './env-var-templates.service';

type TemplateRow = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  variables: string;
  agentTypeId: string;
  createdAt: Date;
  updatedAt: Date;
};

function makeRow(over: Partial<TemplateRow> = {}): TemplateRow {
  const now = new Date();
  return {
    id: 'tpl-1',
    userId: 'user-1',
    name: 'Keys',
    description: null,
    variables: 'enc',
    agentTypeId: 'type-A',
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function createService(rows: TemplateRow[], agentTypeIds: string[] = ['type-A', 'type-B']) {
  const prisma = {
    envVarTemplate: {
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter(
          (r) =>
            r.userId === where.userId &&
            (where.agentTypeId === undefined || r.agentTypeId === where.agentTypeId),
        ),
      ),
      findUnique: jest.fn(async ({ where: { id } }: any) =>
        rows.find((r) => r.id === id) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => makeRow(data)),
    },
    agentType: {
      findUnique: jest.fn(async ({ where: { id } }: any) =>
        agentTypeIds.includes(id) ? { id } : null,
      ),
    },
  } as unknown as PrismaService;

  const encryption = {
    encrypt: jest.fn(() => 'enc'),
    decrypt: jest.fn(() => ({})),
    getKeys: jest.fn(() => ['OPENAI_API_KEY']),
  } as unknown as EncryptionService;

  return new EnvVarTemplatesService(prisma, encryption);
}

describe('EnvVarTemplatesService', () => {
  describe('findByAgentType', () => {
    it('returns only templates matching the agent type (no generic fallthrough)', async () => {
      const rows = [
        makeRow({ id: 't1', agentTypeId: 'type-A' }),
        makeRow({ id: 't2', agentTypeId: 'type-B' }),
      ];
      const svc = createService(rows);
      const result = await svc.findByAgentType('user-1', 'type-A');
      expect(result.map((r) => r.id)).toEqual(['t1']);
    });
  });

  describe('create', () => {
    it('rejects an unknown agentTypeId', async () => {
      const svc = createService([]);
      await expect(
        svc.create('user-1', {
          name: 'X',
          variables: { K: 'v' },
          agentTypeId: 'does-not-exist',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates when the agentTypeId exists', async () => {
      const svc = createService([]);
      const created = await svc.create('user-1', {
        name: 'X',
        variables: { K: 'v' },
        agentTypeId: 'type-A',
      });
      expect(created.agentTypeId).toBe('type-A');
    });
  });

  describe('assertCompatibleWithAgentType', () => {
    it('passes when the template matches the target type', async () => {
      const svc = createService([makeRow({ id: 't1', agentTypeId: 'type-A' })]);
      await expect(
        svc.assertCompatibleWithAgentType('t1', 'user-1', 'type-A'),
      ).resolves.toBeUndefined();
    });

    it('throws 400 on a type mismatch', async () => {
      const svc = createService([makeRow({ id: 't1', agentTypeId: 'type-A' })]);
      await expect(
        svc.assertCompatibleWithAgentType('t1', 'user-1', 'type-B'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws 404 when the template is not owned by the user', async () => {
      const svc = createService([makeRow({ id: 't1', userId: 'someone-else' })]);
      await expect(
        svc.assertCompatibleWithAgentType('t1', 'user-1', 'type-A'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
