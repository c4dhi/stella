import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { GeneratePlanTemplateDto } from './dto/generate-plan-template.dto';

// Canonical plan types matching stella-ai-agent-sdk/plan
interface PlanDeliverable {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  description: string;
  required: boolean;
  acceptance_criteria?: string;
  enum_values?: string[];
}

interface PlanTask {
  id: string;
  description: string;
  instruction?: string;
  required: boolean;
  deliverables: PlanDeliverable[];
}

interface StateTransition {
  target_state_id: string;
  condition_type?: string;
  priority?: number;
  condition_config?: Record<string, unknown>;
}

interface StateGoal {
  objective: string;
  context?: string;
  depth_guidance?: string;
  boundaries?: string;
  success_description?: string;
}

interface PlanState {
  id: string;
  title: string;
  type: 'strict' | 'loose' | 'goal';
  description?: string;
  tasks: PlanTask[];
  transitions?: StateTransition[];
  goal?: StateGoal;
}

interface PlanContent {
  id: string;
  title: string;
  description?: string;
  initial_state_id?: string;
  states: PlanState[];
  metadata?: Record<string, unknown>;
  system_prompt?: string;
}

export interface GeneratePlanTemplateResponse {
  content: PlanContent;
  suggestedName: string;
  suggestedDescription: string;
}

@Injectable()
export class PlanGeneratorService {
  private readonly logger = new Logger(PlanGeneratorService.name);
  private readonly openai: OpenAI | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>(
      'OPENAI_PLAN_GENERATOR_API_KEY',
    );
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      this.logger.log('Plan Generator initialized with OpenAI');
    } else {
      this.logger.warn(
        'OPENAI_PLAN_GENERATOR_API_KEY not configured - plan generation disabled',
      );
    }
  }

  async generate(
    dto: GeneratePlanTemplateDto,
  ): Promise<GeneratePlanTemplateResponse> {
    if (!this.openai) {
      throw new InternalServerErrorException(
        'Plan generation is not configured. Please set OPENAI_PLAN_GENERATOR_API_KEY.',
      );
    }

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(dto);

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new InternalServerErrorException('Empty response from OpenAI');
      }

      const parsed = JSON.parse(content) as GeneratePlanTemplateResponse;
      return this.validateAndNormalizeResponse(parsed);
    } catch (error) {
      this.logger.error('Plan generation failed', error);
      if (error instanceof SyntaxError) {
        throw new InternalServerErrorException('Failed to parse AI response');
      }
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to generate plan. Please try again.',
      );
    }
  }

  private buildSystemPrompt(): string {
    return `You are an expert at designing structured conversation plans for AI voice agents.
Your task is to generate a PlanContent JSON structure based on user descriptions.

IMPORTANT CONCEPT HIERARCHY:
- STATE = A distinct phase in the conversation (e.g., "Greeting", "Questions", "Farewell")
- TASK = A granular to-do item within a state (e.g., "Learn the user's name", "Ask about workout frequency")
- DELIVERABLE = A single data variable that a task produces (e.g., "user_name", "workout_frequency")

Think of it like this:
- States are like chapters in a conversation
- Tasks are individual questions or micro-goals (usually 1 deliverable per task)
- Deliverables are the actual data points/variables collected

STATE TYPES — choose carefully based on the conversational intent:
- "strict": Tasks are completed sequentially, one at a time. Use for: tutorials, games, guided flows where order matters.
- "loose": Tasks can be completed in any order, agent chooses. Use for: surveys, intake forms, structured data collection.
- "goal": Agent has a NATURAL CONVERSATION toward an objective. Tasks are invisible to the agent — it sees information gaps instead. Use for: coaching, interviews, therapy, discovery conversations, any state where natural dialogue matters more than task execution. REQUIRES a "goal" object.

When using type "goal", you MUST include a "goal" object on the state:
{
  "goal": {
    "objective": "What the conversation should achieve",
    "context": "Background the AI needs to understand the domain",
    "depth_guidance": "How deep to probe — when to accept answers vs push further",
    "boundaries": "What topics to avoid (covered elsewhere or out of scope)",
    "success_description": "What a well-conducted version of this phase looks like"
  }
}

The structure must follow this exact schema:
{
  "content": {
    "id": "plan_<unique_id>",
    "title": "Human-readable plan name",
    "description": "Brief description of the plan purpose",
    "initial_state_id": "state_<first_state_id>",
    "states": [
      {
        "id": "state_<unique_id>",
        "title": "State Name",
        "type": "strict" | "loose" | "goal",
        "description": "What this phase accomplishes",
        "goal": { ... },
        "tasks": [
          {
            "id": "task_<unique_id>",
            "description": "What to ask/do",
            "instruction": "How to ask it (optional, not used in goal mode)",
            "required": true | false,
            "deliverables": [
              {
                "key": "variable_name",
                "description": "What this captures",
                "type": "string" | "number" | "boolean" | "enum",
                "required": true | false,
                "acceptance_criteria": "What constitutes a valid, complete answer. Include concrete examples of good and bad answers.",
                "enum_values": ["option1", "option2"]
              }
            ]
          }
        ]
      }
    ],
    "system_prompt": "AI agent persona description",
    "metadata": {}
  },
  "suggestedName": "Short plan name (max 50 chars)",
  "suggestedDescription": "Brief description (1-2 sentences)"
}

EXAMPLE 1 — Structured plan with strict/loose states:

{
  "content": {
    "id": "plan_fitness_checkin",
    "title": "Fitness Activity Check-in",
    "description": "A brief conversation to learn about someone's exercise habits",
    "initial_state_id": "state_greeting",
    "states": [
      {
        "id": "state_greeting",
        "title": "Greeting",
        "type": "strict",
        "description": "Welcome the user and get their name",
        "tasks": [
          {
            "id": "task_welcome",
            "description": "Greet and ask for name",
            "instruction": "Warmly greet the user and ask what they'd like to be called",
            "required": true,
            "deliverables": [
              {
                "key": "user_name",
                "description": "User's preferred name",
                "type": "string",
                "required": true,
                "acceptance_criteria": "A real name or nickname the user wants to be called. E.g. 'Sarah', 'Mike', 'Dr. Johnson'. Reject generic non-answers like 'nobody' or 'doesn't matter'."
              }
            ]
          }
        ]
      },
      {
        "id": "state_fitness_questions",
        "title": "Fitness Activity",
        "type": "loose",
        "description": "Learn about the user's exercise habits",
        "tasks": [
          {
            "id": "task_workout_type",
            "description": "Ask about preferred exercise",
            "instruction": "Ask what type of exercise they enjoy most",
            "required": true,
            "deliverables": [
              {
                "key": "preferred_exercise",
                "description": "Type of exercise they prefer",
                "type": "enum",
                "required": true,
                "enum_values": ["Running", "Swimming", "Gym/Weights", "Yoga", "Team Sports", "Other"],
                "acceptance_criteria": "Must be a specific activity type. If user says 'cardio', probe for which specific cardio activity."
              }
            ]
          },
          {
            "id": "task_frequency",
            "description": "Ask about workout frequency",
            "required": true,
            "deliverables": [
              {
                "key": "weekly_frequency",
                "description": "Times per week they exercise",
                "type": "number",
                "required": true,
                "acceptance_criteria": "A specific number between 0-7. If they say 'a few times' or 'sometimes', pin down the exact number."
              }
            ]
          },
          {
            "id": "task_goals",
            "description": "Ask about fitness goals",
            "required": false,
            "deliverables": [
              {
                "key": "fitness_goal",
                "description": "Their main fitness objective",
                "type": "string",
                "required": false,
                "acceptance_criteria": "A specific, measurable goal. E.g. 'Lose 10kg by summer', 'Run a marathon in under 4 hours'. Reject vague answers like 'get healthier' or 'be more fit' — probe for specifics."
              }
            ]
          }
        ]
      },
      {
        "id": "state_farewell",
        "title": "Farewell",
        "type": "strict",
        "description": "Thank the user and close the conversation",
        "tasks": [
          {
            "id": "task_thank_and_close",
            "description": "Thank user and say goodbye",
            "instruction": "Summarize what you learned, thank them, and wish them well",
            "required": true,
            "deliverables": []
          }
        ]
      }
    ],
    "system_prompt": "You are a friendly fitness coach conducting a quick check-in. Be encouraging and enthusiastic about exercise. Use casual, supportive language."
  },
  "suggestedName": "Fitness Activity Check-in",
  "suggestedDescription": "A brief conversation to learn about someone's exercise habits and fitness goals."
}

EXAMPLE 2 — Goal-oriented plan for natural conversation:

{
  "content": {
    "id": "plan_coaching_session",
    "title": "Life Coaching Discovery",
    "description": "A natural coaching conversation to understand the client's current situation and aspirations",
    "initial_state_id": "state_rapport",
    "states": [
      {
        "id": "state_rapport",
        "title": "Build Rapport",
        "type": "goal",
        "description": "Establish a warm connection and understand who the client is",
        "goal": {
          "objective": "Build genuine rapport and learn who the client is as a person",
          "context": "This is a first coaching session. The client may be nervous or unsure what to expect.",
          "depth_guidance": "Let the conversation breathe. Don't rush to collect information. If they share something personal, acknowledge it before moving on. Accept brief answers for name/role but probe gently on what brought them here.",
          "boundaries": "Don't dive into problems or goals yet — this phase is about connection, not assessment.",
          "success_description": "The client feels heard and comfortable. You know their name, what they do, and have a sense of what prompted them to seek coaching."
        },
        "tasks": [
          {
            "id": "task_identity",
            "description": "Learn who they are",
            "required": true,
            "deliverables": [
              {
                "key": "client_name",
                "description": "Client's preferred name",
                "type": "string",
                "required": true,
                "acceptance_criteria": "Their preferred first name or nickname."
              },
              {
                "key": "client_role",
                "description": "What they do professionally or how they spend their time",
                "type": "string",
                "required": true,
                "acceptance_criteria": "A brief description of their work or life situation. E.g. 'marketing manager at a startup', 'retired teacher', 'stay-at-home parent'. One sentence is fine."
              }
            ]
          },
          {
            "id": "task_motivation",
            "description": "Understand what brought them to coaching",
            "required": true,
            "deliverables": [
              {
                "key": "coaching_trigger",
                "description": "What prompted them to seek coaching",
                "type": "string",
                "required": true,
                "acceptance_criteria": "A genuine reason, not just 'I thought it would be good'. Should reveal some emotional or situational driver. E.g. 'I got promoted and feel overwhelmed', 'going through a divorce', 'feeling stuck in my career for 2 years'."
              }
            ]
          }
        ]
      },
      {
        "id": "state_exploration",
        "title": "Explore Aspirations",
        "type": "goal",
        "description": "Understand what the client wants to change or achieve",
        "goal": {
          "objective": "Discover what the client truly wants — not just surface goals but underlying desires and values",
          "context": "You've built initial rapport. The client is now more comfortable sharing.",
          "depth_guidance": "Push past surface-level goals. If they say 'I want to be happier', ask what happiness looks like for them specifically. Use open questions. Reflect back what you hear to confirm understanding. Aim for 2-3 exchanges per deliverable, not one-shot extraction.",
          "boundaries": "Don't offer solutions or advice yet. This is about understanding, not fixing. Don't diagnose or label their situation.",
          "success_description": "You understand 1-2 concrete things they want to change, why those matter to them, and what's been getting in the way."
        },
        "tasks": [
          {
            "id": "task_desired_change",
            "description": "What they want to be different",
            "required": true,
            "deliverables": [
              {
                "key": "primary_goal",
                "description": "The main thing they want to change or achieve",
                "type": "string",
                "required": true,
                "acceptance_criteria": "A specific, personally meaningful goal. Must go beyond surface level. E.g. 'I want to set boundaries at work so I can be present with my kids' not just 'better work-life balance'."
              },
              {
                "key": "underlying_value",
                "description": "The value or need driving their goal",
                "type": "string",
                "required": false,
                "acceptance_criteria": "A core value or emotional need. E.g. 'autonomy', 'being a good parent', 'feeling competent'. This may emerge naturally — don't force it."
              }
            ]
          },
          {
            "id": "task_obstacles",
            "description": "What's been getting in the way",
            "required": true,
            "deliverables": [
              {
                "key": "main_obstacle",
                "description": "The primary barrier to their goal",
                "type": "string",
                "required": true,
                "acceptance_criteria": "A specific obstacle, not a vague complaint. E.g. 'My manager expects me to be available 24/7 and I can't say no' not just 'work is stressful'."
              }
            ]
          }
        ]
      },
      {
        "id": "state_closing",
        "title": "Closing",
        "type": "strict",
        "description": "Summarize and close the session warmly",
        "tasks": [
          {
            "id": "task_close",
            "description": "Reflect back and close",
            "instruction": "Summarize the key themes you heard, validate their courage in sharing, and close warmly",
            "required": true,
            "deliverables": []
          }
        ]
      }
    ],
    "system_prompt": "You are a warm, experienced life coach conducting a discovery session. Listen more than you speak. Use reflective listening. Be genuinely curious about their experience. Never judge or prescribe — your role is to understand."
  },
  "suggestedName": "Life Coaching Discovery",
  "suggestedDescription": "A natural coaching conversation to understand the client's situation, aspirations, and obstacles."
}

Guidelines:
1. REQUIRED FIELDS: Always include id, title, description, and initial_state_id in content
2. STATES = conversation phases (typically 2-4 states)
3. TASKS = granular to-dos, usually ONE question per task (in strict/loose) or grouped by theme (in goal)
4. DELIVERABLES = individual variables (usually 1 per task, sometimes 0 for closing tasks)
5. STATE TYPE selection:
   - Use "strict" when order matters (games, tutorials, onboarding)
   - Use "loose" when questions can be asked in any order (surveys, intake forms)
   - Use "goal" when natural conversation matters most (coaching, interviews, therapy, discovery). ALWAYS include a "goal" object with at least "objective" for goal states.
6. Keep plans SHORT and focused - this is for brief voice conversations
7. Use appropriate types: string (open text), number (counts), boolean (yes/no), enum (choices)
8. Generate snake_case keys for deliverables: user_name, workout_frequency, etc.
9. ALWAYS include acceptance_criteria for deliverables — describe what constitutes a valid answer, include concrete examples of good AND bad answers
10. ALWAYS generate a system_prompt with:
    - Clear role (e.g., "You are a friendly fitness coach...")
    - Communication style (casual, professional, enthusiastic, etc.)
    - 2-3 sentences max
11. For goal states, the "goal" object is critical — it tells the AI HOW to conduct the conversation, not just WHAT to collect

Respond ONLY with valid JSON matching the schema above.`;
  }

  private buildUserPrompt(dto: GeneratePlanTemplateDto): string {
    let prompt = `Generate a structured plan for the following:\n\n${dto.prompt}`;
    if (dto.context) {
      prompt += `\n\nAdditional context: ${dto.context}`;
    }
    return prompt;
  }

  private validateAndNormalizeResponse(
    response: GeneratePlanTemplateResponse,
  ): GeneratePlanTemplateResponse {
    // Ensure all IDs are proper UUIDs (don't rely on AI-generated IDs)
    if (!response.content?.states) {
      throw new InternalServerErrorException(
        'Invalid response structure: missing states',
      );
    }

    // Generate proper UUIDs for all plan elements
    response.content.id = uuidv4();
    response.content.title =
      response.content.title || response.suggestedName || 'Generated Plan';
    response.content.description =
      response.content.description || response.suggestedDescription || '';

    // First pass: Create mapping from old state IDs to new UUIDs
    const stateIdMap = new Map<string, string>();
    for (const state of response.content.states) {
      const oldId = state.id || '';
      const newId = uuidv4();
      stateIdMap.set(oldId, newId);
    }

    // Second pass: Update states with new IDs and fix transition references
    response.content.states = response.content.states.map((state) => ({
      ...state,
      id: stateIdMap.get(state.id || '') || uuidv4(),
      title: state.title || 'Untitled State',
      type: state.type || 'loose',
      // Preserve goal object for goal-type states
      goal: state.type === 'goal' ? state.goal : undefined,
      tasks: (state.tasks || []).map((task) => ({
        ...task,
        id: uuidv4(), // Always use UUID for task IDs
        description: task.description || 'Untitled Task',
        required: task.required ?? true,
        deliverables: (task.deliverables || []).map((del) => ({
          ...del,
          // Keep deliverable keys as snake_case identifiers (not UUIDs)
          // These are used as variable names, so should be meaningful
          key: del.key || `deliverable_${uuidv4().slice(0, 8)}`,
          description: del.description || 'Unnamed deliverable',
          type: del.type || 'string',
          required: del.required ?? true,
        })),
      })),
      // Update transition target_state_ids to use new UUIDs
      transitions: (state.transitions || []).map((trans) => ({
        ...trans,
        target_state_id:
          stateIdMap.get(trans.target_state_id) || trans.target_state_id,
      })),
    }));

    // Set initial_state_id to first state if not provided
    if (
      !response.content.initial_state_id &&
      response.content.states.length > 0
    ) {
      response.content.initial_state_id = response.content.states[0].id;
    }

    // Auto-generate transitions if missing
    // Each state (except the last) gets a transition to the next state
    response.content.states = response.content.states.map((state, index) => {
      // If state already has transitions, keep them
      if (state.transitions && state.transitions.length > 0) {
        return state;
      }

      // If this is the last state, no transition needed
      if (index === response.content.states.length - 1) {
        return { ...state, transitions: [] };
      }

      // Generate default transition to next state
      const nextStateId = response.content.states[index + 1].id;
      return {
        ...state,
        transitions: [
          {
            target_state_id: nextStateId,
            condition_type: 'all_tasks_complete',
            priority: 1,
          },
        ],
      };
    });

    this.logger.log(
      `Generated transitions for ${response.content.states.length} states`,
    );

    // Ensure we have suggested name and description
    response.suggestedName = response.suggestedName || 'Generated Plan';
    response.suggestedDescription =
      response.suggestedDescription || 'AI-generated plan template';

    return response;
  }
}
