import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GeneratePlanTemplateDto } from './dto/generate-plan-template.dto';

interface PlanDeliverable {
  id: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  description?: string;
  required: boolean;
  enumValues?: string[];
  examples?: string[];
}

interface PlanTask {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  deliverables: PlanDeliverable[];
}

interface PlanState {
  id: string;
  label: string;
  execution_mode: 'sequential' | 'flexible';
  description?: string;
  tasks: PlanTask[];
}

interface PlanContent {
  states: PlanState[];
  metadata?: Record<string, unknown>;
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
    return `You are an expert at designing structured plans for AI-powered workflows.
Your task is to generate a PlanContent JSON structure based on user descriptions.

The structure must follow this exact schema:
{
  "content": {
    "states": [
      {
        "id": "state_<unique_timestamp>",
        "label": "State Name",
        "execution_mode": "sequential" | "flexible",
        "description": "Optional description of this state/phase",
        "tasks": [
          {
            "id": "task_<unique_timestamp>",
            "label": "Task Name",
            "description": "Optional task description",
            "required": true | false,
            "deliverables": [
              {
                "id": "deliverable_<unique_timestamp>",
                "label": "Deliverable Name",
                "type": "string" | "number" | "boolean" | "enum",
                "description": "What this deliverable captures",
                "required": true | false,
                "enumValues": ["option1", "option2"],
                "examples": ["Example 1", "Example 2"]
              }
            ]
          }
        ]
      }
    ],
    "metadata": {}
  },
  "suggestedName": "A short, descriptive name for this plan (max 50 chars)",
  "suggestedDescription": "A brief description of what this plan accomplishes (1-2 sentences)"
}

CRITICAL: Deliverable examples must be CONCRETE and REALISTIC, not generic placeholders.

Here is an example of a well-structured plan with realistic deliverable examples:

{
  "content": {
    "states": [
      {
        "id": "state_1",
        "label": "Initial Discovery",
        "execution_mode": "sequential",
        "description": "Gather key information about the customer's needs and situation",
        "tasks": [
          {
            "id": "task_1",
            "label": "Company Background",
            "description": "Understand the customer's business context",
            "required": true,
            "deliverables": [
              {
                "id": "del_1",
                "label": "Company Name",
                "type": "string",
                "required": true,
                "examples": ["Acme Healthcare Solutions", "TechStart GmbH", "Green Energy Corp"]
              },
              {
                "id": "del_2",
                "label": "Industry Sector",
                "type": "enum",
                "required": true,
                "enumValues": ["Healthcare", "Technology", "Manufacturing", "Finance", "Retail", "Other"],
                "examples": ["Healthcare", "Technology"]
              },
              {
                "id": "del_3",
                "label": "Employee Count",
                "type": "number",
                "required": true,
                "description": "Total number of employees in the organization",
                "examples": ["50", "250", "1200"]
              },
              {
                "id": "del_4",
                "label": "Current Challenges",
                "type": "string",
                "required": true,
                "description": "Main pain points the customer is facing",
                "examples": [
                  "Manual data entry consuming 20+ hours weekly, leading to delayed reporting",
                  "Customer support response times averaging 48 hours, causing churn",
                  "Inventory discrepancies of 15% causing stockouts and lost sales"
                ]
              }
            ]
          },
          {
            "id": "task_2",
            "label": "Budget Discussion",
            "required": true,
            "deliverables": [
              {
                "id": "del_5",
                "label": "Annual Budget Range",
                "type": "enum",
                "required": true,
                "enumValues": ["Under €10,000", "€10,000-€50,000", "€50,000-€100,000", "Over €100,000"],
                "examples": ["€10,000-€50,000"]
              },
              {
                "id": "del_6",
                "label": "Budget Approval Status",
                "type": "boolean",
                "required": true,
                "description": "Is budget already approved for this initiative?",
                "examples": ["true", "false"]
              }
            ]
          }
        ]
      },
      {
        "id": "state_2",
        "label": "Technical Assessment",
        "execution_mode": "flexible",
        "description": "Evaluate technical requirements and integration needs",
        "tasks": [
          {
            "id": "task_3",
            "label": "Infrastructure Review",
            "required": true,
            "deliverables": [
              {
                "id": "del_7",
                "label": "Current Systems",
                "type": "string",
                "required": true,
                "description": "Key software systems currently in use",
                "examples": [
                  "SAP ERP, Salesforce CRM, custom PostgreSQL database, Microsoft 365",
                  "Oracle NetSuite, HubSpot, AWS infrastructure with S3 and Lambda",
                  "Legacy mainframe system, on-premise Exchange server, custom PHP application"
                ]
              },
              {
                "id": "del_8",
                "label": "API Integration Required",
                "type": "boolean",
                "required": true,
                "examples": ["true", "false"]
              },
              {
                "id": "del_9",
                "label": "Data Volume Estimate",
                "type": "string",
                "required": false,
                "description": "Estimated amount of data to be processed",
                "examples": ["~50,000 records/month", "2TB historical data + 100GB monthly growth", "500 transactions/day"]
              }
            ]
          }
        ]
      }
    ]
  },
  "suggestedName": "Customer Discovery Process",
  "suggestedDescription": "Structured discovery workflow for qualifying new enterprise customers and understanding their technical needs."
}

Guidelines:
1. Create logical states that represent distinct phases of the workflow
2. Use "sequential" execution_mode when tasks must be completed in order
3. Use "flexible" execution_mode when tasks can be done in any order
4. Include meaningful deliverables that capture the output of each task
5. Use appropriate deliverable types:
   - "string" for text responses (open-ended answers)
   - "number" for numeric values (counts, amounts, percentages)
   - "boolean" for yes/no questions
   - "enum" for multiple choice (include enumValues array)
6. Generate unique IDs using the format: state_<timestamp>, task_<timestamp>, deliverable_<timestamp>
7. Keep the plan practical and achievable
8. Add helpful descriptions to states, tasks, and deliverables
9. ALWAYS include realistic examples for EVERY deliverable - examples should be specific and plausible real-world values, NOT generic placeholders like "example value" or "discussed X"
10. Mark critical deliverables as required: true

Respond ONLY with valid JSON matching the schema above. No additional text or explanation.`;
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
    // Ensure all IDs are unique by regenerating them with timestamp + counter
    const timestamp = Date.now();
    let counter = 0;

    if (!response.content?.states) {
      throw new InternalServerErrorException(
        'Invalid response structure: missing states',
      );
    }

    response.content.states = response.content.states.map((state) => ({
      ...state,
      id: state.id || `state_${timestamp}_${counter++}`,
      execution_mode: state.execution_mode || 'flexible',
      tasks: (state.tasks || []).map((task) => ({
        ...task,
        id: task.id || `task_${timestamp}_${counter++}`,
        required: task.required ?? true,
        deliverables: (task.deliverables || []).map((del) => ({
          ...del,
          id: del.id || `deliverable_${timestamp}_${counter++}`,
          type: del.type || 'string',
          required: del.required ?? true,
        })),
      })),
    }));

    // Ensure we have suggested name and description
    response.suggestedName = response.suggestedName || 'Generated Plan';
    response.suggestedDescription =
      response.suggestedDescription || 'AI-generated plan template';

    return response;
  }
}
