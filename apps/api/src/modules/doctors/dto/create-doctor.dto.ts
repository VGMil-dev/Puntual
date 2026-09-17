import {
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateDoctorDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  specialtyIds?: string[] = [];

  @IsInt()
  @Min(5)
  @IsOptional()
  slotDurationMinutes?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxConcurrentHolds?: number;
}
