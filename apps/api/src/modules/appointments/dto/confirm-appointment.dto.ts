import { IsUUID, IsNotEmpty, IsString, IsOptional } from 'class-validator';

/**
 * DTO for confirming an appointment (CU-001 step 5, RF-010, RF-024, RNF-006, RNF-010, RNF-011).
 */
export class ConfirmAppointmentDto {
  @IsUUID()
  @IsNotEmpty()
  appointmentId: string;

  @IsUUID()
  @IsNotEmpty()
  clinicId: string;

  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}
