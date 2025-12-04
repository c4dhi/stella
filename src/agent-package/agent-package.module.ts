import { Module } from '@nestjs/common'
import { StorageModule } from '../storage/storage.module'
import { AgentPackageService } from './agent-package.service'
import { ManifestValidator } from './validators/manifest.validator'
import { DockerfileValidator } from './validators/dockerfile.validator'

@Module({
  imports: [StorageModule],
  providers: [AgentPackageService, ManifestValidator, DockerfileValidator],
  exports: [AgentPackageService, ManifestValidator, DockerfileValidator],
})
export class AgentPackageModule {}
