import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class SystemAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Check if this is a participant token (not allowed for admin access)
    if (user.type === 'participant') {
      throw new ForbiddenException('Participants cannot access admin features');
    }

    // Check if user is a system admin
    if (!user.isSystemAdmin) {
      throw new ForbiddenException('System administrator access required');
    }

    return true;
  }
}
