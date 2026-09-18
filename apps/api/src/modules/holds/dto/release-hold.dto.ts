import { IsUUID, IsNotEmpty, IsISO8601, IsOptional } from 'class-validator';

/**
 * DTO for releasing an atomic slot hold (CU-001 Alt Flow B/C, RF-025, RNF-010).
 */
export class ReleaseHoldDto {
  @IsUUID()
  @IsNotEmpty()
  clinicId: string;

  @IsUUID()
  @IsNotEmpty()
  doctorId: string;

  @IsISO8601()
  @IsNotEmpty()
  startAt: string;

  @IsNotEmpty()
  conversationId: string;

  @IsOptional()
  traceId?: string;

  @IsOptional()
  appointmentId?: string;
}
