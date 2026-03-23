import * as yaml from 'js-yaml'
import { z } from 'zod'
import {
  MANIFEST_SCHEMA_VERSION,
  RESOURCE_LIMITS,
  SLUG_REGEX,
  VERSION_REGEX,
} from '../agent-manifest.types'

const VALID_CAPABILITIES = ['voice', 'text', 'progress', 'plans', 'experts'] as const
const VALID_SLOT_TYPES = ['text', 'number', 'select', 'string_list', 'key_value', 'expert_list'] as const
const ENV_VAR_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
type JsonPrimitive = z.infer<typeof jsonPrimitiveSchema>

type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

// Recursive JSON value schema used by configSchema/defaultConfig/pipeline defaults.
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
)

// Subset of JSON Schema we currently accept inside configSchema properties.
const jsonSchemaNodeSchema: z.ZodType<Record<string, JsonValue>> = z.lazy(() =>
  z
    .object({
      type: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      properties: z.record(z.string(), jsonSchemaNodeSchema).optional(),
      items: z.union([jsonSchemaNodeSchema, z.array(jsonSchemaNodeSchema)]).optional(),
      required: z.array(z.string()).optional(),
      additionalProperties: z.union([z.boolean(), jsonSchemaNodeSchema]).optional(),
      enum: z.array(jsonValueSchema).optional(),
      default: jsonValueSchema.optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().nonnegative().optional(),
      pattern: z.string().optional(),
      format: z.string().optional(),
      'x-stella-requires-plan': z.boolean().optional(),
    })
    .catchall(jsonValueSchema),
)

const optionalEnvVarSchema = z.object({
  name: z.string().regex(ENV_VAR_NAME_REGEX, 'must be an uppercase environment variable name'),
  description: z.string().optional(),
  default: z.string().optional(),
})

const configSchemaSchema = z
  .object({
    type: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    properties: z.record(z.string(), jsonSchemaNodeSchema).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.union([z.boolean(), jsonSchemaNodeSchema]).optional(),
    default: jsonValueSchema.optional(),
    'x-stella-env-vars': z.array(z.string().regex(ENV_VAR_NAME_REGEX)).optional(),
    'x-stella-optional-env-vars': z.array(optionalEnvVarSchema).optional(),
    'x-stella-supports-configurator': z.boolean().optional(),
  })
  .catchall(jsonValueSchema)
  .superRefine((schema, ctx) => {
    // We only support object-shaped top-level config schemas.
    if (schema.type !== undefined && schema.type !== 'object') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'configSchema.type must be "object" when provided',
      })
    }
  })

const pipelineSlotSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(VALID_SLOT_TYPES),
    description: z.string().optional(),
    default: jsonValueSchema.optional(),
    options: z.array(z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    maxLength: z.number().int().positive().optional(),
    isCustom: z.boolean().optional(),
  })
  .superRefine((slot, ctx) => {
    // Select controls are not meaningful without explicit options.
    if (slot.type === 'select' && (!slot.options || slot.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'select slots must define a non-empty options array',
        path: ['options'],
      })
    }
  })
  .passthrough()

const pipelineNodeSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    icon: z.string().optional(),
    position: z.object({ row: z.number(), col: z.number() }),
    slots: z.array(pipelineSlotSchema),
  })
  .passthrough()

const pipelineEdgeSchema = z
  .object({
    source: z.string().min(1),
    target: z.string().min(1),
    label: z.string().optional(),
    style: z.enum(['solid', 'dashed']).optional(),
  })
  .passthrough()

const pipelineThresholdSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    default: z.number().optional(),
  })
  .passthrough()

const pipelineSchemaSchema = z.object({
  nodes: z.array(pipelineNodeSchema),
  edges: z.array(pipelineEdgeSchema),
  thresholds: z.array(pipelineThresholdSchema),
})

const resourcesSchema = z.object({
  memory: z
    .object({
      request: z.string().regex(/^\d+[KMGkmg]i?$/, 'must be a valid Kubernetes memory value').optional(),
      limit: z.string().regex(/^\d+[KMGkmg]i?$/, 'must be a valid Kubernetes memory value').optional(),
    })
    .optional(),
  cpu: z
    .object({
      request: z.string().regex(/^\d+m?$/, 'must be a valid Kubernetes CPU value').optional(),
      limit: z.string().regex(/^\d+m?$/, 'must be a valid Kubernetes CPU value').optional(),
    })
    .optional(),
  gpu: z.boolean().optional(),
})

export const agentManifestSchema = z
  .object({
    version: z.string().min(1),
    metadata: z.object({
      name: z.string().min(1),
      slug: z
        .string()
        .min(1)
        .regex(
          SLUG_REGEX,
          'must start with a letter, and contain only lowercase letters, numbers, and hyphens',
        ),
      version: z
        .string()
        .min(1)
        .regex(VERSION_REGEX, 'must be semantic version format (e.g. 1.0.0)'),
      description: z.string().min(1),
      author: z
        .object({
          name: z.string().min(1),
          email: z.string().email().optional(),
        })
        .optional(),
      icon: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    capabilities: z.array(z.string()).optional(),
    image: z
      .object({
        dockerfile: z.string().min(1).optional(),
        imageUrl: z.string().min(1).optional(),
      })
      .superRefine((value, ctx) => {
        if (!value.dockerfile && !value.imageUrl) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Must specify either image.dockerfile or image.imageUrl',
          })
        }
      }),
    resources: resourcesSchema.optional(),
    configSchema: configSchemaSchema.optional(),
    pipelineSchema: pipelineSchemaSchema.optional(),
    defaultConfig: z.record(z.string(), jsonValueSchema).optional(),
    sdk: z
      .object({
        minVersion: z
          .string()
          .regex(VERSION_REGEX, 'must be semantic version format (e.g. 1.0.0)')
          .optional(),
      })
      .optional(),
  })
  .superRefine((manifest, ctx) => {
    // Keep resource guardrails aligned with runtime pod limits.
    if (manifest.resources?.memory?.limit) {
      const memoryLimitBytes = parseMemoryToBytes(manifest.resources.memory.limit)
      const maxMemoryBytes = parseMemoryToBytes(RESOURCE_LIMITS.memory.max)
      if (memoryLimitBytes > maxMemoryBytes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['resources', 'memory', 'limit'],
          message: `Memory limit exceeds maximum allowed: ${RESOURCE_LIMITS.memory.max}`,
        })
      }
    }

    if (manifest.resources?.cpu?.limit) {
      const cpuLimitMillicores = parseCpuToMillicores(manifest.resources.cpu.limit)
      const maxCpuMillicores = parseCpuToMillicores(RESOURCE_LIMITS.cpu.max)
      if (cpuLimitMillicores > maxCpuMillicores) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['resources', 'cpu', 'limit'],
          message: `CPU limit exceeds maximum allowed: ${RESOURCE_LIMITS.cpu.max}`,
        })
      }
    }
  })

export type CanonicalAgentManifest = z.infer<typeof agentManifestSchema>

export interface ManifestSchemaParseResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  manifest?: CanonicalAgentManifest
}

export function parseAgentManifestYaml(content: string): ManifestSchemaParseResult {
  let parsedYaml: unknown
  try {
    parsedYaml = yaml.load(content)
  } catch (error) {
    return {
      valid: false,
      errors: [`Invalid YAML: ${(error as Error).message}`],
      warnings: [],
    }
  }

  if (!parsedYaml || typeof parsedYaml !== 'object') {
    return {
      valid: false,
      errors: ['Manifest must be a valid YAML object'],
      warnings: [],
    }
  }

  const parsed = agentManifestSchema.safeParse(parsedYaml)
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map(formatIssue),
      warnings: [],
    }
  }

  const warnings: string[] = []
  const manifest = parsed.data

  // Non-fatal compatibility warnings are intentionally separate from structural validation.
  if (manifest.version !== MANIFEST_SCHEMA_VERSION) {
    warnings.push(`Manifest version ${manifest.version} may not be fully supported`)
  }

  if (manifest.image.dockerfile && manifest.image.imageUrl) {
    warnings.push('Both dockerfile and imageUrl specified; dockerfile will be used')
  }

  for (const capability of manifest.capabilities ?? []) {
    if (!VALID_CAPABILITIES.includes(capability as (typeof VALID_CAPABILITIES)[number])) {
      warnings.push(`Unknown capability: ${capability}`)
    }
  }

  if (manifest.resources?.gpu === true) {
    warnings.push('GPU resources require admin approval')
  }

  return {
    valid: true,
    errors: [],
    warnings,
    manifest,
  }
}

function formatIssue(issue: z.ZodIssue): string {
  const joinedPath = issue.path.length > 0 ? issue.path.join('.') : 'manifest'
  return `${joinedPath}: ${issue.message}`
}

function parseMemoryToBytes(size: string): number {
  const match = size.match(/^(\d+)([KMGkmg])i?$/)
  if (!match) return 0

  const value = parseInt(match[1], 10)
  const unit = match[2].toUpperCase()

  const multipliers: Record<string, number> = {
    K: 1024,
    M: 1024 * 1024,
    G: 1024 * 1024 * 1024,
  }

  return value * (multipliers[unit] || 1)
}

function parseCpuToMillicores(size: string): number {
  if (size.endsWith('m')) {
    return parseInt(size.slice(0, -1), 10)
  }
  return parseInt(size, 10) * 1000
}
