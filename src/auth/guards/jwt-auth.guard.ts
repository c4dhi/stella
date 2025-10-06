import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // For SSE requests, extract token from query parameter if available
    const request = context.switchToHttp().getRequest();
    if (request.query?.token && !request.headers.authorization) {
      // Move query param token to Authorization header for passport to validate
      request.headers.authorization = `Bearer ${request.query.token}`;
    }

    return super.canActivate(context);
  }
}
