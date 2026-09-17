import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class ClassifyMessageDto {
  @IsUUID()
  clinicId: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsString()
  @IsOptional()
  conversationId?: string;
}
