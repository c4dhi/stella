import { PrismaService } from '../prisma/prisma.service';
import { PlanData, StateMachineService } from './state-machine.service';

// Minimal in-memory shape for SessionState rows used by this spec.
// We only model the fields that StateMachineService reads/writes.
type SessionStateRecord = {
  id: string;
  sessionId: string;
  planId: string | null;
  planData: PlanData;
  currentStateId: string;
  completedTasks: string[];
  skippedTasks: string[];
  deliverables: Record<string, unknown>;
  turnsWithoutProgress: number;
  totalTurns: number;
  createdAt: Date;
  updatedAt: Date;
  lastTransitionAt: Date | null;
};

function clone<T>(value: T): T {
  // Keep mock behavior close to Prisma: callers always receive detached data.
  return structuredClone(value);
}

function createPrismaMock() {
  // In-memory "table" keyed by sessionId.
  const store = new Map<string, SessionStateRecord>();

  const sessionState = {
    // Simulates prisma.sessionState.findUnique({ where: { sessionId } })
    findUnique: jest.fn(async ({ where: { sessionId } }: { where: { sessionId: string } }) => {
      const record = store.get(sessionId);
      return record ? clone(record) : null;
    }),
    // Simulates prisma.sessionState.create(...)
    create: jest.fn(async ({ data }: { data: Partial<SessionStateRecord> & { sessionId: string } }) => {
      const now = new Date();
      const record: SessionStateRecord = {
        id: `state-${data.sessionId}`,
        sessionId: data.sessionId,
        planId: data.planId || null,
        planData: data.planData as PlanData,
        currentStateId: data.currentStateId as string,
        completedTasks: (data.completedTasks || []) as string[],
        skippedTasks: (data.skippedTasks || []) as string[],
        deliverables: (data.deliverables || {}) as Record<string, unknown>,
        turnsWithoutProgress: (data.turnsWithoutProgress || 0) as number,
        totalTurns: (data.totalTurns || 0) as number,
        createdAt: now,
        updatedAt: now,
        lastTransitionAt: null,
      };
      store.set(data.sessionId, record);
      return clone(record);
    }),
    // Simulates prisma.sessionState.update(...), including Prisma-style
    // numeric increment operations used by incrementTurn().
    update: jest.fn(async ({ where: { sessionId }, data }: { where: { sessionId: string }; data: Record<string, unknown> }) => {
      const record = store.get(sessionId);
      if (!record) {
        throw new Error(`Session state not found: ${sessionId}`);
      }

      const next = clone(record) as SessionStateRecord & Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          'increment' in (value as Record<string, unknown>)
        ) {
          const amount = Number((value as { increment: number }).increment);
          next[key] = Number(next[key] || 0) + amount;
        } else {
          next[key] = value;
        }
      }

      next.updatedAt = new Date();
      store.set(sessionId, next as SessionStateRecord);
      return clone(next);
    }),
  };

  return {
    // Service only touches prisma.sessionState in these tests.
    prisma: { sessionState } as unknown as PrismaService,
  };
}

function buildNonLinearPlan(): PlanData {
  // Test plan intentionally supports non-linear routing:
  // A can jump directly to C (skipping B), and C can jump backward to A.
  return {
    id: 'plan-nonlinear',
    title: 'Non Linear Plan',
    initial_state_id: 'state-a',
    states: [
      {
        id: 'state-a',
        title: 'A',
        type: 'loose',
        tasks: [
          {
            id: 'task-a',
            description: 'Collect route',
            deliverables: [
              { key: 'route_to_c', description: 'Route to C', required: true, type: 'string' },
            ],
          },
        ],
        transitions: [
          {
            target_state_id: 'state-c',
            condition_type: 'deliverable_exists',
            condition_config: { key: 'route_to_c' },
            priority: 1,
          },
        ],
      },
      {
        id: 'state-b',
        title: 'B',
        type: 'loose',
        tasks: [
          {
            id: 'task-b',
            description: 'Middle state task',
            deliverables: [
              { key: 'middle_data', description: 'Middle data', required: true, type: 'string' },
            ],
          },
        ],
        // Intentionally empty so StateMachineService.ensureTransitions()
        // auto-generates B -> C. This mirrors real plan normalization.
        transitions: [],
      },
      {
        id: 'state-c',
        title: 'C',
        type: 'loose',
        tasks: [
          {
            id: 'task-c',
            description: 'Collect return signal',
            deliverables: [
              { key: 'go_back', description: 'Go back to A', required: true, type: 'string' },
            ],
          },
        ],
        transitions: [
          {
            target_state_id: 'state-a',
            condition_type: 'deliverable_exists',
            condition_config: { key: 'go_back' },
            priority: 1,
          },
        ],
      },
    ],
  };
}

function buildCircularPlan(): PlanData {
  return {
    id: 'plan-circular',
    title: 'Circular Plan',
    initial_state_id: 'state-a',
    states: [
      {
        id: 'state-a',
        title: 'A',
        type: 'loose',
        tasks: [],
        transitions: [
          {
            target_state_id: 'state-b',
            condition_type: 'all_tasks_complete',
            priority: 1,
          },
        ],
      },
      {
        id: 'state-b',
        title: 'B',
        type: 'loose',
        tasks: [],
        transitions: [
          {
            target_state_id: 'state-a',
            condition_type: 'all_tasks_complete',
            priority: 1,
          },
        ],
      },
    ],
  };
}

function buildDeadEndPlan(): PlanData {
  // Dead-end scenario:
  // state-a has a transition, but its condition requires a deliverable key
  // that is never set in this test ("missing_key").
  // Expected behavior: no transition should happen.
  return {
    id: 'plan-dead-end',
    title: 'Dead End Plan',
    initial_state_id: 'state-a',
    states: [
      {
        id: 'state-a',
        title: 'A',
        type: 'loose',
        tasks: [],
        transitions: [
          {
            target_state_id: 'state-b',
            condition_type: 'deliverable_exists',
            condition_config: { key: 'missing_key' },
            priority: 1,
          },
        ],
      },
      {
        id: 'state-b',
        title: 'B',
        type: 'loose',
        tasks: [],
        transitions: [],
      },
    ],
  };
}

describe('StateMachineService non-linear transitions', () => {
  const sessionId = 'session-nonlinear';
  let service: StateMachineService;

  beforeEach(async () => {
    // Fresh service + isolated in-memory state per test.
    const { prisma } = createPrismaMock();
    service = new StateMachineService(prisma);
    await service.initializeForSession(sessionId, buildNonLinearPlan());
  });

  it('transitions forward to a non-adjacent state using transition target_state_id', async () => {
    // Verification target:
    // ensure transition follows explicit target_state_id (A -> C), not adjacency.
    const result = await service.setDeliverable(
      sessionId,
      'route_to_c',
      'yes',
      'User wants to skip to state C',
    );

    // Transition metadata should reflect explicit jump target.
    expect(result.success).toBe(true);
    expect(result.transitioned).toBe(true);
    expect(result.newStateId).toBe('state-c');

    // Current state should now be C, not B.
    const currentState = await service.getCurrentState(sessionId);
    expect(currentState?.stateId).toBe('state-c');

    // Task surface should also move to C's task set immediately.
    const pendingTasks = await service.getPendingTasks(sessionId);
    expect(pendingTasks.map(t => t.id)).toEqual(['task-c']);
  });

  it('marks state statuses correctly after backward jump', async () => {
    // Regression guard for getFullState():
    // after jumping backward (C -> A), statuses must reflect actual completion,
    // not state order in the plan array.
    await service.setDeliverable(sessionId, 'route_to_c', 'yes', 'Move to C');
    const backward = await service.setDeliverable(sessionId, 'go_back', 'yes', 'Move back to A');

    // Backward transition should be reported explicitly.
    expect(backward.success).toBe(true);
    expect(backward.transitioned).toBe(true);
    expect(backward.newStateId).toBe('state-a');

    const fullState = await service.getFullState(sessionId);
    expect(fullState?.currentStateId).toBe('state-a');

    // Core regression assertion:
    // state status must come from actual completion checks, not array position.
    // After C -> A jump:
    // - A is active (current)
    // - B remains pending (never completed)
    // - C remains completed (its required deliverable was collected)
    const stateStatus = new Map(fullState?.states.map(s => [s.id, s.status]));
    expect(stateStatus.get('state-a')).toBe('active');
    expect(stateStatus.get('state-b')).toBe('pending');
    expect(stateStatus.get('state-c')).toBe('completed');
  });

  it('stops circular transitions with max-transitions-per-turn guard', async () => {
    const circularSessionId = 'session-circular';
    await service.initializeForSession(circularSessionId, buildCircularPlan());

    // Call transition evaluation directly to verify backend loop guard behavior.
    const result = await (service as any).evaluateAndTransition(circularSessionId);

    expect(result.transitioned).toBe(true);
    expect(result.newStateId).toBeDefined();

    const state = await service.getCurrentState(circularSessionId);
    expect(state?.stateId).toBe(result.newStateId);
    expect(['state-a', 'state-b']).toContain(state?.stateId);
  });

  it('stays in current state when no transition condition matches (dead end)', async () => {
    const deadEndSessionId = 'session-dead-end';
    await service.initializeForSession(deadEndSessionId, buildDeadEndPlan());

    // Baseline: session starts in state-a.
    const before = await service.getCurrentState(deadEndSessionId);
    expect(before?.stateId).toBe('state-a');

    // Evaluate transitions directly with no deliverables present.
    // Transition condition should fail, so no state change.
    const result = await (service as any).evaluateAndTransition(deadEndSessionId);
    expect(result.transitioned).toBe(false);
    expect(result.newStateId).toBeUndefined();

    // Verify state remains unchanged after evaluation.
    const after = await service.getCurrentState(deadEndSessionId);
    expect(after?.stateId).toBe('state-a');
  });
});
