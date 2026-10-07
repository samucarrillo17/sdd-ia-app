import { RolesGuard } from '../../src/common/guards/roles.guard';
import { Role } from '../../src/users/role.enum';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('RolesGuard', () => {
  let rolesGuard: RolesGuard;
  let reflector: Reflector;
  let mockExecutionContext: Partial<ExecutionContext>;

  beforeEach(() => {
    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);

    mockExecutionContext = {
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue({
          user: { id: '1', organizationId: 'org-1', role: Role.COORDINADOR },
        }),
      }),
      getHandler: vi.fn(),
      getClass: vi.fn(),
    };
  });

  it('should allow access when no roles are required', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const result = rolesGuard.canActivate(mockExecutionContext as ExecutionContext);
    expect(result).toBe(true);
  });

  it('should allow access when user has required role', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.COORDINADOR]);
    const result = rolesGuard.canActivate(mockExecutionContext as ExecutionContext);
    expect(result).toBe(true);
  });

  it('should allow access when user has one of multiple required roles', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.SOLICITANTE, Role.COORDINADOR]);
    const result = rolesGuard.canActivate(mockExecutionContext as ExecutionContext);
    expect(result).toBe(true);
  });

  it('should deny access when user lacks required role', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.BODEGA]);
    expect(() => rolesGuard.canActivate(mockExecutionContext as ExecutionContext)).toThrow();
  });

  it('should deny access when user is not authenticated', () => {
    const contextWithoutUser = {
      ...mockExecutionContext,
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue({}),
      }),
    };

    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.COORDINADOR]);
    expect(() => rolesGuard.canActivate(contextWithoutUser as ExecutionContext)).toThrow();
  });
});