import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { SaveChannelCredentialsDto } from './dto/save-channel-credentials.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('channels')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post('credentials')
  @Roles(UserRole.CLINIC_ADMIN, UserRole.SUPER_ADMIN)
  async saveCredentials(
    @CurrentUser() user: any,
    @Body() dto: SaveChannelCredentialsDto,
    @Query('clinicId') overrideClinicId?: string,
  ) {
    const targetClinicId =
      user.role === UserRole.SUPER_ADMIN && overrideClinicId
        ? overrideClinicId
        : user.clinicId;

    if (!targetClinicId) {
      throw new BadRequestException('Target clinicId must be specified');
    }

    return this.channelsService.saveCredentials(targetClinicId, dto);
  }

  @Get('credentials')
  async listCredentials(
    @CurrentUser() user: any,
    @Query('clinicId') overrideClinicId?: string,
  ) {
    const targetClinicId =
      user.role === UserRole.SUPER_ADMIN && overrideClinicId
        ? overrideClinicId
        : user.clinicId;

    if (!targetClinicId) {
      throw new BadRequestException('Target clinicId must be specified');
    }

    return this.channelsService.listCredentials(targetClinicId);
  }

  @Delete('credentials/:id')
  @Roles(UserRole.CLINIC_ADMIN, UserRole.SUPER_ADMIN)
  async deleteCredentials(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('clinicId') overrideClinicId?: string,
  ) {
    const targetClinicId =
      user.role === UserRole.SUPER_ADMIN && overrideClinicId
        ? overrideClinicId
        : user.clinicId;

    if (!targetClinicId) {
      throw new BadRequestException('Target clinicId must be specified');
    }

    return this.channelsService.deleteCredentials(targetClinicId, id);
  }
}
