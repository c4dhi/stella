import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { PrismaModule } from '../prisma/prisma.module'
import { StorageModule } from '../storage/storage.module'
import { AgentPackageModule } from '../agent-package/agent-package.module'
import { AgentBuildModule } from '../agent-build/agent-build.module'
import { AgentUploadController } from './agent-upload.controller'
import { AgentAdminController } from './agent-admin.controller'

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max file size
      },
    }),
    PrismaModule,
    StorageModule,
    AgentPackageModule,
    AgentBuildModule,
  ],
  controllers: [AgentUploadController, AgentAdminController],
})
export class AgentUploadModule {}
