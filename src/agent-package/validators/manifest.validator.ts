import { Injectable } from '@nestjs/common'
import {
  AgentManifest,
  ManifestValidationResult,
} from '../agent-manifest.types'
import { parseAgentManifestYaml } from '../schemas/agent-manifest.schema'

@Injectable()
export class ManifestValidator {
  /**
   * Thin adapter around the canonical Zod parser so all entrypoints share identical rules.
   */
  validate(content: string): ManifestValidationResult {
    const parsed = parseAgentManifestYaml(content)

    return {
      valid: parsed.valid,
      errors: parsed.errors,
      warnings: parsed.warnings,
      manifest: parsed.manifest as AgentManifest | undefined,
    }
  }
}
