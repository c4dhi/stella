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
  examples?: string[];
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

interface PlanState {
  id: string;
  title: string;
  type: 'strict' | 'loose';
  description?: string;
  tasks: PlanTask[];
  transitions?: StateTransition[];
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
        "type": "strict" | "loose",
        "description": "What this phase accomplishes",
        "tasks": [
          {
            "id": "task_<unique_id>",
            "description": "What to ask/do",
            "instruction": "How to ask it (optional)",
            "required": true | false,
            "deliverables": [
              {
                "key": "variable_name",
                "description": "What this captures",
                "type": "string" | "number" | "boolean" | "enum",
                "required": true | false,
                "enum_values": ["option1", "option2"],
                "examples": ["realistic example 1", "realistic example 2"]
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

Here is an example of a well-structured plan - notice how tasks are GRANULAR (one question = one task):

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
                "examples": ["Sarah", "Mike", "Dr. Johnson"]
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
                "examples": ["Running", "Yoga"]
              }
            ]
          },
          {
            "id": "task_frequency",
            "description": "Ask about workout frequency",
            "instruction": "Ask how often they exercise per week",
            "required": true,
            "deliverables": [
              {
                "key": "weekly_frequency",
                "description": "Times per week they exercise",
                "type": "number",
                "required": true,
                "examples": ["3", "5", "7"]
              }
            ]
          },
          {
            "id": "task_duration",
            "description": "Ask about workout duration",
            "instruction": "Ask how long their typical workout session is",
            "required": true,
            "deliverables": [
              {
                "key": "session_duration_minutes",
                "description": "Typical workout length in minutes",
                "type": "number",
                "required": true,
                "examples": ["30", "45", "60", "90"]
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
                "examples": ["Lose 10kg by summer", "Run a marathon", "Build muscle", "Improve flexibility"]
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
    "system_prompt": "You are a friendly fitness coach conducting a quick check-in. Be encouraging and enthusiastic about exercise. Use casual, supportive language. Celebrate their efforts regardless of frequency or intensity."
  },
  "suggestedName": "Fitness Activity Check-in",
  "suggestedDescription": "A brief conversation to learn about someone's exercise habits and fitness goals."
}

Guidelines:
1. REQUIRED FIELDS: Always include id, title, description, and initial_state_id in content
2. STATES = conversation phases (typically 2-4 states: greeting, main questions, farewell)
3. TASKS = granular to-dos, usually ONE question per task
4. DELIVERABLES = individual variables (usually 1 per task, sometimes 0 for closing tasks)
5. Use "strict" when order matters, "loose" when questions can be asked flexibly
6. Keep plans SHORT and focused - this is for brief voice conversations
7. Use appropriate types: string (open text), number (counts), boolean (yes/no), enum (choices)
8. Generate snake_case keys for deliverables: user_name, workout_frequency, etc.
9. ALWAYS include realistic examples for deliverables
10. ALWAYS generate a system_prompt with:
    - Clear role (e.g., "You are a friendly fitness coach...")
    - Communication style (casual, professional, enthusiastic, etc.)
    - 2-3 sentences max

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

    // Ensure we have suggested name and description
    response.suggestedName = response.suggestedName || 'Generated Plan';
    response.suggestedDescription =
      response.suggestedDescription || 'AI-generated plan template';

    return response;
  }
}
