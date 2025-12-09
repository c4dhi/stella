import { Module } from '@nestjs/common';
import { EnvVarTemplatesController } from './env-var-templates.controller';
import { EnvVarTemplatesService } from './env-var-templates.service';
import { EncryptionService } from './encryption.service';

@Module({
  controllers: [EnvVarTemplatesController],
  providers: [EnvVarTemplatesService, EncryptionService],
  exports: [EnvVarTemplatesService, EncryptionService],
})
export class EnvVarTemplatesModule {}
