import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StructuredLoggerService } from '../../infrastructure/logging/structured-logger.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CreateClinicAdminDto } from './dto/create-clinic-admin.dto';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly saltRounds = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly logger: StructuredLoggerService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async validateUser(email: string, pass: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      return null;
    }

    const isMatch = await bcrypt.compare(pass, user.passwordHash);
    if (!isMatch) {
      return null;
    }

    const { passwordHash, ...result } = user;
    return result;
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.email, dto.password);
    if (!user) {
      this.logger.warn(`Failed login attempt for email: ${dto.email}`, 'AuthService');
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      clinicId: user.clinicId,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });

    // Generate random refresh token
    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    this.logger.log(`User logged in successfully: ${user.id}`, 'AuthService', {
      userId: user.id,
      clinicId: user.clinicId,
      role: user.role,
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 900, // 15 minutes in seconds
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        clinicId: user.clinicId,
      },
    };
  }

  async refreshToken(dto: RefreshTokenDto) {
    const tokenHash = this.hashToken(dto.refreshToken);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken) {
      this.logger.warn('Refresh token not found in database', 'AuthService');
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.revokedAt) {
      this.logger.warn(
        `Replay attack detected: refresh token already revoked for user ${storedToken.userId}`,
        'AuthService',
      );
      // Revoke all tokens for this user as a safeguard against token theft
      await this.prisma.refreshToken.updateMany({
        where: { userId: storedToken.userId },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Revoked refresh token reused');
    }

    if (storedToken.expiresAt < new Date()) {
      this.logger.warn(`Expired refresh token presented for user ${storedToken.userId}`, 'AuthService');
      throw new UnauthorizedException('Expired refresh token');
    }

    // Atomic rotation: revoke old token
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    // Issue new tokens
    const user = storedToken.user;
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      clinicId: user.clinicId,
    };

    const newAccessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    const newRawRefreshToken = crypto.randomBytes(40).toString('hex');
    const newTokenHash = this.hashToken(newRawRefreshToken);
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newTokenHash,
        expiresAt: newExpiresAt,
      },
    });

    this.logger.log(`Refresh token rotated for user: ${user.id}`, 'AuthService', {
      userId: user.id,
      clinicId: user.clinicId,
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
      expiresIn: 900,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetHash = this.hashToken(resetToken);
      const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetTokenHash: resetHash,
          passwordResetExpiresAt: expiresAt,
        },
      });

      this.logger.log(
        `Password reset token generated for user ${user.id}`,
        'AuthService',
        { userId: user.id, clinicId: user.clinicId },
      );

      // In production, dispatch email here. In dev/test return preview token in debug mode if needed
      return {
        message: 'If the email exists, a password reset link has been dispatched',
        resetToken: process.env.NODE_ENV !== 'production' ? resetToken : undefined,
      };
    }

    return {
      message: 'If the email exists, a password reset link has been dispatched',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const resetHash = this.hashToken(dto.token);

    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetTokenHash: resetHash,
        passwordResetExpiresAt: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, this.saltRounds);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    });

    // Revoke all active refresh tokens on password change
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`Password reset completed for user ${user.id}`, 'AuthService', {
      userId: user.id,
      clinicId: user.clinicId,
    });

    return {
      message: 'Password has been successfully updated',
    };
  }

  async createClinicAdmin(
    dto: CreateClinicAdminDto,
    tx?: import('@prisma/client').Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    const existing = await client.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (existing) {
      throw new BadRequestException(`A user with email ${dto.email} already exists`);
    }

    const plainPassword = dto.password || crypto.randomBytes(8).toString('hex') + 'Aa1!';
    const passwordHash = await bcrypt.hash(plainPassword, this.saltRounds);

    const user = await client.user.create({
      data: {
        clinicId: dto.clinicId,
        email: dto.email.toLowerCase().trim(),
        name: dto.name,
        passwordHash,
        role: UserRole.CLINIC_ADMIN,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        clinicId: true,
        createdAt: true,
      },
    });

    this.logger.log(`Clinic Admin created: ${user.id} for clinic: ${dto.clinicId}`, 'AuthService', {
      userId: user.id,
      clinicId: dto.clinicId,
    });

    return {
      user,
      initialPassword: dto.password ? undefined : plainPassword,
    };
  }
}
