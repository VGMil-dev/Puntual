import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateSpecialtyDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(5)
  @IsOptional()
  defaultSlotDurationMinutes?: number = 30;
}
