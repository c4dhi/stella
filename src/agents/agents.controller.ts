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
} from '@nestjs/common';
import { Observable, interval } from 'rxjs';
import { map } from 'rxjs/operators';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';

interface MessageEvent {
  data: string;
  id?: string;
  type?: string;
  retry?: number;
}

@Controller()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post('sessions/:sessionId/agents')
  create(
    @Param('sessionId') sessionId: string,
    @Body() createAgentDto: CreateAgentDto,
  ) {
    return this.agentsService.create(sessionId, createAgentDto);
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
          // Handle errors
          observer.error(error);
        }
      ).then((cleanupFn) => {
        cleanup = cleanupFn;
      }).catch((error) => {
        observer.error(error);
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
