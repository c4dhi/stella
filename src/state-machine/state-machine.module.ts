import { Module } from '@nestjs/common';
import { StateMachineService } from './state-machine.service';
import { StateMachineGrpcController } from './state-machine-grpc.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StateMachineGrpcController],
  providers: [StateMachineService],
  exports: [StateMachineService],
})
export class StateMachineModule {}
