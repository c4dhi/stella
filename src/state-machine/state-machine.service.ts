import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionState, Prisma } from '@prisma/client';

/**
 * Plan data structure (matches SDK Plan type)
 */
interface PlanData {
  id: string;
  title?: string;
  initial_state_id?: string;
  states: PlanState[];
  system_prompt?: string;
}

interface PlanState {
  id: string;
  title?: string;
  description?: string;
  type?: 'strict' | 'loose';
  tasks: PlanTask[];
  transitions?: StateTransition[];
}

interface PlanTask {
  id: string;
  description: string;
  instruction?: string;
  required?: boolean;
  deliverables?: PlanDeliverable[];
}

interface PlanDeliverable {
  key: string;
  description: string;
  type?: string;
  required?: boolean;
  acceptance_criteria?: string;
  examples?: string[];
}

interface StateTransition {
  target_state_id: string;
  condition_type: 'all_tasks_complete' | 'deliverable_value' | 'deliverable_exists';
  condition_config?: Record<string, unknown>;
  priority?: number;
}

/**
 * Deliverable value stored in state
 */
interface DeliverableValue {
  value: unknown;
  reasoning: string;
  collectedAt: string;
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
  stateType: 'strict' | 'loose';
  progress: number;
  turnsWithoutProgress: number;
  totalTurns: number;
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
  examples: string[];
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
  type: 'strict' | 'loose';
  status: 'pending' | 'active' | 'completed';
  tasks: FullStateTaskInfo[];
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
   * Initialize state machine for a session with a plan
   */
  async initializeForSession(
    sessionId: string,
    plan: PlanData,
  ): Promise<SessionState> {
    const initialStateId = plan.initial_state_id || plan.states[0]?.id;

    if (!initialStateId) {
      throw new BadRequestException('Plan must have at least one state');
    }

    this.logger.log(`Initializing state machine for session ${sessionId} with plan ${plan.id}`);

    return this.prisma.sessionState.upsert({
      where: { sessionId },
      create: {
        sessionId,
        planId: plan.id,
        planData: plan as unknown as Prisma.InputJsonValue,
        currentStateId: initialStateId,
        completedTasks: [],
        skippedTasks: [],
        deliverables: {},
        turnsWithoutProgress: 0,
        totalTurns: 0,
      },
      update: {
        planId: plan.id,
        planData: plan as unknown as Prisma.InputJsonValue,
        currentStateId: initialStateId,
        completedTasks: [],
        skippedTasks: [],
        deliverables: {},
        turnsWithoutProgress: 0,
        totalTurns: 0,
        lastTransitionAt: null,
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
      progress: await this.calculateProgress(sessionId),
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

    // Find the deliverable
    let foundTask: PlanTask | null = null;
    let foundDeliverable: PlanDeliverable | null = null;

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

    if (!foundDeliverable || !foundTask) {
      const availableKeys = currentState.tasks
        .flatMap(t => t.deliverables || [])
        .map(d => d.key);
      return {
        success: false,
        error: `Deliverable '${key}' not found in current state. Available: ${availableKeys.join(', ')}`,
      };
    }

    // Update deliverables
    const deliverables = state.deliverables as unknown as Record<string, DeliverableValue>;
    deliverables[key] = {
      value,
      reasoning,
      collectedAt: new Date().toISOString(),
    };

    // Check if this completes the task
    const taskDeliverableKeys = (foundTask.deliverables || [])
      .filter(d => d.required !== false)
      .map(d => d.key);
    const taskComplete = taskDeliverableKeys.every(k => k in deliverables);

    let updatedCompletedTasks = state.completedTasks;
    if (taskComplete && !state.completedTasks.includes(foundTask.id)) {
      updatedCompletedTasks = [...state.completedTasks, foundTask.id];
    }

    await this.prisma.sessionState.update({
      where: { sessionId },
      data: {
        deliverables: deliverables as unknown as Prisma.InputJsonValue,
        completedTasks: updatedCompletedTasks,
        turnsWithoutProgress: 0,
      },
    });

    this.logger.log(`Deliverable ${key} set for session ${sessionId}`);

    // Check for state transitions
    const transitionResult = await this.evaluateAndTransition(sessionId);

    return {
      success: true,
      taskCompleted: taskComplete ? foundTask.id : undefined,
      transitioned: transitionResult.transitioned,
      newStateId: transitionResult.newStateId,
      newStateTitle: transitionResult.newStateTitle,
      progress: await this.calculateProgress(sessionId),
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
      progress: await this.calculateProgress(sessionId),
      turnsWithoutProgress: state.turnsWithoutProgress,
      totalTurns: state.totalTurns,
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

    // Filter based on state type (strict vs loose)
    const stateType = currentState.type || 'loose';

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
          examples: deliverable.examples || [],
          taskId: task.id,
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

  private async calculateProgress(sessionId: string): Promise<number> {
    const state = await this.getState(sessionId);
    if (!state) return 0;

    const plan = state.planData as unknown as PlanData;
    let totalRequired = 0;
    let completedRequired = 0;

    const deliverables = state.deliverables as unknown as Record<string, DeliverableValue>;

    for (const planState of plan.states) {
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
          // Count required deliverables
          for (const d of taskDeliverables) {
            if (d.required === false) continue;
            totalRequired++;
            if (d.key in deliverables) {
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

    for (const task of currentState.tasks) {
      if (task.required === false) continue;

      const taskDeliverables = task.deliverables || [];
      if (taskDeliverables.length === 0) {
        // Task without deliverables - check if completed
        if (!state.completedTasks.includes(task.id)) {
          return false;
        }
      } else {
        // Task with deliverables - check if all required are collected
        for (const d of taskDeliverables) {
          if (d.required === false) continue;
          if (!(d.key in deliverables)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  private async evaluateAndTransition(
    sessionId: string,
  ): Promise<{ transitioned: boolean; newStateId?: string; newStateTitle?: string }> {
    const state = await this.getState(sessionId);
    if (!state) return { transitioned: false };

    const plan = state.planData as unknown as PlanData;
    const currentState = this.getCurrentPlanState(plan, state.currentStateId);

    if (!currentState || !currentState.transitions) {
      return { transitioned: false };
    }

    const deliverables = state.deliverables as unknown as Record<string, DeliverableValue>;

    // Sort transitions by priority
    const sortedTransitions = [...currentState.transitions].sort(
      (a, b) => (a.priority || 100) - (b.priority || 100),
    );

    for (const transition of sortedTransitions) {
      let conditionMet = false;

      switch (transition.condition_type) {
        case 'all_tasks_complete':
          conditionMet = this.isCurrentStateComplete(state, currentState);
          break;

        case 'deliverable_value':
          const key = transition.condition_config?.key as string;
          const expected = transition.condition_config?.value;
          const actual = deliverables[key]?.value;
          conditionMet = actual === expected;
          break;

        case 'deliverable_exists':
          const existsKey = transition.condition_config?.key as string;
          conditionMet = existsKey in deliverables;
          break;
      }

      if (conditionMet) {
        const targetState = plan.states.find(s => s.id === transition.target_state_id);
        if (targetState) {
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
        }
      }
    }

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

      return {
        id: planState.id,
        title: planState.title || planState.id,
        type: planState.type || 'loose',
        status: stateStatus,
        tasks,
      };
    });

    // Build collected deliverables map
    const collectedDeliverablesMap: Record<string, unknown> = {};
    for (const [key, data] of Object.entries(deliverables)) {
      collectedDeliverablesMap[key] = data.value;
    }

    const progress = await this.calculateProgress(sessionId);

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
