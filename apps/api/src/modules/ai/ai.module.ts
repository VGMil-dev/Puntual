import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { VercelAiAdapter } from './adapters/vercel-ai.adapter';
import { AI_PORT } from './ports/ai.port';
import { ClassifyPatientMessageUseCase } from './use-cases/classify-patient-message.use-case';
import { DoctorsModule } from '../doctors/doctors.module';
import { InfisicalModule } from '../../integrations/secrets/infisical/infisical.module';

@Module({
  imports: [DoctorsModule, InfisicalModule],
  controllers: [AiController],
  providers: [
    VercelAiAdapter,
    {
      provide: AI_PORT,
      useExisting: VercelAiAdapter,
    },
    ClassifyPatientMessageUseCase,
  ],
  exports: [AI_PORT, ClassifyPatientMessageUseCase],
})
export class AiModule {}
