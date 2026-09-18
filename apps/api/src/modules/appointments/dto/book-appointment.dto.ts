import {
  IsUUID,
  IsNotEmpty,
  IsISO8601,
  IsOptional,
  IsInt,
  IsString,
  Min,
} from 'class-validator';

/**
 * DTO for booking an appointment with atomic hold (Ticket E2.2b-bis / CU-001 step 4 / RF-025 / RF-029 / RNF-001 / RNF-011).
 */
export class BookAppointmentDto {
  @IsUUID()
  @IsNotEmpty()
  clinicId: string;

  @IsUUID()
  @IsNotEmpty()
  doctorId: string;

  @IsUUID()
  @IsNotEmpty()
  patientId: string;

  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @IsISO8601()
  @IsNotEmpty()
  startAt: string;

  @IsOptional()
  @IsUUID()
  specialtyId?: string;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  ttlSeconds?: number;

  @IsOptional()
  @IsString()
  traceId?: string;
}
