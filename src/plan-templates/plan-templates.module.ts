import { Module } from '@nestjs/common';
import { PlanTemplatesService } from './plan-templates.service';
import { PlanTemplatesController } from './plan-templates.controller';
import { PlanGeneratorService } from './plan-generator.service';

@Module({
  controllers: [PlanTemplatesController],
  providers: [PlanTemplatesService, PlanGeneratorService],
  exports: [PlanTemplatesService],
})
export class PlanTemplatesModule {}
