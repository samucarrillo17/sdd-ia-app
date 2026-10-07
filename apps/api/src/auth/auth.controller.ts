import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Ip,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { SessionAuthGuard } from '../common/guards/session-auth.guard.js';
import type { AuthenticatedUser } from '../common/guards/session-auth.guard.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
  ) {}

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión' })
  @ApiResponse({ status: 200, description: 'Login exitoso' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  @ApiResponse({ status: 429, description: 'Demasiados intentos' })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
  ) {
    const { user, token } = await this.authService.login(loginDto, ip);

    const maxAge = this.sessionService.getTtlMs();

    res.cookie('sid', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge,
    });

    return { user };
  }

  @Post('logout')
  @UseGuards(SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cerrar sesión' })
  @ApiResponse({ status: 200, description: 'Logout exitoso' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const sessionId = req.cookies?.sid;
    if (sessionId) {
      await this.authService.logout(sessionId, {
        id: user.id,
        email: '',
        fullName: '',
        role: user.role,
        organization: { id: user.organizationId, code: '', name: '' },
      });
    }

    res.clearCookie('sid', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    return { message: 'Sesión cerrada correctamente' };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener usuario actual' })
  @ApiResponse({ status: 200, description: 'Usuario actual' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    const fullUser = await this.authService.getMe(user.id);
    return fullUser;
  }
}