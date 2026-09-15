import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { PlanType } from '@prisma/client';

export class CreateClinicDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  slug: string;

  @IsEnum(PlanType)
  @IsOptional()
  planType?: PlanType = PlanType.TRIAL;

  @IsInt()
  @Min(1)
  @IsOptional()
  trialDays?: number = 14;

  @IsString()
  @IsNotEmpty()
  adminName: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  @MinLength(8)
  @IsOptional()
  adminPassword?: string;
}
