import { ManifestValidator } from './manifest.validator'

describe('ManifestValidator', () => {
  let validator: ManifestValidator

  beforeEach(() => {
    validator = new ManifestValidator()
  })

  it('validates a manifest with config schema extensions and pipeline schema', () => {
    const result = validator.validate(`
version: "1.0"
metadata:
  name: "Test Agent"
  slug: "test-agent"
  version: "1.2.3"
  description: "Test manifest"
  author:
    name: "Tester"
    email: "tester@example.com"
  tags: ["voice", "test"]
capabilities: ["voice", "text"]
image:
  dockerfile: "Dockerfile"
resources:
  memory:
    request: "512Mi"
    limit: "2Gi"
  cpu:
    request: "250m"
    limit: "1000m"
configSchema:
  type: object
  x-stella-supports-configurator: true
  x-stella-env-vars:
    - OPENAI_API_KEY
  x-stella-optional-env-vars:
    - name: INTERRUPT_MODE
      description: "Optional override"
      default: "none"
  properties:
    plan:
      type: object
      x-stella-requires-plan: true
defaultConfig:
  llm:
    model: "gpt-4o-mini"
pipelineSchema:
  nodes:
    - id: input_gate
      label: "Input Gate"
      position: { row: 0, col: 0 }
      slots:
        - id: model
          label: "Model"
          type: select
          options: ["gpt-4o-mini", "gpt-4o"]
          default: "gpt-4o-mini"
  edges: []
  thresholds: []
sdk:
  minVersion: "0.4.0"
`)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.manifest?.configSchema?.['x-stella-supports-configurator']).toBe(true)
  })

  it('rejects invalid x-stella optional env var names', () => {
    const result = validator.validate(`
version: "1.0"
metadata:
  name: "Bad Env Agent"
  slug: "bad-env-agent"
  version: "1.0.0"
  description: "Bad env var"
image:
  dockerfile: "Dockerfile"
configSchema:
  type: object
  x-stella-optional-env-vars:
    - name: bad-name
`)

    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toContain('x-stella-optional-env-vars.0.name')
  })

  it('rejects select slots without options in pipeline schema', () => {
    const result = validator.validate(`
version: "1.0"
metadata:
  name: "Bad Pipeline Agent"
  slug: "bad-pipeline-agent"
  version: "1.0.0"
  description: "Bad pipeline"
image:
  dockerfile: "Dockerfile"
pipelineSchema:
  nodes:
    - id: response
      label: "Response"
      position: { row: 0, col: 0 }
      slots:
        - id: model
          label: "Model"
          type: select
  edges: []
  thresholds: []
`)

    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toContain('select slots must define a non-empty options array')
  })

  it('keeps compatibility warnings as warnings', () => {
    const result = validator.validate(`
version: "2.0"
metadata:
  name: "Warning Agent"
  slug: "warning-agent"
  version: "1.0.0"
  description: "warn"
image:
  dockerfile: "Dockerfile"
  imageUrl: "registry.example.com/agent:latest"
capabilities: ["voice", "unknown-capability"]
resources:
  gpu: true
`)

    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Manifest version 2.0 may not be fully supported',
        'Both dockerfile and imageUrl specified; dockerfile will be used',
        'Unknown capability: unknown-capability',
        'GPU resources require admin approval',
      ]),
    )
  })
})
