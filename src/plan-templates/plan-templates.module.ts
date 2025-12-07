import { Module } from '@nestjs/common';
import { PlanTemplatesService } from './plan-templates.service';
import { PlanTemplatesController } from './plan-templates.controller';

@Module({
  controllers: [PlanTemplatesController],
  providers: [PlanTemplatesService],
  exports: [PlanTemplatesService],
})
export class PlanTemplatesModule {}
