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

// NOTA-ARQUITECTURA (TODO E2.2+):
// Actualmente este endpoint POST /ai/classify-message exige un JWT de staff (SUPER_ADMIN o CLINIC_ADMIN)
// vía JwtAuthGuard y RolesGuard como mitigación BOLA inmediata (RNF-001).
// Sin embargo, según el flujo de negocio real (CU-001, Documento Técnico §5 y Guía de Arquitectura §11),
// los mensajes de pacientes llegan mediante webhooks (WhatsApp/Telegram) y deben ser procesados
// internamente por el Channel Gateway hacia el caso de uso ClassifyPatientMessageUseCase, sin requerir
// un JWT de usuario humano interactivo.
// Cuando se integre dicho flujo en E2.2+, este endpoint o canal probablemente requiera una vía de invocación
// interna (llamada directa al caso de uso ClassifyPatientMessageUseCase dentro del mismo proceso, o un
// mecanismo de autenticación servicio-a-servicio) en vez de depender de un JWT de usuario humano.
// Decidir esto es responsabilidad de quien implemente esa integración en el planning de Sprint 3,
// citando Guía de Arquitectura §20 ("Use case primero; endpoint después").
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
