import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * DTO for querying doctor availability slots (CU-001 step 3, RF-029, RF-025, RNF-010).
 */
export class GetAvailabilityDto {
  @IsUUID('4', { message: 'clinicId must be a valid UUID' })
  @IsNotEmpty()
  clinicId: string;

  @IsUUID('4', { message: 'doctorId must be a valid UUID' })
  @IsNotEmpty()
  doctorId: string;

  @IsString()
  @IsNotEmpty()
  startDate: string;

  @IsString()
  @IsNotEmpty()
  endDate: string;

  @IsString()
  @IsOptional()
  specialtyId?: string;

  @IsString()
  @IsOptional()
  motivo?: string;

  @IsString()
  @IsOptional()
  conversationId?: string;
}
