import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionState, Prisma } from '@prisma/client';

/**
 * Plan data structure (matches SDK Plan type)
 */
export interface PlanData {
  id: string;
  title?: string;
  initial_state_id?: string;
  states: PlanState[];
  system_prompt?: string;
}

/**
 * Goal-mode context for natural, goal-oriented conversation states.
 * Only used when state type is 'goal'.
 */
export interface StateGoal {
  objective: string;
  context?: string;
  depth_guidance?: string;
  boundaries?: string;
  success_description?: string;
  deliverables?: PlanDeliverable[];
}

export interface PlanState {
  id: string;
  title?: string;
  description?: string;
  type?: 'strict' | 'loose' | 'goal';
  tasks: PlanTask[];
  transitions?: StateTransition[];
  goal?: StateGoal;
}

export interface PlanTask {
  id: string;
  description: string;
  instruction?: string;
  required?: boolean;
  deliverables?: PlanDeliverable[];
}

export interface PlanDeliverable {
  key: string;
  description: string;
  type?: string;
  required?: boolean;
  acceptance_criteria?: string;
  enum_values?: string[];
}

export interface StateTransition {
  target_state_id: string;
  condition_type:
    | 'all_tasks_complete'
    | 'deliverable_value'
    | 'deliverable_value_in'
    | 'deliverable_value_numeric'
    | 'compound'
    | 'all_of'
    | 'any_of'
    | 'deliverable_exists';
  condition_config?: Record<string, unknown>;
  priority?: number;
}

/**
 * Deliverable value stored in state
 */
export interface DeliverableValue {
  value: unknown;
  reasoning: string;
  collectedAt: string;
  discovered?: boolean;
}

/**
 * Result of state machine operations
 */
export interface StateMachineResult {
  success: boolean;
  error?: string;
  transitioned?: boolean;
  newStateId?: string;
  newStateTitle?: string;
  taskCompleted?: string;
  progress?: number;
}

/**
 * Current state info
 */
export interface CurrentStateInfo {
  stateId: string;
  stateTitle: string;
  stateType: 'strict' | 'loose' | 'goal';
  progress: number;
  turnsWithoutProgress: number;
  totalTurns: number;
  goal?: StateGoal;
}

/**
 * Pending task info
 */
export interface PendingTaskInfo {
  id: string;
  description: string;
  instruction?: string;
  required: boolean;
  hasDeliverables: boolean;
  deliverableKeys: string[];
  isPreview?: boolean;  // True for "next task" preview in strict mode
  isGoal?: boolean;     // True when state type is "goal"
}

/**
 * Pending deliverable info
 */
export interface PendingDeliverableInfo {
  key: string;
  description: string;
  type: string;
  required: boolean;
  acceptanceCriteria?: string;
  taskId: string;
}

/**
 * Full state deliverable info (for frontend updates)
 */
export interface FullStateDeliverableInfo {
  key: string;
  description: string;
  type: string;
  required: boolean;
  status: 'pending' | 'completed' | 'partial' | 'skipped';
  value?: unknown;
  collectedAt?: string;
  acceptanceCriteria?: string;
  reasoning?: string;
  discovered?: boolean;
}

/**
 * Full state task info (for frontend updates)
 */
export interface FullStateTaskInfo {
  id: string;
  description: string;
  instruction?: string;
  required: boolean;
  status: 'pending' | 'in_progress' | 'completed';
  deliverables: FullStateDeliverableInfo[];
}

/**
 * Full state state info (for frontend updates)
 */
export interface FullStateStateInfo {
  id: string;
  title: string;
  type: 'strict' | 'loose' | 'goal';
  status: 'pending' | 'active' | 'completed';
  tasks: FullStateTaskInfo[];
  goal?: StateGoal;
}

/**
 * Full state info (for frontend updates)
 */
export interface FullStateInfo {
  planId: string;
  planTitle: string;
  currentStateId: string;
  progress: number;
  totalTurns: number;
  turnsWithoutProgress: number;
  states: FullStateStateInfo[];
  collectedDeliverables: Record<string, unknown>;
}

@Injectable()
export class StateMachineService {
  private readonly logger = new Logger(StateMachineService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Ensure all states have transitions defined.
   * If a state doesn't have transitions, auto-generate a transition to the next state.
   */
  private ensureTransitions(plan: PlanData): PlanData {
    const statesWithTransitions = plan.states.map((state, index) => {
      // If state already has transitions, keep them
      if (state.transitions && state.transitions.length > 0) {
        return state;
      }

      // If this is the last state, no transition needed
      if (index === plan.states.length - 1) {
        return { ...state, transitions: [] };
      }

      // Generate default transition to next state
      const nextStateId = plan.states[index + 1].id;
      this.logger.log(
        `Auto-generating transition for state '${state.id}' -> '${nextStateId}'`,
      );

      return {
        ...state,
        transitions: [
          {
            target_state_id: nextStateId,
            condition_type: 'all_tasks_complete' as const,
            priority: 1,
          },
        ],
      };
    });

    return { ...plan, states: statesWithTransitions };
  }

  /**
   * Initialize state machine for a session with a plan
   */
  async initializeForSession(
    sessionId: string,
    plan: PlanData,
  ): Promise<SessionState> {
    // Ensure all states have transitions
    const normalizedPlan = this.ensureTransitions(plan);

    const initialStateId = normalizedPlan.initial_state_id || normalizedPlan.states[0]?.id;

    if (!initialStateId) {
      throw new BadRequestException('Plan must have at least one state');
    }

    // If state already exists for this session, resume from it instead of resetting.
    // This preserves progress (completedTasks, deliverables, currentStateId) when an
    // agent is restarted after being paused for inactivity.
    const existingState = await this.prisma.sessionState.findUnique({
      where: { sessionId },
    });

    if (existingState) {
      this.logger.log(`Resuming existing state machine for session ${sessionId} (state: ${existingState.currentStateId}, tasks: ${existingState.completedTasks.length} completed)`);
      return existingState;
    }

    this.logger.log(`Initializing state machine for session ${sessionId} with plan ${normalizedPlan.id}`);

    return this.prisma.sessionState.create({
      data: {
        sessionId,
        planId: normalizedPlan.id,
        planData: normalizedPlan as unknown as Prisma.InputJsonValue,
        currentStateId: initialStateId,
        completedTasks: [],
        skippedTasks: [],
        deliverables: {},
        turnsWithoutProgress: 0,
        totalTurns: 0,
      },
    });
  }

  /**
   * Get state machine state for a session
   */
  async getState(sessionId: string): Promise<SessionState | null> {
    return this.prisma.sessionState.findUnique({
      where: { sessionId },
    });
  }

  /**
   * Complete a task by ID
   */
  async completeTask(
    sessionId: string,
    taskId: string,
    reasoning: string,
  ): Promise<StateMachineResult> {
    const state = await this.getState(sessionId);
    if (!state) {
      return { success: false, error: 'State machine not initialized for this session' };
    }

    const plan = state.planData as unknown as PlanData;
    const currentState = this.getCurrentPlanState(plan, state.currentStateId);

    if (!currentState) {
      return { success: false, error: `Current state ${state.currentStateId} not found in plan` };
    }

    // Find the task
    const task = currentState.tasks.find(t => t.id === taskId);
    if (!task) {
      const availableTaskIds = currentState.tasks.map(t => t.id);
      return {
        success: false,
        error: `Task '${taskId}' not found in current state. Available: ${availableTaskIds.join(', ')}`,
      };
    }

    // Check if task is already completed
    if (state.completedTasks.includes(taskId)) {
      return { success: true, taskCompleted: taskId }; // Already done
    }

    // Check if task has deliverables (shouldn't use complete_task for these)
    if (task.deliverables && task.deliverables.length > 0) {
      return {
        success: false,
        error: `Task '${taskId}' has deliverables. Use set_deliverable instead.`,
      };
    }

    // Mark task as completed
    const updatedCompletedTasks = [...state.completedTasks, taskId];

    await this.prisma.sessionState.update({
      where: { sessionId },
      data: {
        completedTasks: updatedCompletedTasks,
        turnsWithoutProgress: 0, // Reset counter on progress
      },
    });

    this.logger.log(`Task ${taskId} completed for session ${sessionId}`);

    // Check for state transitions
    const transitionResult = await this.evaluateAndTransition(sessionId);

    return {
      success: true,
      taskCompleted: taskId,
      transitioned: transitionResult.transitioned,
      newStateId: transitionResult.newStateId,
      newStateTitle: transitionResult.newStateTitle,
      progress: await this.calculateProgress(sessionId, {
        ...state,
        completedTasks: updatedCompletedTasks,
        turnsWithoutProgress: 0,
      } as SessionState),
    };
  }

  /**
   * Set a deliverable value
   */
  async setDeliverable(
    sessionId: string,
    key: string,
    value: unknown,
    reasoning: string,
  ): Promise<StateMachineResult> {
    const state = await this.getState(sessionId);
    if (!state) {
      return { success: false, error: 'State machine not initialized for this session' };
    }

    const plan = state.planData as unknown as PlanData;
    const currentState = this.getCurrentPlanState(plan, state.currentStateId);

    if (!currentState) {
      return { success: false, error: `Current state ${state.currentStateId} not found in plan` };
    }

    // Find the deliverable — search tasks first, then goal.deliverables
    let foundTask: PlanTask | null = null;
    let foundDeliverable: PlanDeliverable | null = null;
    let isGoalDeliverable = false;

    // 1. Search task-level deliverables (works for all state types)
    for (const task of currentState.tasks) {
      for (const deliverable of task.deliverables || []) {
        if (deliverable.key === key) {
          foundTask = task;
          foundDeliverable = deliverable;
          break;
        }
      }
      if (foundDeliverable) break;
    }

    // 2. For goal states, also search goal-level deliverables
    if (!foundDeliverable && currentState.type === 'goal' && currentState.goal?.deliverables) {
      for (const deliverable of currentState.goal.deliverables) {
        if (deliverable.key === key) {
          foundDeliverable = deliverable;
          isGoalDeliverable = true;
          break;
        }
      }
    }

    // 3. Handle not-found cases
    const deliverables = state.deliverables as unknown as Record<string, DeliverableValue>;

    if (!foundDeliverable && currentState.type === 'goal') {
      // Goal mode: accept as discovered insight
      this.logger.log(`[setDeliverable] Discovered insight '${key}' in goal state for session ${sessionId}`);
      deliverables[key] = {
        value,
        reasoning,
        collectedAt: new Date().toISOString(),
        discovered: true,
      };

      await this.prisma.sessionState.update({
        where: { sessionId },
        data: {
          deliverables: deliverables as unknown as Prisma.InputJsonValue,
          turnsWithoutProgress: 0,
        },
      });

      return {
        success: true,
        progress: await this.calculateProgress(sessionId, {
          ...state,
          deliverables: deliverables as unknown as Prisma.JsonValue,
          turnsWithoutProgress: 0,
        } as SessionState),
      };
    }

    if (!foundDeliverable) {
      // Strict/loose mode: reject unknown keys
      const availableKeys = currentState.tasks
        .flatMap(t => t.deliverables || [])
        .map(d => d.key);
      return {
        success: false,
        error: `Deliverable '${key}' not found in current state. Available: ${availableKeys.join(', ')}`,
      };
    }

    // Update deliverables
    deliverables[key] = {
      value,
      reasoning,
      collectedAt: new Date().toISOString(),
    };

    // Check if this completes the task (or goal deliverables)
    let updatedCompletedTasks = state.completedTasks;

    if (isGoalDeliverable) {
      // For goal-level deliverables, check if all required goal deliverables are collected
      const goalDelKeys = (currentState.goal?.deliverables || [])
        .filter(d => d.required !== false)
        .map(d => d.key);
      const goalComplete = goalDelKeys.every(k => k in deliverables);

      if (goalComplete && !state.completedTasks.includes('__goal__')) {
        updatedCompletedTasks = [...state.completedTasks, '__goal__'];
        this.logger.log(`[setDeliverable] All goal deliverables collected for session ${sessionId}`);
      }
    } else if (foundTask) {
      // For task-level deliverables, check task completion
      const taskDeliverableKeys = (foundTask.deliverables || [])
        .filter(d => d.required !== false)
        .map(d => d.key);
      const taskComplete = taskDeliverableKeys.every(k => k in deliverables);

      if (taskComplete && !state.completedTasks.includes(foundTask.id)) {
        updatedCompletedTasks = [...state.completedTasks, foundTask.id];
      }
    }

    await this.prisma.sessionState.update({
      where: { sessionId },
      data: {
        deliverables: deliverables as unknown as Prisma.InputJsonValue,
        completedTasks: updatedCompletedTasks,
        turnsWithoutProgress: 0,
      },
    });

    const taskId = isGoalDeliverable ? '__goal__' : foundTask?.id;
    const taskComplete = isGoalDeliverable
      ? updatedCompletedTasks.includes('__goal__')
      : foundTask ? updatedCompletedTasks.includes(foundTask.id) : false;

    this.logger.log(`[setDeliverable] Deliverable '${key}' set for session ${sessionId}, value: ${JSON.stringify(value)}`);
    this.logger.log(`[setDeliverable] Task '${taskId}' complete: ${taskComplete}, completedTasks: ${JSON.stringify(updatedCompletedTasks)}`);

    // Check for state transitions
    this.logger.log(`[setDeliverable] Calling evaluateAndTransition...`);
    const transitionResult = await this.evaluateAndTransition(sessionId);
    this.logger.log(`[setDeliverable] Transition result: ${JSON.stringify(transitionResult)}`);

    return {
      success: true,
      taskCompleted: taskComplete ? taskId : undefined,
      transitioned: transitionResult.transitioned,
      newStateId: transitionResult.newStateId,
      newStateTitle: transitionResult.newStateTitle,
      progress: await this.calculateProgress(sessionId, {
        ...state,
        deliverables: deliverables as unknown as Prisma.JsonValue,
        completedTasks: updatedCompletedTasks,
        turnsWithoutProgress: 0,
      } as SessionState),
    };
  }

  /**
   * Get current state info
   */
  async getCurrentState(sessionId: string): Promise<CurrentStateInfo | null> {
    const state = await this.getState(sessionId);
    if (!state) return null;

    const plan = state.planData as unknown as PlanData;
    const currentState = this.getCurrentPlanState(plan, state.currentStateId);

    if (!currentState) return null;

    return {
      stateId: currentState.id,
      stateTitle: currentState.title || currentState.id,
      stateType: currentState.type || 'loose',
      progress: await this.calculateProgress(sessionId, state),
      turnsWithoutProgress: state.turnsWithoutProgress,
      totalTurns: state.totalTurns,
      goal: currentState.goal,
    };
  }

  /**
   * Get pending tasks in current state
   *
   * Behavior depends on state type:
   * - LOOSE (flexible): Returns ALL pending tasks - LLM chooses order
   * - STRICT (sequential): Returns current task + next task as preview
   */
  async getPendingTasks(sessionId: string): Promise<PendingTaskInfo[]> {
    const state = await this.getState(sessionId);
    if (!state) return [];

    const plan = state.planData as unknown as PlanData;
    const currentState = this.getCurrentPlanState(plan, state.currentStateId);

    if (!currentState) return [];

    const pendingTasks: PendingTaskInfo[] = [];
    const deliverables = state.deliverables as unknown as Record<string, DeliverableValue>;

    for (const task of currentState.tasks) {
      // Skip completed tasks
      if (state.completedTasks.includes(task.id)) continue;

      // For tasks with deliverables, check if all required deliverables are collected
      const taskDeliverables = task.deliverables || [];
      const hasDeliverables = taskDeliverables.length > 0;

      if (hasDeliverables) {
        const requiredKeys = taskDeliverables
          .filter(d => d.required !== false)
          .map(d => d.key);
        const allCollected = requiredKeys.every(k => k in deliverables);
        if (allCollected) continue; // Task is effectively complete
      }

      pendingTasks.push({
        id: task.id,
        description: task.description,
        instruction: task.instruction,
        required: task.required !== false,
        hasDeliverables,
        deliverableKeys: taskDeliverables.map(d => d.key),
      });
    }

    // Filter based on state type (strict vs loose vs goal)
    const stateType = currentState.type || 'loose';

    if (stateType === 'goal') {
      // GOAL mode: Return a single synthetic task representing the goal.
      // The agent sees information gaps (deliverables), not individual tasks.
      // Tasks auto-complete when their deliverables are set.
      const taskDeliverableKeys = pendingTasks.flatMap(t => t.deliverableKeys);

      // Also include goal-level deliverables
      const goalDeliverableKeys = (currentState.goal?.deliverables || [])
        .filter(d => !(d.key in deliverables))
        .map(d => d.key);

      const allDeliverableKeys = [...new Set([...taskDeliverableKeys, ...goalDeliverableKeys])];

      if (allDeliverableKeys.length === 0 && pendingTasks.length === 0) return [];

      return [{
        id: '__goal__',
        description: currentState.goal?.objective || currentState.description || currentState.title || 'Complete this phase',
        instruction: currentState.goal?.depth_guidance,
        required: true,
        hasDeliverables: true,
        deliverableKeys: allDeliverableKeys,
        isGoal: true,
      }];
    }

    if (stateType === 'strict') {
      // STRICT mode: Return only current task + next task as preview
      // This enables sequential progression with smooth transitions
      const result: PendingTaskInfo[] = [];

      if (pendingTasks.length > 0) {
        result.push(pendingTasks[0]); // Current task
      }
      if (pendingTasks.length > 1) {
        result.push({ ...pendingTasks[1], isPreview: true }); // Next task preview
      }

      return result;
    }

    // LOOSE mode: Return all pending tasks - LLM chooses order based on conversation
    return pendingTasks;
  }

  /**
   * Get pending deliverables in current state
   */
  async getPendingDeliverables(sessionId: string): Promise<PendingDeliverableInfo[]> {
    const state = await this.getState(sessionId);
    if (!state) return [];

    const plan = state.planData as unknown as PlanData;
    const currentState = this.getCurrentPlanState(plan, state.currentStateId);

    if (!currentState) return [];

    const pendingDeliverables: PendingDeliverableInfo[] = [];
    const deliverables = state.deliverables as unknown as Record<string, DeliverableValue>;

    for (const task of currentState.tasks) {
      // Skip completed tasks
      if (state.completedTasks.includes(task.id)) continue;

      for (const deliverable of task.deliverables || []) {
        // Skip already collected deliverables
        if (deliverable.key in deliverables) continue;

        pendingDeliverables.push({
          key: deliverable.key,
          description: deliverable.description,
          type: deliverable.type || 'string',
          required: deliverable.required !== false,
          acceptanceCriteria: deliverable.acceptance_criteria,
          taskId: task.id,
        });
      }
    }

    // For goal states, also include goal-level deliverables
    if (currentState.type === 'goal' && currentState.goal?.deliverables) {
      const seenKeys = new Set(pendingDeliverables.map(p => p.key));
      for (const deliverable of currentState.goal.deliverables) {
        if (deliverable.key in deliverables) continue; // Already collected
        if (seenKeys.has(deliverable.key)) continue; // Already added from tasks
        pendingDeliverables.push({
          key: deliverable.key,
          description: deliverable.description,
          type: deliverable.type || 'string',
          required: deliverable.required !== false,
          acceptanceCriteria: deliverable.acceptance_criteria,
          taskId: '__goal__',
        });
      }
    }

    return pendingDeliverables;
  }

  /**
   * Increment turn counter (when no progress is made)
   */
  async incrementTurn(sessionId: string): Promise<number> {
    const result = await this.prisma.sessionState.update({
      where: { sessionId },
      data: {
        turnsWithoutProgress: { increment: 1 },
        totalTurns: { increment: 1 },
      },
    });

    return result.turnsWithoutProgress;
  }

  /**
   * Record a turn with progress (resets turns without progress)
   */
  async recordProgressTurn(sessionId: string): Promise<void> {
    await this.prisma.sessionState.update({
      where: { sessionId },
      data: {
        turnsWithoutProgress: 0,
        totalTurns: { increment: 1 },
      },
    });
  }

  /**
   * Get all collected deliverables
   */
  async getCollectedDeliverables(
    sessionId: string,
  ): Promise<Record<string, unknown>> {
    const state = await this.getState(sessionId);
    if (!state) return {};

    const deliverables = state.deliverables as unknown as Record<string, DeliverableValue>;
    const result: Record<string, unknown> = {};

    for (const [key, data] of Object.entries(deliverables)) {
      result[key] = data.value;
    }

    return result;
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private getCurrentPlanState(plan: PlanData, stateId: string): PlanState | null {
    return plan.states.find(s => s.id === stateId) || null;
  }

  private async calculateProgress(
    sessionId: string,
    preloadedState?: SessionState,
  ): Promise<number> {
    const state = preloadedState ?? await this.getState(sessionId);
    if (!state) return 0;

    const plan = state.planData as unknown as PlanData;
    let totalRequired = 0;
    let completedRequired = 0;

    const deliverables = state.deliverables as unknown as Record<string, DeliverableValue>;

    for (const planState of plan.states) {
      const countedKeys = new Set<string>();

      // Count goal-level deliverables first (for goal states)
      if (planState.type === 'goal' && planState.goal?.deliverables) {
        for (const d of planState.goal.deliverables) {
          if (d.required === false) continue;
          countedKeys.add(d.key);
          totalRequired++;
          if (d.key in deliverables && !deliverables[d.key]?.discovered) {
            completedRequired++;
          }
        }
      }

      for (const task of planState.tasks) {
        if (task.required === false) continue;

        const taskDeliverables = task.deliverables || [];
        if (taskDeliverables.length === 0) {
          // Task without deliverables
          totalRequired++;
          if (state.completedTasks.includes(task.id)) {
            completedRequired++;
          }
        } else {
          // Count required deliverables (skip if already counted from goal.deliverables)
          for (const d of taskDeliverables) {
            if (d.required === false) continue;
            if (countedKeys.has(d.key)) continue; // Deduplicate
            countedKeys.add(d.key);
            totalRequired++;
            if (d.key in deliverables && !deliverables[d.key]?.discovered) {
              completedRequired++;
            }
          }
        }
      }
    }

    if (totalRequired === 0) return 100;
    return Math.round((completedRequired / totalRequired) * 100);
  }

  private isCurrentStateComplete(
    state: SessionState,
    currentState: PlanState,
  ): boolean {
    const deliverables = state.deliverables as unknown as Record<string, DeliverableValue>;

    const stateType = currentState.type || 'loose';

    this.logger.log(
      `[isCurrentStateComplete] Checking state '${currentState.id}' (type: ${stateType}) with ${currentState.tasks.length} tasks`,
    );
    this.logger.log(
      `[isCurrentStateComplete] Collected deliverables: ${JSON.stringify(Object.keys(deliverables))}`,
    );
    this.logger.log(
      `[isCurrentStateComplete] Completed tasks: ${JSON.stringify(state.completedTasks)}`,
    );

    for (const task of currentState.tasks) {
      if (task.required === false) {
        this.logger.log(`[isCurrentStateComplete] Task '${task.id}' is optional, skipping`);
        continue;
      }

      const taskDeliverables = task.deliverables || [];
      if (taskDeliverables.length === 0) {
        if (stateType === 'goal') {
          // In goal mode, deliverable-less tasks are auto-considered complete.
          // Goal mode focuses on information gathering (deliverables), not actions.
          this.logger.log(
            `[isCurrentStateComplete] Task '${task.id}' has no deliverables — auto-complete in goal mode`,
          );
          continue;
        }
        // Task without deliverables - check if completed
        if (!state.completedTasks.includes(task.id)) {
          this.logger.log(
            `[isCurrentStateComplete] Task '${task.id}' has no deliverables and is NOT in completedTasks - state NOT complete`,
          );
          return false;
        }
        this.logger.log(
          `[isCurrentStateComplete] Task '${task.id}' has no deliverables but IS in completedTasks`,
        );
      } else {
        // Task with deliverables - check if all required are collected
        for (const d of taskDeliverables) {
          if (d.required === false) {
            this.logger.log(
              `[isCurrentStateComplete] Deliverable '${d.key}' is optional, skipping`,
            );
            continue;
          }
          if (!(d.key in deliverables)) {
            this.logger.log(
              `[isCurrentStateComplete] Required deliverable '${d.key}' NOT found - state NOT complete`,
            );
            return false;
          }
          this.logger.log(
            `[isCurrentStateComplete] Required deliverable '${d.key}' found with value: ${JSON.stringify(deliverables[d.key]?.value)}`,
          );
        }
      }
    }

    // For goal states, also check goal-level deliverables
    if (currentState.type === 'goal' && currentState.goal?.deliverables) {
      for (const d of currentState.goal.deliverables) {
        if (d.required === false) continue;
        if (!(d.key in deliverables)) {
          this.logger.log(
            `[isCurrentStateComplete] Required goal deliverable '${d.key}' NOT found - state NOT complete`,
          );
          return false;
        }
      }
    }

    this.logger.log(`[isCurrentStateComplete] All required tasks/deliverables complete - state IS complete`);
    return true;
  }

  /**
   * Convert unknown values to a finite number for numeric transition checks.
   * Returns null for null/undefined/empty/non-numeric/NaN/Infinity values.
   */
  private toFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;

    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * Evaluate one condition node.
   * Supports simple condition types and nested composite conditions.
   */
  private evaluateTransitionCondition(
    conditionType: string,
    conditionConfig: Record<string, unknown> | undefined,
    state: SessionState,
    currentState: PlanState,
    deliverables: Record<string, DeliverableValue>,
    depth = 0,
  ): boolean {
    // Guard against malformed recursive configs and accidental deep nesting.
    if (depth > 5) {
      this.logger.warn(
        `[evaluateAndTransition] Condition nesting too deep (depth=${depth}) for type='${conditionType}'`,
      );
      return false;
    }

    switch (conditionType) {
      case 'all_tasks_complete':
        return this.isCurrentStateComplete(state, currentState);

      case 'deliverable_value': {
        const key = conditionConfig?.key as string;
        const expected = conditionConfig?.value;
        const actual = deliverables[key]?.value;
        if (typeof actual === 'string' && typeof expected === 'string') {
          return actual.trim().toLowerCase() === expected.trim().toLowerCase();
        }
        return actual === expected;
      }

      case 'deliverable_value_in': {
        // Expects condition_config: { key: string, values: unknown[] }.
        const key = conditionConfig?.key as string;
        const expectedValues = conditionConfig?.values;
        const actual = deliverables[key]?.value;

        if (!Array.isArray(expectedValues)) {
          this.logger.warn(
            `[evaluateAndTransition] 'deliverable_value_in' misconfigured for key='${key}': 'values' must be an array`,
          );
          return false;
        }

        return expectedValues.some((expectedValue) => {
          if (typeof actual === 'string' && typeof expectedValue === 'string') {
            return actual.trim().toLowerCase() === expectedValue.trim().toLowerCase();
          }
          return actual === expectedValue;
        });
      }

      case 'deliverable_value_numeric': {
        // Expects condition_config:
        // - { key, operator: 'gt'|'gte'|'lt'|'lte'|'eq'|'neq', value }
        // - { key, operator: 'between', min, max, inclusive? } (inclusive defaults to true)
        const numericKey = conditionConfig?.key as string | undefined;
        const rawOperator = conditionConfig?.operator as string | undefined;
        const numericActualRaw = numericKey ? deliverables[numericKey]?.value : undefined;
        const numericActual = this.toFiniteNumber(numericActualRaw);

        if (!numericKey) {
          this.logger.warn(
            `[evaluateAndTransition] 'deliverable_value_numeric' misconfigured: missing 'key'`,
          );
          return false;
        }

        if (!rawOperator) {
          this.logger.warn(
            `[evaluateAndTransition] 'deliverable_value_numeric' misconfigured for key='${numericKey}': missing 'operator'`,
          );
          return false;
        }

        if (numericActual === null) {
          this.logger.warn(
            `[evaluateAndTransition] 'deliverable_value_numeric' key='${numericKey}' has non-numeric actual value: ${JSON.stringify(numericActualRaw)}`,
          );
          return false;
        }

        const operator = rawOperator.toLowerCase();

        // Support both semantic and symbolic operators to simplify authoring.
        if (operator === 'gt' || operator === '>') {
          const expectedValue = this.toFiniteNumber(conditionConfig?.value);
          return expectedValue !== null && numericActual > expectedValue;
        }
        if (operator === 'gte' || operator === '>=') {
          const expectedValue = this.toFiniteNumber(conditionConfig?.value);
          return expectedValue !== null && numericActual >= expectedValue;
        }
        if (operator === 'lt' || operator === '<') {
          const expectedValue = this.toFiniteNumber(conditionConfig?.value);
          return expectedValue !== null && numericActual < expectedValue;
        }
        if (operator === 'lte' || operator === '<=') {
          const expectedValue = this.toFiniteNumber(conditionConfig?.value);
          return expectedValue !== null && numericActual <= expectedValue;
        }
        if (operator === 'eq' || operator === '==') {
          const expectedValue = this.toFiniteNumber(conditionConfig?.value);
          return expectedValue !== null && numericActual === expectedValue;
        }
        if (operator === 'neq' || operator === '!=') {
          const expectedValue = this.toFiniteNumber(conditionConfig?.value);
          return expectedValue !== null && numericActual !== expectedValue;
        }
        if (operator === 'between' || operator === 'range') {
          const minValue = this.toFiniteNumber(conditionConfig?.min);
          const maxValue = this.toFiniteNumber(conditionConfig?.max);
          const inclusive = conditionConfig?.inclusive !== false;

          if (minValue === null || maxValue === null || minValue > maxValue) {
            this.logger.warn(
              `[evaluateAndTransition] 'deliverable_value_numeric' misconfigured for key='${numericKey}': invalid range min='${conditionConfig?.min}' max='${conditionConfig?.max}'`,
            );
            return false;
          }

          return inclusive
            ? numericActual >= minValue && numericActual <= maxValue
            : numericActual > minValue && numericActual < maxValue;
        }

        this.logger.warn(
          `[evaluateAndTransition] 'deliverable_value_numeric' misconfigured for key='${numericKey}': unsupported operator '${rawOperator}'`,
        );
        return false;
      }

      case 'deliverable_exists': {
        const existsKey = conditionConfig?.key as string;
        return existsKey in deliverables;
      }

      case 'all_of':
        return this.evaluateCompositeCondition(
          'and',
          conditionConfig,
          state,
          currentState,
          deliverables,
          depth + 1,
        );

      case 'any_of':
        return this.evaluateCompositeCondition(
          'or',
          conditionConfig,
          state,
          currentState,
          deliverables,
          depth + 1,
        );

      case 'compound': {
        const operator = String(conditionConfig?.operator || '').toLowerCase();
        if (operator !== 'and' && operator !== 'or') {
          this.logger.warn(
            `[evaluateAndTransition] 'compound' misconfigured: operator must be 'and' or 'or'`,
          );
          return false;
        }

        return this.evaluateCompositeCondition(
          operator,
          conditionConfig,
          state,
          currentState,
          deliverables,
          depth + 1,
        );
      }

      default:
        this.logger.warn(
          `[evaluateAndTransition] Unknown condition type: '${conditionType}'`,
        );
        return false;
    }
  }

  /**
   * Evaluate a list of child conditions with AND/OR semantics.
   */
  private evaluateCompositeCondition(
    operator: 'and' | 'or',
    conditionConfig: Record<string, unknown> | undefined,
    state: SessionState,
    currentState: PlanState,
    deliverables: Record<string, DeliverableValue>,
    depth: number,
  ): boolean {
    const rawConditions = conditionConfig?.conditions;
    if (!Array.isArray(rawConditions) || rawConditions.length === 0) {
      this.logger.warn(
        `[evaluateAndTransition] Composite condition misconfigured: 'conditions' must be a non-empty array`,
      );
      return false;
    }

    const evaluateChild = (child: unknown): boolean => {
      if (!child || typeof child !== 'object') {
        this.logger.warn(
          `[evaluateAndTransition] Composite condition has invalid child: ${JSON.stringify(child)}`,
        );
        return false;
      }

      const childRecord = child as Record<string, unknown>;
      // Support both canonical keys and tolerant aliases for easier authoring/imports.
      const childType = (childRecord.condition_type ?? childRecord.type) as string | undefined;
      const childConfig = (childRecord.condition_config ??
        childRecord.config) as Record<string, unknown> | undefined;

      if (!childType || typeof childType !== 'string') {
        this.logger.warn(
          `[evaluateAndTransition] Composite child missing valid 'condition_type'`,
        );
        return false;
      }

      return this.evaluateTransitionCondition(
        childType,
        childConfig,
        state,
        currentState,
        deliverables,
        depth,
      );
    };

    return operator === 'and'
      ? rawConditions.every((child) => evaluateChild(child))
      : rawConditions.some((child) => evaluateChild(child));
  }

  private async evaluateAndTransition(
    sessionId: string,
  ): Promise<{ transitioned: boolean; newStateId?: string; newStateTitle?: string }> {
    const state = await this.getState(sessionId);
    if (!state) {
      this.logger.log(`[evaluateAndTransition] No state found for session ${sessionId}`);
      return { transitioned: false };
    }

    // Normalize the plan to ensure transitions exist (fixes plans created without transitions)
    const rawPlan = state.planData as unknown as PlanData;
    const plan = this.ensureTransitions(rawPlan);
    const currentState = this.getCurrentPlanState(plan, state.currentStateId);

    this.logger.log(
      `[evaluateAndTransition] Session ${sessionId}, current state: '${state.currentStateId}'`,
    );

    if (!currentState) {
      this.logger.log(`[evaluateAndTransition] Current state not found in plan`);
      return { transitioned: false };
    }

    if (!currentState.transitions || currentState.transitions.length === 0) {
      this.logger.log(
        `[evaluateAndTransition] State '${currentState.id}' has no transitions defined`,
      );
      return { transitioned: false };
    }

    this.logger.log(
      `[evaluateAndTransition] State '${currentState.id}' has ${currentState.transitions.length} transition(s)`,
    );

    const deliverables = state.deliverables as unknown as Record<string, DeliverableValue>;

    // Sort transitions by priority
    const sortedTransitions = [...currentState.transitions].sort(
      (a, b) => (a.priority || 100) - (b.priority || 100),
    );

    for (const transition of sortedTransitions) {
      let conditionMet = false;

      this.logger.log(
        `[evaluateAndTransition] Checking transition to '${transition.target_state_id}' with condition '${transition.condition_type}'`,
      );

      conditionMet = this.evaluateTransitionCondition(
        transition.condition_type,
        transition.condition_config,
        state,
        currentState,
        deliverables,
      );
      this.logger.log(
        `[evaluateAndTransition] Condition '${transition.condition_type}' result: ${conditionMet}`,
      );

      if (conditionMet) {
        const targetState = plan.states.find(s => s.id === transition.target_state_id);
        if (targetState) {
          this.logger.log(
            `[evaluateAndTransition] Condition met! Transitioning from '${state.currentStateId}' to '${transition.target_state_id}'`,
          );

          await this.prisma.sessionState.update({
            where: { sessionId },
            data: {
              currentStateId: transition.target_state_id,
              turnsWithoutProgress: 0,
              lastTransitionAt: new Date(),
            },
          });

          this.logger.log(
            `Session ${sessionId} transitioned from ${state.currentStateId} to ${transition.target_state_id}`,
          );

          return {
            transitioned: true,
            newStateId: transition.target_state_id,
            newStateTitle: targetState.title || targetState.id,
          };
        } else {
          this.logger.warn(
            `[evaluateAndTransition] Target state '${transition.target_state_id}' not found in plan`,
          );
        }
      }
    }

    this.logger.log(`[evaluateAndTransition] No transition conditions met`);
    return { transitioned: false };
  }

  /**
   * Get full state info for frontend updates
   * Returns all states with tasks, deliverables, and completion status
   */
  async getFullState(sessionId: string): Promise<FullStateInfo | null> {
    const state = await this.getState(sessionId);
    if (!state) return null;

    const plan = state.planData as unknown as PlanData;
    const deliverables = state.deliverables as unknown as Record<string, DeliverableValue>;
    const completedTasks = state.completedTasks || [];

    // Calculate which states are completed
    const completedStates = new Set<string>();
    for (let i = 0; i < plan.states.length; i++) {
      const planState = plan.states[i];
      if (planState.id === state.currentStateId) {
        // Mark all previous states as completed
        for (let j = 0; j < i; j++) {
          completedStates.add(plan.states[j].id);
        }
        break;
      }
    }

    // Build full state info
    const states: FullStateStateInfo[] = plan.states.map(planState => {
      let stateStatus: 'pending' | 'active' | 'completed' = 'pending';
      if (planState.id === state.currentStateId) {
        stateStatus = 'active';
      } else if (completedStates.has(planState.id)) {
        stateStatus = 'completed';
      }

      const tasks: FullStateTaskInfo[] = planState.tasks.map(task => {
        const taskDeliverables = task.deliverables || [];
        const hasDeliverables = taskDeliverables.length > 0;

        // Determine task status
        let taskStatus: 'pending' | 'in_progress' | 'completed' = 'pending';
        if (completedTasks.includes(task.id)) {
          taskStatus = 'completed';
        } else if (hasDeliverables) {
          // Check if all required deliverables are collected
          const requiredKeys = taskDeliverables
            .filter(d => d.required !== false)
            .map(d => d.key);
          const allCollected = requiredKeys.every(k => k in deliverables);
          if (allCollected) {
            taskStatus = 'completed';
          } else if (requiredKeys.some(k => k in deliverables)) {
            taskStatus = 'in_progress';
          }
        }

        // Build deliverable info
        const deliverableInfos: FullStateDeliverableInfo[] = taskDeliverables.map(d => {
          const collected = deliverables[d.key];
          return {
            key: d.key,
            description: d.description,
            type: d.type || 'string',
            required: d.required !== false,
            status: collected ? 'completed' : 'pending',
            value: collected?.value,
            collectedAt: collected?.collectedAt,
            acceptanceCriteria: d.acceptance_criteria,
            reasoning: collected?.reasoning,
          };
        });

        return {
          id: task.id,
          description: task.description,
          instruction: task.instruction,
          required: task.required !== false,
          status: taskStatus,
          deliverables: deliverableInfos,
        };
      });

      // For goal states, prepend a synthetic task for goal-level deliverables
      if (planState.type === 'goal' && planState.goal?.deliverables?.length) {
        const taskKeys = new Set(
          planState.tasks.flatMap(t => (t.deliverables || []).map(d => d.key)),
        );

        const goalDeliverableInfos: FullStateDeliverableInfo[] = planState.goal.deliverables
          .filter(d => !taskKeys.has(d.key)) // Deduplicate with task deliverables
          .map(d => {
            const collected = deliverables[d.key];
            return {
              key: d.key,
              description: d.description,
              type: d.type || 'string',
              required: d.required !== false,
              status: (collected ? 'completed' : 'pending') as 'pending' | 'completed',
              value: collected?.value,
              collectedAt: collected?.collectedAt,
              acceptanceCriteria: d.acceptance_criteria,
              reasoning: collected?.reasoning,
              discovered: false,
            };
          });

        // Add discovered insights (only for active state)
        if (planState.id === state.currentStateId) {
          const knownKeys = new Set([
            ...taskKeys,
            ...planState.goal.deliverables.map(d => d.key),
          ]);
          for (const [key, val] of Object.entries(deliverables)) {
            if (!knownKeys.has(key) && val.discovered) {
              goalDeliverableInfos.push({
                key,
                description: key.replace(/_/g, ' '),
                type: 'string',
                required: false,
                status: 'completed',
                value: val.value,
                collectedAt: val.collectedAt,
                reasoning: val.reasoning,
                discovered: true,
              });
            }
          }
        }

        if (goalDeliverableInfos.length > 0) {
          const allRequired = goalDeliverableInfos.filter(d => d.required && !d.discovered);
          const goalTaskStatus: 'pending' | 'in_progress' | 'completed' =
            allRequired.every(d => d.status === 'completed') ? 'completed' :
            allRequired.some(d => d.status === 'completed') ? 'in_progress' : 'pending';

          tasks.unshift({
            id: '__goal_deliverables__',
            description: planState.goal.objective || 'Goal Deliverables',
            required: true,
            status: goalTaskStatus,
            deliverables: goalDeliverableInfos,
          });
        }
      }

      return {
        id: planState.id,
        title: planState.title || planState.id,
        type: planState.type || 'loose',
        status: stateStatus,
        tasks,
        goal: planState.goal,
      };
    });

    // Build collected deliverables map
    const collectedDeliverablesMap: Record<string, unknown> = {};
    for (const [key, data] of Object.entries(deliverables)) {
      collectedDeliverablesMap[key] = data.value;
    }

    const progress = await this.calculateProgress(sessionId, state);

    return {
      planId: plan.id,
      planTitle: plan.title || plan.id,
      currentStateId: state.currentStateId,
      progress,
      totalTurns: state.totalTurns,
      turnsWithoutProgress: state.turnsWithoutProgress,
      states,
      collectedDeliverables: collectedDeliverablesMap,
    };
  }
}
