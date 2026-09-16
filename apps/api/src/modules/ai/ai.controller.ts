import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ClassifyMessageDto } from './dto/classify-message.dto';
import { ClassifyPatientMessageUseCase } from './use-cases/classify-patient-message.use-case';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(
    private readonly classifyPatientMessageUseCase: ClassifyPatientMessageUseCase,
  ) {}

  @Post('classify-message')
  @Roles(UserRole.SUPER_ADMIN, UserRole.CLINIC_ADMIN)
  async classifyMessage(
    @Body() dto: ClassifyMessageDto,
    @CurrentUser() user: any,
    @Headers('x-trace-id') traceId?: string,
  ) {
    if (user.role === UserRole.CLINIC_ADMIN && user.clinicId !== dto.clinicId) {
      throw new ForbiddenException('Cannot classify messages for another clinic');
    }

    const effectiveClinicId = user.role === UserRole.CLINIC_ADMIN ? user.clinicId : dto.clinicId;

    return this.classifyPatientMessageUseCase.execute({
      clinicId: effectiveClinicId,
      message: dto.message,
      traceId,
      conversationId: dto.conversationId,
    });
  }
}
