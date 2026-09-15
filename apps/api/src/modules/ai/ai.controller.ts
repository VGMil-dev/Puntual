import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ClassifyMessageDto } from './dto/classify-message.dto';
import { ClassifyPatientMessageUseCase } from './use-cases/classify-patient-message.use-case';

@Controller('ai')
export class AiController {
  constructor(
    private readonly classifyPatientMessageUseCase: ClassifyPatientMessageUseCase,
  ) {}

  @Post('classify-message')
  async classifyMessage(
    @Body() dto: ClassifyMessageDto,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.classifyPatientMessageUseCase.execute({
      clinicId: dto.clinicId,
      message: dto.message,
      traceId,
      conversationId: dto.conversationId,
    });
  }
}
