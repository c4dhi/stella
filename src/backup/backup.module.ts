import { Module } from '@nestjs/common'
import { EnvVarTemplatesModule } from '../env-var-templates/env-var-templates.module'
import { BackupController } from './backup.controller'
import { BackupService } from './backup.service'

/**
 * Full-system data export/import (#378).
 *
 * PrismaService, StorageService and ConfigService are all global; this module
 * only needs EnvVarTemplatesModule for the EncryptionService key fingerprint.
 */
@Module({
  imports: [EnvVarTemplatesModule],
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
