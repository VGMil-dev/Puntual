import {
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateDoctorDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  specialtyIds?: string[];

  @IsInt()
  @Min(5)
  @IsOptional()
  slotDurationMinutes?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxConcurrentHolds?: number;
}
