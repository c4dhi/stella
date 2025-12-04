import { Injectable, Logger } from '@nestjs/common'
import * as yaml from 'js-yaml'
import {
  AgentManifest,
  ManifestValidationResult,
  SLUG_REGEX,
  VERSION_REGEX,
  RESOURCE_LIMITS,
} from '../agent-manifest.types'

@Injectable()
export class ManifestValidator {
  private readonly logger = new Logger(ManifestValidator.name)

  /**
   * Parse and validate an agent.yaml manifest file.
   */
  validate(content: string): ManifestValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Parse YAML
    let manifest: AgentManifest
    try {
      manifest = yaml.load(content) as AgentManifest
    } catch (error) {
      return {
        valid: false,
        errors: [`Invalid YAML: ${error.message}`],
        warnings: [],
      }
    }

    if (!manifest || typeof manifest !== 'object') {
      return {
        valid: false,
        errors: ['Manifest must be a valid YAML object'],
        warnings: [],
      }
    }

    // Validate version
    if (!manifest.version) {
      errors.push('Missing required field: version')
    } else if (manifest.version !== '1.0') {
      warnings.push(`Manifest version ${manifest.version} may not be fully supported`)
    }

    // Validate metadata
    if (!manifest.metadata) {
      errors.push('Missing required field: metadata')
    } else {
      if (!manifest.metadata.name) {
        errors.push('Missing required field: metadata.name')
      }

      if (!manifest.metadata.slug) {
        errors.push('Missing required field: metadata.slug')
      } else if (!SLUG_REGEX.test(manifest.metadata.slug)) {
        errors.push(
          'Invalid slug: must start with a letter, contain only lowercase letters, numbers, and hyphens',
        )
      }

      if (!manifest.metadata.version) {
        errors.push('Missing required field: metadata.version')
      } else if (!VERSION_REGEX.test(manifest.metadata.version)) {
        errors.push('Invalid version format: must be semantic version (e.g., 1.0.0)')
      }

      if (!manifest.metadata.description) {
        errors.push('Missing required field: metadata.description')
      }
    }

    // Validate image configuration
    if (!manifest.image) {
      errors.push('Missing required field: image')
    } else {
      if (!manifest.image.dockerfile && !manifest.image.imageUrl) {
        errors.push('Must specify either image.dockerfile or image.imageUrl')
      }
      if (manifest.image.dockerfile && manifest.image.imageUrl) {
        warnings.push('Both dockerfile and imageUrl specified; dockerfile will be used')
      }
    }

    // Validate resources
    if (manifest.resources) {
      this.validateResources(manifest.resources, errors, warnings)
    }

    // Validate capabilities
    if (manifest.capabilities) {
      if (!Array.isArray(manifest.capabilities)) {
        errors.push('capabilities must be an array')
      } else {
        const validCapabilities = ['voice', 'text', 'progress', 'plans', 'experts']
        for (const cap of manifest.capabilities) {
          if (!validCapabilities.includes(cap)) {
            warnings.push(`Unknown capability: ${cap}`)
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      manifest: errors.length === 0 ? manifest : undefined,
    }
  }

  private validateResources(
    resources: AgentManifest['resources'],
    errors: string[],
    warnings: string[],
  ): void {
    if (resources?.memory) {
      if (resources.memory.limit) {
        if (!this.isValidMemorySize(resources.memory.limit)) {
          errors.push(`Invalid memory limit format: ${resources.memory.limit}`)
        } else if (this.parseMemoryToBytes(resources.memory.limit) > this.parseMemoryToBytes(RESOURCE_LIMITS.memory.max)) {
          errors.push(`Memory limit exceeds maximum allowed: ${RESOURCE_LIMITS.memory.max}`)
        }
      }
    }

    if (resources?.cpu) {
      if (resources.cpu.limit) {
        if (!this.isValidCpuSize(resources.cpu.limit)) {
          errors.push(`Invalid CPU limit format: ${resources.cpu.limit}`)
        } else if (this.parseCpuToMillicores(resources.cpu.limit) > this.parseCpuToMillicores(RESOURCE_LIMITS.cpu.max)) {
          errors.push(`CPU limit exceeds maximum allowed: ${RESOURCE_LIMITS.cpu.max}`)
        }
      }
    }

    if (resources?.gpu === true) {
      warnings.push('GPU resources require admin approval')
    }
  }

  private isValidMemorySize(size: string): boolean {
    return /^\d+[KMGkmg]i?$/.test(size)
  }

  private isValidCpuSize(size: string): boolean {
    return /^\d+m?$/.test(size)
  }

  private parseMemoryToBytes(size: string): number {
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

  private parseCpuToMillicores(size: string): number {
    if (size.endsWith('m')) {
      return parseInt(size.slice(0, -1), 10)
    }
    return parseInt(size, 10) * 1000
  }
}
