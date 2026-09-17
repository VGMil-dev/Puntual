import { IsUUID, IsNotEmpty, IsISO8601, IsOptional, IsInt, Min } from 'class-validator';

/**
 * DTO for acquiring a temporary atomic slot hold (CU-001 step 4, RF-025, RNF-010).
 */
export class AcquireHoldDto {
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
  @IsInt()
  @Min(1)
  ttlSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxConcurrentHolds?: number;

  @IsOptional()
  traceId?: string;

  @IsOptional()
  appointmentId?: string;
}
