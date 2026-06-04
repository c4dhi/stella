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
        // turn_count_exceeded with turns:0 is trivially true on entry
        // (totalTurns starts at 0), giving a stable always-true condition to
        // exercise the cycle guard without relying on all_tasks_complete (which
        // no longer fires for no-required-work states, #172).
        transitions: [
          {
            target_state_id: 'state-b',
            condition_type: 'turn_count_exceeded',
            condition_config: { turns: 0, scope: 'total' },
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
            condition_type: 'turn_count_exceeded',
            condition_config: { turns: 0, scope: 'total' },
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

function buildMultiMatchPriorityPlan(): PlanData {
  // Multiple transitions from state-a intentionally match at the same time.
  // The lower priority number (1) should win deterministically.
  // Both conditions use turn_count_exceeded turns:0 (trivially true on entry) so
  // the test exercises priority resolution rather than all_tasks_complete, which
  // no longer fires for no-required-work states (#172).
  return {
    id: 'plan-multi-match-priority',
    title: 'Multi Match Priority Plan',
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
            condition_type: 'turn_count_exceeded',
            condition_config: { turns: 0, scope: 'total' },
            priority: 2,
          },
          {
            target_state_id: 'state-c',
            condition_type: 'turn_count_exceeded',
            condition_config: { turns: 0, scope: 'total' },
            priority: 1,
          },
        ],
      },
      { id: 'state-b', title: 'B', type: 'loose', tasks: [], transitions: [] },
      { id: 'state-c', title: 'C', type: 'loose', tasks: [], transitions: [] },
    ],
  };
}

function buildMultiMatchTiePlan(): PlanData {
  // Tie case: both transitions from state-a have identical priority and both match.
  // We verify runtime behavior stays deterministic across repeated runs.
  // turn_count_exceeded turns:0 is trivially true on entry — a stable always-true
  // condition independent of the no-required-work completion fix (#172).
  return {
    id: 'plan-multi-match-tie',
    title: 'Multi Match Tie Plan',
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
            condition_type: 'turn_count_exceeded',
            condition_config: { turns: 0, scope: 'total' },
            priority: 1,
          },
          {
            target_state_id: 'state-c',
            condition_type: 'turn_count_exceeded',
            condition_config: { turns: 0, scope: 'total' },
            priority: 1,
          },
        ],
      },
      { id: 'state-b', title: 'B', type: 'loose', tasks: [], transitions: [] },
      { id: 'state-c', title: 'C', type: 'loose', tasks: [], transitions: [] },
    ],
  };
}

function buildGoalStatePlan(): PlanData {
  return {
    id: 'plan-goal-state',
    title: 'Goal State Plan',
    initial_state_id: 'state-goal',
    states: [
      {
        id: 'state-goal',
        title: 'Goal',
        type: 'goal',
        goal: {
          objective: 'Help participant define a concrete next step',
          success_description: 'Participant states a concrete, realistic next step they will take this week',
        },
        tasks: [],
        transitions: [],
      },
      {
        id: 'state-next',
        title: 'Next',
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

  it('uses priority deterministically when multiple transition conditions match', async () => {
    // Both transitions are trivially true (turn_count_exceeded turns:0),
    // so transition choice must be resolved by priority.
    const sessionId = 'session-multi-match-priority';
    await service.initializeForSession(sessionId, buildMultiMatchPriorityPlan());

    const result = await (service as any).evaluateAndTransition(sessionId);
    expect(result.transitioned).toBe(true);
    // priority=1 transition targets state-c, so it must win over priority=2.
    expect(result.newStateId).toBe('state-c');

    const state = await service.getCurrentState(sessionId);
    expect(state?.stateId).toBe('state-c');
  });

  it('remains deterministic when multiple matching transitions have equal priority', async () => {
    // Run the same tie-priority setup multiple times with fresh sessions.
    // Expected: identical outcome each run (stable deterministic selection).
    const outcomes: string[] = [];

    for (let i = 0; i < 5; i++) {
      const sessionId = `session-multi-match-tie-${i}`;
      await service.initializeForSession(sessionId, buildMultiMatchTiePlan());
      const result = await (service as any).evaluateAndTransition(sessionId);
      expect(result.transitioned).toBe(true);
      outcomes.push(result.newStateId as string);
    }

    // If deterministic, all outcomes collapse to a single selected target.
    expect(new Set(outcomes).size).toBe(1);
  });
});

describe('goal_achieved condition', () => {
  it('auto-generates goal_achieved as default transition for goal states', async () => {
    const sessionId = 'session-goal-default-transition';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, buildGoalStatePlan());

    const rawState = await (svc as any).getState(sessionId);
    const goalState = (rawState?.planData as PlanData)?.states.find((state) => state.id === 'state-goal');

    expect(goalState?.transitions[0]?.condition_type).toBe('goal_achieved');
  });

  it('does not transition immediately in goal states without deliverables', async () => {
    const sessionId = 'session-goal-no-immediate-transition';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, buildGoalStatePlan());

    const result = await (svc as any).evaluateAndTransition(sessionId);

    expect(result.transitioned).toBe(false);
    expect(result.newStateId).toBeUndefined();
  });

  it('treats required goal tasks without deliverables as auto-complete in state completion checks', async () => {
    const sessionId = 'session-goal-action-task-auto-complete';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    const plan = buildGoalStatePlan();
    plan.states[0].tasks = [
      {
        id: 'action-task',
        description: 'A guidance/action step without deliverables',
      },
    ];
    await svc.initializeForSession(sessionId, plan);

    const state = await (svc as any).getState(sessionId);
    const planState = (state.planData as PlanData).states.find((s) => s.id === 'state-goal');
    const isComplete = (svc as any).isCurrentStateComplete(state, planState);

    expect(isComplete).toBe(true);
  });

  it('transitions when __goal_achieved__ is set truthy', async () => {
    const sessionId = 'session-goal-achieved';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, buildGoalStatePlan());

    const result = await svc.setDeliverable(
      sessionId,
      '__goal_achieved__',
      true,
      'Objective is met',
    );

    expect(result.transitioned).toBe(true);
    expect(result.newStateId).toBe('state-next');
  });

  it('still transitions via goal_achieved when goal state has an action task without deliverables', async () => {
    const sessionId = 'session-goal-achieved-with-action-task';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    const plan = buildGoalStatePlan();
    plan.states[0].tasks = [
      {
        id: 'action-task',
        description: 'Offer reflective summary to participant',
      },
    ];
    await svc.initializeForSession(sessionId, plan);

    const result = await svc.setDeliverable(
      sessionId,
      '__goal_achieved__',
      true,
      'Objective reached after action step',
    );

    expect(result.transitioned).toBe(true);
    expect(result.newStateId).toBe('state-next');
  });

  it('does not auto-evaluate transitions for arbitrary discovered goal insights', async () => {
    const sessionId = 'session-goal-discovered-insight-no-auto-transition';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    const plan = buildGoalStatePlan();
    plan.states[0].transitions = [
      {
        target_state_id: 'state-next',
        condition_type: 'deliverable_exists',
        condition_config: { deliverable_key: 'insight_summary' },
        priority: 1,
      },
    ];
    await svc.initializeForSession(sessionId, plan);

    const result = await svc.setDeliverable(
      sessionId,
      'insight_summary',
      'User shared enough context',
      'Captured as discovered insight',
    );

    expect(result.success).toBe(true);
    expect(result.transitioned).toBe(false);

    const current = await svc.getCurrentState(sessionId);
    expect(current?.stateId).toBe('state-goal');
  });

  it('injects goal completion instruction using success_description in synthetic goal task', async () => {
    const sessionId = 'session-goal-instruction';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, buildGoalStatePlan());

    const pendingTasks = await svc.getPendingTasks(sessionId);
    const goalTask = pendingTasks.find((task) => task.id === '__goal__');

    expect(goalTask?.instruction).toContain('success criteria is met');
    expect(goalTask?.instruction).toContain('setDeliverable("__goal_achieved__", true)');
  });

  it('migrates goal all_tasks_complete transitions to goal_achieved', async () => {
    const sessionId = 'session-goal-all-tasks-complete-blocked';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    const plan = buildGoalStatePlan();
    plan.states[0].transitions = [
      {
        target_state_id: 'state-next',
        condition_type: 'all_tasks_complete',
        priority: 1,
      },
    ];
    await svc.initializeForSession(sessionId, plan);

    const rawState = await (svc as any).getState(sessionId);
    const goalState = (rawState?.planData as PlanData)?.states.find((state) => state.id === 'state-goal');
    expect(goalState?.transitions?.[0]?.condition_type).toBe('goal_achieved');

    const result = await (svc as any).evaluateAndTransition(sessionId);

    expect(result.transitioned).toBe(false);
    expect(result.newStateId).toBeUndefined();
  });

  it('does not allow goal_achieved transitions for non-goal states', async () => {
    const sessionId = 'session-non-goal-goal-achieved-blocked';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    const plan = buildTwoStatePlan(
      {
        target_state_id: 'state-b',
        condition_type: 'goal_achieved',
        priority: 1,
      },
      ['__goal_achieved__'],
    );
    await svc.initializeForSession(sessionId, plan);

    await svc.setDeliverable(sessionId, '__goal_achieved__', true, 'marker set');
    const result = await (svc as any).evaluateAndTransition(sessionId);

    expect(result.transitioned).toBe(false);
    expect(result.newStateId).toBeUndefined();
  });
});

// =============================================================================
// New condition types (ported from main via PR-121 fix)
//
// Each describe block isolates one condition type and covers:
//   - the happy path (condition fires and transition happens)
//   - the negative path (condition does not fire, state stays put)
//   - edge/invalid config cases where applicable
// =============================================================================

// ---------------------------------------------------------------------------
// Helper: build a minimal two-state plan with a configurable transition on
// state-a.  Used across all new-condition-type tests to avoid repetition.
//
// deliverableKeys: optional list of deliverable keys to register on state-a's
// task.  setDeliverable() rejects unknown keys on strict/loose states, so any
// deliverable the test plans to set must be declared here.  Keys are marked
// required:false so their absence doesn't block all_tasks_complete evaluation.
// ---------------------------------------------------------------------------
function buildTwoStatePlan(
  transition: import('./state-machine.service').StateTransition,
  deliverableKeys: string[] = [],
): PlanData {
  return {
    id: 'plan-two-state',
    title: 'Two State Plan',
    initial_state_id: 'state-a',
    states: [
      {
        id: 'state-a',
        title: 'A',
        type: 'loose',
        tasks: deliverableKeys.length > 0
          ? [
              {
                id: 'task-collect',
                description: 'Collect deliverables used by this test',
                deliverables: deliverableKeys.map(key => ({
                  key,
                  description: key,
                  required: false, // optional so state-a isn't blocked waiting for them
                })),
              },
            ]
          : [],
        transitions: [transition],
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

// ---------------------------------------------------------------------------
// Helper: initialise a fresh service + session, optionally pre-seed
// deliverables, and return the service ready for a transition check.
// ---------------------------------------------------------------------------
async function setupSession(
  sessionId: string,
  plan: PlanData,
  deliverables: Record<string, { value: unknown; reasoning: string }> = {},
): Promise<StateMachineService> {
  const { prisma } = createPrismaMock();
  const svc = new StateMachineService(prisma);
  await svc.initializeForSession(sessionId, plan);

  // Seed each deliverable via the public API so the service's internal state
  // is consistent (completedTasks, etc.) rather than injecting raw DB rows.
  for (const [key, { value, reasoning }] of Object.entries(deliverables)) {
    await svc.setDeliverable(sessionId, key, value, reasoning);
  }

  return svc;
}

// =============================================================================
// turn_count_exceeded
// Fires when a turn counter (total turns or turns without progress) crosses a
// threshold.  Useful for automatic fallback / escalation routes in a plan.
// =============================================================================
describe('turn_count_exceeded condition', () => {
  it('transitions when turns_without_progress meets the threshold (scope: without_progress)', async () => {
    // The default scope is 'without_progress'.  We need at least 2 turns without
    // setting a deliverable for this condition to fire.
    const sessionId = 'session-turn-without-progress';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'turn_count_exceeded',
      condition_config: { turns: 2, scope: 'without_progress' },
      priority: 1,
    });

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);

    // incrementTurn() advances both counters (total and without-progress) without
    // touching deliverables, AND now re-evaluates transitions itself (#172) — so
    // the transition fires on the turn that crosses the threshold, not on a
    // separate evaluation pass.
    const firstTurn = await svc.incrementTurn(sessionId); // turn 1 — below threshold
    expect(firstTurn.transitioned).toBe(false);

    const result = await svc.incrementTurn(sessionId); // turn 2 — reaches threshold
    expect(result.transitioned).toBe(true);
    expect(result.newStateId).toBe('state-b');
  });

  it('does NOT transition when turns_without_progress is below the threshold', async () => {
    // Only 1 turn has passed; threshold is 2 — should stay in state-a.
    const sessionId = 'session-turn-below-threshold';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'turn_count_exceeded',
      condition_config: { turns: 2, scope: 'without_progress' },
      priority: 1,
    });

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);
    await svc.incrementTurn(sessionId); // only 1 turn — threshold of 2 not reached

    const result = await (svc as any).evaluateAndTransition(sessionId);
    expect(result.transitioned).toBe(false);
  });

  it('transitions based on total turns (scope: total)', async () => {
    // 'total' scope counts all turns regardless of whether progress was made.
    // incrementTurn() increments totalTurns and re-evaluates transitions (#172),
    // so a single turn both reaches the threshold and fires the transition.
    const sessionId = 'session-turn-total';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'turn_count_exceeded',
      condition_config: { turns: 1, scope: 'total' },
      priority: 1,
    });

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);

    // One turn is enough to reach totalTurns >= 1, and incrementTurn transitions.
    const result = await svc.incrementTurn(sessionId);
    expect(result.transitioned).toBe(true);
    expect(result.newStateId).toBe('state-b');
  });

  it('skips the transition and logs a warning when config is invalid (missing turns)', async () => {
    // Invalid config: 'turns' field is missing entirely.
    // The transition must be skipped (fail-closed) rather than throw.
    const sessionId = 'session-turn-invalid';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'turn_count_exceeded',
      condition_config: { scope: 'total' }, // missing 'turns' / 'value'
      priority: 1,
    });

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);
    await svc.incrementTurn(sessionId);

    // validateConditionConfig() catches the missing field and skips the transition.
    const result = await (svc as any).evaluateAndTransition(sessionId);
    expect(result.transitioned).toBe(false);
  });
});

// =============================================================================
// All-optional states (#172)
// A state whose tasks/deliverables are all optional must NOT auto-complete on
// entry (that skipped it instantly, sometimes jumping several states). Instead
// the agent "tries" the optional work for a few turns, then the state releases
// on a turn-based fallback — it does not persist the way required work does.
// =============================================================================
describe('all-optional state handling (#172)', () => {
  // required state-a -> all-optional state-b -> state-c.
  // state-b has only an optional deliverable; pass stateBTransitions to give it
  // an explicit route, otherwise it relies on the auto-injected turn fallback.
  function buildOptionalMiddlePlan(
    stateBTransitions?: import('./state-machine.service').StateTransition[],
  ): PlanData {
    return {
      id: 'plan-optional-middle',
      title: 'Optional Middle Plan',
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
              deliverables: [{ key: 'go_to_b', description: 'go', required: true, type: 'string' }],
            },
          ],
          transitions: [
            {
              target_state_id: 'state-b',
              condition_type: 'deliverable_exists',
              condition_config: { key: 'go_to_b' },
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
              description: 'Optional chat',
              deliverables: [{ key: 'opt_note', description: 'optional note', required: false }],
            },
          ],
          ...(stateBTransitions ? { transitions: stateBTransitions } : {}),
        },
        { id: 'state-c', title: 'C', type: 'loose', tasks: [], transitions: [] },
      ],
    };
  }

  it('does not skip an all-optional state on entry', async () => {
    const sessionId = 'session-optional-no-skip';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, buildOptionalMiddlePlan());

    // Enter state-b by satisfying state-a's required deliverable.
    const enter = await svc.setDeliverable(sessionId, 'go_to_b', 'yes', 'routing');
    expect(enter.transitioned).toBe(true);
    expect(enter.newStateId).toBe('state-b');

    // It must NOT chain straight through the all-optional state-b to state-c.
    const state = await svc.getCurrentState(sessionId);
    expect(state?.stateId).toBe('state-b');
  });

  it('auto-injects a turn-based fallback (not all_tasks_complete) for an all-optional state', async () => {
    const sessionId = 'session-optional-fallback-shape';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, buildOptionalMiddlePlan());

    const raw = await (svc as any).getState(sessionId);
    const states = (raw.planData as PlanData).states;
    const stateB = states.find((s) => s.id === 'state-b');
    expect(stateB?.transitions?.[0]?.condition_type).toBe('turn_count_exceeded');
    expect(stateB?.transitions?.[0]?.target_state_id).toBe('state-c');

    // A required-work state is left untouched — no turn fallback appended.
    const stateA = states.find((s) => s.id === 'state-a');
    expect(stateA?.transitions?.map((t) => t.condition_type)).toEqual(['deliverable_exists']);
  });

  it('releases an all-optional state after the default no-progress threshold', async () => {
    const sessionId = 'session-optional-release';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, buildOptionalMiddlePlan());
    await svc.setDeliverable(sessionId, 'go_to_b', 'yes', 'routing'); // -> state-b

    // Default threshold is 3 turns without progress: try for two, release on the third.
    expect((await svc.incrementTurn(sessionId)).transitioned).toBe(false);
    expect((await svc.incrementTurn(sessionId)).transitioned).toBe(false);
    const release = await svc.incrementTurn(sessionId);
    expect(release.transitioned).toBe(true);
    expect(release.newStateId).toBe('state-c');
  });

  it('takes an explicit data route immediately, keeping the turn fallback only as backup', async () => {
    const sessionId = 'session-optional-data-route';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(
      sessionId,
      buildOptionalMiddlePlan([
        {
          target_state_id: 'state-c',
          condition_type: 'deliverable_exists',
          condition_config: { key: 'opt_note' },
          priority: 1,
        },
      ]),
    );
    await svc.setDeliverable(sessionId, 'go_to_b', 'yes', 'routing'); // -> state-b
    expect((await svc.getCurrentState(sessionId))?.stateId).toBe('state-b');

    // Providing the optional note wins via the explicit route (priority 1) over
    // the injected turn fallback (priority 1000) — no need to wait out the turns.
    const res = await svc.setDeliverable(sessionId, 'opt_note', 'hello', 'optional');
    expect(res.transitioned).toBe(true);
    expect(res.newStateId).toBe('state-c');
  });

  // required state-a -> all-optional state-b -> all-optional state-c -> state-d.
  // Two consecutive non-terminal all-optional states both get a turn fallback.
  // Guards against the multi-skip regression: when the no-progress threshold is
  // reached in state-b, the chained evaluation loop must only hop ONE state. The
  // counter is reset in the DB on transition; it must also be reset in-memory so
  // state-c doesn't see state-b's stale counter and fire its own fallback in the
  // same pass — each state must get its own turn window.
  function buildTwoOptionalPlan(): PlanData {
    return {
      id: 'plan-two-optional',
      title: 'Two Optional Plan',
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
              deliverables: [{ key: 'go_to_b', description: 'go', required: true, type: 'string' }],
            },
          ],
          transitions: [
            {
              target_state_id: 'state-b',
              condition_type: 'deliverable_exists',
              condition_config: { key: 'go_to_b' },
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
              description: 'Optional chat',
              deliverables: [{ key: 'opt_b', description: 'optional note', required: false }],
            },
          ],
        },
        {
          id: 'state-c',
          title: 'C',
          type: 'loose',
          tasks: [
            {
              id: 'task-c',
              description: 'Optional chat',
              deliverables: [{ key: 'opt_c', description: 'optional note', required: false }],
            },
          ],
        },
        { id: 'state-d', title: 'D', type: 'loose', tasks: [], transitions: [] },
      ],
    };
  }

  it('hops only one state per threshold across consecutive all-optional states', async () => {
    const sessionId = 'session-two-optional-no-multiskip';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, buildTwoOptionalPlan());
    await svc.setDeliverable(sessionId, 'go_to_b', 'yes', 'routing'); // -> state-b

    // Reach the no-progress threshold (3) in state-b: it releases to state-c only.
    expect((await svc.incrementTurn(sessionId)).transitioned).toBe(false);
    expect((await svc.incrementTurn(sessionId)).transitioned).toBe(false);
    const hopB = await svc.incrementTurn(sessionId);
    expect(hopB.transitioned).toBe(true);
    // Must land on state-c, NOT skip straight through to state-d in the same pass.
    expect(hopB.newStateId).toBe('state-c');
    expect((await svc.getCurrentState(sessionId))?.stateId).toBe('state-c');

    // state-c gets its OWN turn window — the counter was reset on entry.
    expect((await svc.incrementTurn(sessionId)).transitioned).toBe(false);
    expect((await svc.incrementTurn(sessionId)).transitioned).toBe(false);
    const hopC = await svc.incrementTurn(sessionId);
    expect(hopC.transitioned).toBe(true);
    expect(hopC.newStateId).toBe('state-d');
  });

  it('isCurrentStateComplete returns false for a non-goal state with only optional work', async () => {
    const sessionId = 'session-optional-iscomplete';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    const plan: PlanData = {
      id: 'plan-opt-only',
      title: 'Optional Only',
      initial_state_id: 's',
      states: [
        {
          id: 's',
          title: 'S',
          type: 'loose',
          tasks: [
            {
              id: 't',
              description: 'opt-only',
              deliverables: [{ key: 'opt', description: 'optional', required: false }],
            },
          ],
          transitions: [],
        },
      ],
    };
    await svc.initializeForSession(sessionId, plan);

    const raw = await (svc as any).getState(sessionId);
    const planState = (raw.planData as PlanData).states[0];
    // No required work → must not be treated as vacuously complete (#172).
    expect((svc as any).isCurrentStateComplete(raw, planState)).toBe(false);
  });
});

// =============================================================================
// Optional tasks must not be auto-completed on startup (#213)
// getFullState() reports per-task status to the frontend. A task with zero
// REQUIRED deliverables must surface as 'pending' on a fresh session, not
// 'completed' — otherwise `requiredKeys.every(...)` is vacuously true and the
// UI renders a green checkmark before the user has done anything.
// =============================================================================
describe('getFullState optional-task status on startup (#213)', () => {
  // One state holding three contrasting tasks:
  // - opt-deliverable-task: has only an optional deliverable (requiredKeys === [])
  //                         — this is the case that actually exercised the bug.
  // - optional-task:        the task itself is required:false. Note getFullState()'s
  //                         STATUS computation never reads task.required; this case
  //                         exists to pin the surfaced `.required` output flag (the
  //                         only thing task.required drives) and to confirm a task
  //                         whose required deliverable is uncollected stays pending.
  // - required-task:        a normal required deliverable (positive control).
  const buildOptionalTaskPlan = (): PlanData => ({
    id: 'plan-optional-tasks',
    title: 'Optional Tasks',
    initial_state_id: 's',
    states: [
      {
        id: 's',
        title: 'S',
        type: 'loose',
        tasks: [
          {
            id: 'opt-deliverable-task',
            description: 'task whose only deliverable is optional',
            deliverables: [{ key: 'opt_note', description: 'optional note', required: false }],
          },
          {
            id: 'optional-task',
            description: 'task explicitly marked optional',
            required: false,
            deliverables: [{ key: 'maybe_field', description: 'maybe', required: true }],
          },
          {
            id: 'required-task',
            description: 'normal required task',
            deliverables: [{ key: 'must_field', description: 'must', required: true }],
          },
        ],
        transitions: [],
      },
    ],
  });

  it('reports tasks with no required deliverables as pending, not completed', async () => {
    const sessionId = 'session-213-startup';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, buildOptionalTaskPlan());

    const fullState = await svc.getFullState(sessionId);
    const tasks = new Map(fullState?.states[0].tasks.map(t => [t.id, t.status]));

    // Core regression assertions for #213: nothing is completed before any work.
    expect(tasks.get('opt-deliverable-task')).toBe('pending');
    expect(tasks.get('optional-task')).toBe('pending');
    expect(tasks.get('required-task')).toBe('pending');

    // The task-level `required` flag does not affect status (status is computed
    // purely from deliverables), but it must still be surfaced correctly so the
    // frontend can distinguish optional tasks. This is the only path task.required
    // drives (state-machine.service.ts:1985).
    const required = new Map(fullState?.states[0].tasks.map(t => [t.id, t.required]));
    expect(required.get('optional-task')).toBe(false);
    expect(required.get('opt-deliverable-task')).toBe(true);
    expect(required.get('required-task')).toBe(true);
  });

  it('still completes a task once its required deliverable is collected', async () => {
    const sessionId = 'session-213-collected';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, buildOptionalTaskPlan());

    await svc.setDeliverable(sessionId, 'must_field', 'done', 'collected');

    const fullState = await svc.getFullState(sessionId);
    const tasks = new Map(fullState?.states[0].tasks.map(t => [t.id, t.status]));

    // Positive control: the guard must not block legitimate completion.
    expect(tasks.get('required-task')).toBe('completed');
    // Untouched optional tasks stay pending.
    expect(tasks.get('opt-deliverable-task')).toBe('pending');
    expect(tasks.get('optional-task')).toBe('pending');
  });

  it('marks an optional-only-deliverable task in_progress once that deliverable is provided', async () => {
    const sessionId = 'session-213-optional-progress';
    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, buildOptionalTaskPlan());

    await svc.setDeliverable(sessionId, 'opt_note', 'hi', 'optional provided');

    const fullState = await svc.getFullState(sessionId);
    const tasks = new Map(fullState?.states[0].tasks.map(t => [t.id, t.status]));

    // Optional work that was actually done shows progress but never auto-completes.
    expect(tasks.get('opt-deliverable-task')).toBe('in_progress');
  });
});

// =============================================================================
// deliverable_value_in
// Fires when a deliverable's value is present in a predefined set of values.
// Useful for enum-style routing (e.g. user picks 'option_a', 'option_b', …).
// =============================================================================
describe('deliverable_value_in condition', () => {
  it('transitions when the deliverable value is in the allowed set', async () => {
    const sessionId = 'session-value-in-match';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'deliverable_value_in',
      condition_config: { key: 'user_choice', values: ['option_a', 'option_b', 'option_c'] },
      priority: 1,
    }, ['user_choice']); // register 'user_choice' so setDeliverable accepts it

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);

    // setDeliverable stores the value AND calls evaluateAndTransition internally,
    // so we check its return value directly rather than calling evaluateAndTransition again.
    const result = await svc.setDeliverable(sessionId, 'user_choice', 'option_b', 'User chose option B');

    expect(result.transitioned).toBe(true);
    expect(result.newStateId).toBe('state-b');
  });

  it('does NOT transition when the deliverable value is NOT in the allowed set', async () => {
    const sessionId = 'session-value-in-no-match';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'deliverable_value_in',
      condition_config: { key: 'user_choice', values: ['option_a', 'option_b'] },
      priority: 1,
    });

    const svc = await setupSession(sessionId, plan, {
      user_choice: { value: 'option_z', reasoning: 'User chose something unexpected' },
    });

    const result = await (svc as any).evaluateAndTransition(sessionId);
    expect(result.transitioned).toBe(false);
  });

  it('comparison is case-insensitive (string normalisation)', async () => {
    // 'OPTION_A' should match 'option_a' because areValuesEqualLoose() trims & lowercases.
    const sessionId = 'session-value-in-case';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'deliverable_value_in',
      condition_config: { key: 'choice', values: ['option_a'] },
      priority: 1,
    }, ['choice']);

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);

    // Uppercase value must still match lowercase entry in the values array.
    const result = await svc.setDeliverable(sessionId, 'choice', 'OPTION_A', 'uppercase input');

    expect(result.transitioned).toBe(true);
  });

  it('skips the transition when config is invalid (missing values array)', async () => {
    // 'values' field is absent — should fail-closed via validateConditionConfig().
    const sessionId = 'session-value-in-invalid';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'deliverable_value_in',
      condition_config: { key: 'choice' }, // missing 'values'
      priority: 1,
    });

    const svc = await setupSession(sessionId, plan, {
      choice: { value: 'option_a', reasoning: 'any value' },
    });

    const result = await (svc as any).evaluateAndTransition(sessionId);
    expect(result.transitioned).toBe(false);
  });
});

// =============================================================================
// deliverable_value_numeric
// Fires when a numeric deliverable satisfies a comparison operator.
// Supports: gt, gte, lt, lte, eq, neq, between (inclusive by default).
// =============================================================================
describe('deliverable_value_numeric condition', () => {
  it('transitions with operator "gt" when value is greater than threshold', async () => {
    const sessionId = 'session-numeric-gt';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'deliverable_value_numeric',
      condition_config: { key: 'score', operator: 'gt', value: 80 },
      priority: 1,
    }, ['score']);

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);

    // 95 > 80 → condition fires.  Check via setDeliverable return value.
    const result = await svc.setDeliverable(sessionId, 'score', 95, 'High score');

    expect(result.transitioned).toBe(true);
  });

  it('does NOT transition with operator "gt" when value equals the threshold (strict)', async () => {
    // 'gt' is strictly greater-than; equal value must not fire.
    const sessionId = 'session-numeric-gt-equal';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'deliverable_value_numeric',
      condition_config: { key: 'score', operator: 'gt', value: 80 },
      priority: 1,
    });

    const svc = await setupSession(sessionId, plan, {
      score: { value: 80, reasoning: 'Exactly at threshold' },
    });

    const result = await (svc as any).evaluateAndTransition(sessionId);
    expect(result.transitioned).toBe(false);
  });

  it('transitions with operator "lte" (symbolic alias <=)', async () => {
    // Verifies that symbolic operator aliases ('<=') are normalised to canonical 'lte'.
    const sessionId = 'session-numeric-lte';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'deliverable_value_numeric',
      condition_config: { key: 'risk', operator: '<=', value: 5 },
      priority: 1,
    }, ['risk']);

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);

    // 3 <= 5 → condition fires.
    const result = await svc.setDeliverable(sessionId, 'risk', 3, 'Low risk');

    expect(result.transitioned).toBe(true);
  });

  it('transitions with operator "between" (inclusive range)', async () => {
    const sessionId = 'session-numeric-between';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'deliverable_value_numeric',
      condition_config: { key: 'temperature', operator: 'between', min: 36, max: 38 },
      priority: 1,
    }, ['temperature']);

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);

    // Value exactly at the upper boundary must match because inclusive is true by default.
    const result = await svc.setDeliverable(sessionId, 'temperature', 38, 'At upper bound');

    expect(result.transitioned).toBe(true);
  });

  it('does NOT transition with "between" when value is outside the range', async () => {
    const sessionId = 'session-numeric-between-out';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'deliverable_value_numeric',
      condition_config: { key: 'temperature', operator: 'between', min: 36, max: 38 },
      priority: 1,
    });

    const svc = await setupSession(sessionId, plan, {
      temperature: { value: 40, reasoning: 'Too high' },
    });

    const result = await (svc as any).evaluateAndTransition(sessionId);
    expect(result.transitioned).toBe(false);
  });

  it('skips the transition when config is invalid (missing operator)', async () => {
    // No 'operator' field — should fail-closed.
    const sessionId = 'session-numeric-invalid';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'deliverable_value_numeric',
      condition_config: { key: 'score', value: 50 }, // missing 'operator'
      priority: 1,
    });

    const svc = await setupSession(sessionId, plan, {
      score: { value: 99, reasoning: 'High score' },
    });

    const result = await (svc as any).evaluateAndTransition(sessionId);
    expect(result.transitioned).toBe(false);
  });
});

// =============================================================================
// all_of  (composite AND)
// Fires only when ALL child conditions are true.
// =============================================================================
describe('all_of condition (composite AND)', () => {
  it('transitions when ALL child conditions are true', async () => {
    // Both 'consent' and 'age_verified' deliverables must be present.
    const sessionId = 'session-all-of-match';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'all_of',
      condition_config: {
        conditions: [
          { condition_type: 'deliverable_exists', condition_config: { key: 'consent' } },
          { condition_type: 'deliverable_exists', condition_config: { key: 'age_verified' } },
        ],
      },
      priority: 1,
    }, ['consent', 'age_verified']); // both keys must be registered so setDeliverable accepts them

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);

    // Set first deliverable — AND condition not yet satisfied, so no transition.
    const first = await svc.setDeliverable(sessionId, 'consent', 'yes', 'User gave consent');
    expect(first.transitioned).toBe(false);

    // Set second deliverable — both children now true, AND fires.
    const result = await svc.setDeliverable(sessionId, 'age_verified', 'yes', 'Age confirmed');
    expect(result.transitioned).toBe(true);
    expect(result.newStateId).toBe('state-b');
  });

  it('does NOT transition when only SOME child conditions are true (AND requires all)', async () => {
    // Only 'consent' is set; 'age_verified' is missing — AND must fail.
    const sessionId = 'session-all-of-partial';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'all_of',
      condition_config: {
        conditions: [
          { condition_type: 'deliverable_exists', condition_config: { key: 'consent' } },
          { condition_type: 'deliverable_exists', condition_config: { key: 'age_verified' } },
        ],
      },
      priority: 1,
    });

    const svc = await setupSession(sessionId, plan, {
      consent: { value: 'yes', reasoning: 'User gave consent' },
      // age_verified intentionally NOT set
    });

    const result = await (svc as any).evaluateAndTransition(sessionId);
    expect(result.transitioned).toBe(false);
  });
});

// =============================================================================
// any_of  (composite OR)
// Fires when AT LEAST ONE child condition is true.
// =============================================================================
describe('any_of condition (composite OR)', () => {
  it('transitions when at least one child condition is true', async () => {
    // Either 'express_checkout' OR 'standard_checkout' being present is enough.
    const sessionId = 'session-any-of-match';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'any_of',
      condition_config: {
        conditions: [
          { condition_type: 'deliverable_exists', condition_config: { key: 'express_checkout' } },
          { condition_type: 'deliverable_exists', condition_config: { key: 'standard_checkout' } },
        ],
      },
      priority: 1,
    }, ['express_checkout', 'standard_checkout']);

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);

    // Setting only 'standard_checkout' is enough — OR fires immediately on the first match.
    const result = await svc.setDeliverable(sessionId, 'standard_checkout', 'yes', 'Standard checkout selected');

    expect(result.transitioned).toBe(true);
    expect(result.newStateId).toBe('state-b');
  });

  it('does NOT transition when NO child condition is true', async () => {
    // Neither deliverable is set — OR must fail.
    const sessionId = 'session-any-of-none';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'any_of',
      condition_config: {
        conditions: [
          { condition_type: 'deliverable_exists', condition_config: { key: 'express_checkout' } },
          { condition_type: 'deliverable_exists', condition_config: { key: 'standard_checkout' } },
        ],
      },
      priority: 1,
    });

    // Neither deliverable set.
    const svc = await setupSession(sessionId, plan);

    const result = await (svc as any).evaluateAndTransition(sessionId);
    expect(result.transitioned).toBe(false);
  });
});

// =============================================================================
// compound  (explicit AND/OR via operator field)
// Same semantics as all_of / any_of but with an explicit 'operator' field.
// Useful when a plan generator prefers a uniform structure over named types.
// =============================================================================
describe('compound condition (explicit operator)', () => {
  it('transitions with operator "and" when all children are true', async () => {
    const sessionId = 'session-compound-and';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'compound',
      condition_config: {
        operator: 'and',
        conditions: [
          { condition_type: 'deliverable_exists', condition_config: { key: 'form_filled' } },
          { condition_type: 'deliverable_value', condition_config: { key: 'agreement', value: 'yes' } },
        ],
      },
      priority: 1,
    }, ['form_filled', 'agreement']);

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);

    // First deliverable alone is not enough — AND requires both.
    const first = await svc.setDeliverable(sessionId, 'form_filled', 'true', 'Form was completed');
    expect(first.transitioned).toBe(false);

    // Both children now satisfied — AND fires on the second setDeliverable.
    const result = await svc.setDeliverable(sessionId, 'agreement', 'yes', 'User agreed');
    expect(result.transitioned).toBe(true);
    expect(result.newStateId).toBe('state-b');
  });

  it('does NOT transition with operator "and" when one child is false', async () => {
    const sessionId = 'session-compound-and-fail';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'compound',
      condition_config: {
        operator: 'and',
        conditions: [
          { condition_type: 'deliverable_exists', condition_config: { key: 'form_filled' } },
          // agreement value won't match
          { condition_type: 'deliverable_value', condition_config: { key: 'agreement', value: 'yes' } },
        ],
      },
      priority: 1,
    });

    const svc = await setupSession(sessionId, plan, {
      form_filled: { value: 'true', reasoning: 'Form done' },
      agreement: { value: 'no', reasoning: 'User declined' }, // does NOT match 'yes'
    });

    const result = await (svc as any).evaluateAndTransition(sessionId);
    expect(result.transitioned).toBe(false);
  });

  it('transitions with operator "or" when only one child is true', async () => {
    const sessionId = 'session-compound-or';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'compound',
      condition_config: {
        operator: 'or',
        conditions: [
          { condition_type: 'deliverable_exists', condition_config: { key: 'fast_track' } },
          { condition_type: 'deliverable_exists', condition_config: { key: 'slow_track' } },
        ],
      },
      priority: 1,
    }, ['fast_track', 'slow_track']);

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);

    // Only 'fast_track' is set — OR fires immediately with the first match.
    const result = await svc.setDeliverable(sessionId, 'fast_track', 'yes', 'Fast track chosen');

    expect(result.transitioned).toBe(true);
  });

  it('skips the transition when operator is invalid (fail-closed)', async () => {
    // operator must be 'and' or 'or' — anything else must be rejected.
    const sessionId = 'session-compound-invalid-op';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'compound',
      condition_config: {
        operator: 'xor', // not a valid operator
        conditions: [
          { condition_type: 'deliverable_exists', condition_config: { key: 'item' } },
        ],
      },
      priority: 1,
    });

    const svc = await setupSession(sessionId, plan, {
      item: { value: 'yes', reasoning: 'Present' },
    });

    const result = await (svc as any).evaluateAndTransition(sessionId);
    expect(result.transitioned).toBe(false);
  });
});

// =============================================================================
// Nested composite conditions
// Verifies that all_of / any_of / compound can be nested inside each other.
// This exercises the recursive depth guard (MAX_CONDITION_DEPTH).
// =============================================================================
describe('nested composite conditions', () => {
  it('evaluates a two-level nested composite (all_of containing an any_of)', async () => {
    // Outer: all_of requires BOTH children to be true.
    // Child 1: deliverable_exists 'base_requirement'
    // Child 2: any_of — either 'route_a' or 'route_b' must be present.
    const sessionId = 'session-nested-composite';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'all_of',
      condition_config: {
        conditions: [
          {
            condition_type: 'deliverable_exists',
            condition_config: { key: 'base_requirement' },
          },
          {
            // Inner composite: OR of two possible routes.
            condition_type: 'any_of',
            condition_config: {
              conditions: [
                { condition_type: 'deliverable_exists', condition_config: { key: 'route_a' } },
                { condition_type: 'deliverable_exists', condition_config: { key: 'route_b' } },
              ],
            },
          },
        ],
      },
      priority: 1,
    }, ['base_requirement', 'route_a', 'route_b']); // all keys referenced in conditions must be registered

    const { prisma } = createPrismaMock();
    const svc = new StateMachineService(prisma);
    await svc.initializeForSession(sessionId, plan);

    // Only base_requirement set — inner OR has no match yet, outer AND still fails.
    const first = await svc.setDeliverable(sessionId, 'base_requirement', 'met', 'Base condition satisfied');
    expect(first.transitioned).toBe(false);

    // Adding route_b satisfies the inner any_of — outer all_of now also true → transition fires.
    const result = await svc.setDeliverable(sessionId, 'route_b', 'chosen', 'Route B selected');
    expect(result.transitioned).toBe(true);
    expect(result.newStateId).toBe('state-b');
  });

  it('does NOT transition when the outer AND fails despite the inner OR passing', async () => {
    // Same plan but 'base_requirement' is missing — outer AND must fail even though
    // the inner any_of would pass on its own.
    const sessionId = 'session-nested-outer-fail';
    const plan = buildTwoStatePlan({
      target_state_id: 'state-b',
      condition_type: 'all_of',
      condition_config: {
        conditions: [
          {
            condition_type: 'deliverable_exists',
            condition_config: { key: 'base_requirement' }, // NOT set
          },
          {
            condition_type: 'any_of',
            condition_config: {
              conditions: [
                { condition_type: 'deliverable_exists', condition_config: { key: 'route_a' } },
                { condition_type: 'deliverable_exists', condition_config: { key: 'route_b' } },
              ],
            },
          },
        ],
      },
      priority: 1,
    });

    const svc = await setupSession(sessionId, plan, {
      // base_requirement intentionally absent
      route_a: { value: 'chosen', reasoning: 'Route A selected' },
    });

    const result = await (svc as any).evaluateAndTransition(sessionId);
    expect(result.transitioned).toBe(false);
  });
});
