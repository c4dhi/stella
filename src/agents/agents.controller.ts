import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Sse,
  ValidationPipe,
  UsePipes,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Observable, interval } from 'rxjs';
import { map } from 'rxjs/operators';
import { AgentsService } from './agents.service';
import { AgentImageService } from '../agent-image/agent-image.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

interface MessageEvent {
  data: string;
  id?: string;
  type?: string;
  retry?: number;
}

@Controller()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly agentImageService: AgentImageService,
  ) {}

  @Get('agent-types')
  async getAgentTypes() {
    return this.agentImageService.getAgentTypesWithInfo();
  }

  @Post('sessions/:sessionId/agents')
  create(
    @Param('sessionId') sessionId: string,
    @Body() createAgentDto: CreateAgentDto,
    @CurrentUser() user: any,
  ) {
    return this.agentsService.create(sessionId, createAgentDto, user.userId);
  }

  @Get('agents/:agentId')
  findOne(@Param('agentId') id: string) {
    return this.agentsService.findOne(id);
  }

  @Get('agents/:agentId/logs')
  getLogs(@Param('agentId') id: string) {
    return this.agentsService.getLogs(id);
  }

  @Sse('agents/:agentId/logs/stream')
  streamLogs(@Param('agentId') id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((observer) => {
      let cleanup: (() => void) | null = null;

      // Start streaming logs
      this.agentsService.streamLogs(
        id,
        (logs) => {
          // Send logs to client
          observer.next({
            data: logs,
          });
        },
        (error) => {
          // Handle errors with user-friendly messages
          let errorMessage = 'Failed to stream logs';

          if (error.message?.includes('not found') || error.message?.includes('Pod not found')) {
            errorMessage = 'Agent pod not found. The agent may have been stopped or failed to start.';
          } else if (error.message?.includes('Timeout')) {
            errorMessage = 'Timeout waiting for agent pod to be created.';
          } else if (error.message) {
            errorMessage = error.message;
          }

          // Send error message as log data before closing
          observer.next({
            data: `\n[Error] ${errorMessage}\n`,
          });

          // Close the stream gracefully
          observer.complete();
        }
      ).then((cleanupFn) => {
        cleanup = cleanupFn;
      }).catch((error) => {
        // Handle initialization errors
        let errorMessage = 'Failed to start log stream';

        if (error instanceof NotFoundException) {
          errorMessage = 'Agent not found.';
        } else if (error instanceof BadRequestException) {
          errorMessage = error.message;
        } else if (error.message) {
          errorMessage = error.message;
        }

        observer.next({
          data: `\n[Error] ${errorMessage}\n`,
        });
        observer.complete();
      });

      // Cleanup when client disconnects
      return () => {
        if (cleanup) {
          cleanup();
        }
      };
    });
  }

  @Delete('agents/:agentId')
  remove(@Param('agentId') id: string) {
    return this.agentsService.remove(id);
  }

  @Delete('agents/:agentId/permanent')
  permanentDelete(@Param('agentId') id: string) {
    return this.agentsService.delete(id);
  }

  @Post('agents/:agentId/restart')
  restart(@Param('agentId') id: string) {
    return this.agentsService.restart(id);
  }
}
