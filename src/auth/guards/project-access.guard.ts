import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';

@Injectable()
export class ProjectAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Get projectId from params
    const projectId = request.params.projectId;

    if (!projectId) {
      throw new BadRequestException('Project ID not found in request');
    }

    // Check if user has access to this project
    if (!user.projectIds || !user.projectIds.includes(projectId)) {
      throw new ForbiddenException('Access denied to this project');
    }

    return true;
  }
}
