import { Inject, Injectable } from '@nestjs/common';
import { AI_PORT, AiPort } from '../ports/ai.port';
import {
  PatientMessageClassification,
  PatientMessageClassificationSchema,
  ReasonToSpecialtyMapping,
  PatientIntent,
} from '../domain/intent-categories';
import { DoctorsService } from '../../doctors/doctors.service';
import { OperationalLogsService } from '../../../infrastructure/logging/operational-logs.service';
import { StructuredLoggerService } from '../../../infrastructure/logging/structured-logger.service';

export interface ClassifyPatientMessageInput {
  clinicId: string;
  message: string;
  traceId?: string;
  conversationId?: string;
}

export interface SuggestedDoctorDto {
  id: string;
  name: string;
  specialties: string[];
  slotDurationMinutes?: number | null;
}

export interface ClassifyPatientMessageOutput {
  intent: PatientIntent;
  reason: string;
  confidence: number;
  clarificationNeeded: boolean;
  clarificationQuestion?: string;
  suggestedDoctors: SuggestedDoctorDto[];
  execution: {
    provider: string;
    model: string;
    latencyMs: number;
    fallbackUsed: boolean;
  };
}

@Injectable()
export class ClassifyPatientMessageUseCase {
  constructor(
    @Inject(AI_PORT) private readonly aiPort: AiPort,
    private readonly doctorsService: DoctorsService,
    private readonly operationalLogsService: OperationalLogsService,
    private readonly logger: StructuredLoggerService,
  ) {}

  async execute(input: ClassifyPatientMessageInput): Promise<ClassifyPatientMessageOutput> {
    const systemPrompt = `Eres el asistente de triaje de agendamiento para una clínica odontológica en Ecuador.
Tu tarea es clasificar la intención del paciente y clasificar el motivo de consulta en una de las categorías CERRADAS permitidas:
- LIMPIEZA: limpieza dental, profilaxis, remoción de sarro.
- ORTODONCIA: frenillos, brackets, alineadores invisibles, control de ortodoncia.
- ENDODONCIA: tratamiento de conducto, matar el nervio, dolor dental profundo con antecedentes de conducto.
- URGENCIA_DOLOR: dolor agudo de muela, diente roto, absceso, inflamación severa, emergencia dental.
- VALORACION_GENERAL: chequeo general, primera consulta, revisión preventiva.
- NO_DETERMINADO: si el motivo no queda claro o el mensaje no tiene suficiente información.

REGLA DE PRIVACIDAD LOPDP: NO almacenes ni reproduzcas síntomas médicos en texto libre.
Si el motivo es ambiguo, marca clarificationNeeded = true y redacta una pregunta cordial orientando a las especialidades.`;

    const result = await this.aiPort.generateStructuredOutput<PatientMessageClassification>({
      systemPrompt,
      prompt: input.message,
      schema: PatientMessageClassificationSchema,
      clinicId: input.clinicId,
      traceId: input.traceId,
    });

    const classification = result.data;
    let suggestedDoctors: SuggestedDoctorDto[] = [];

    // If intent is AGENDAR_CITA, cross-reference with clinic specialties (RF-017)
    if (classification.intent === PatientIntent.AGENDAR_CITA) {
      const candidateSpecialtyNames = ReasonToSpecialtyMapping[classification.reason] || [];

      // Find doctors in the clinic matching any of candidate specialties
      const doctorsFound: any[] = [];
      for (const specName of candidateSpecialtyNames) {
        const matching = await this.doctorsService.findDoctorsBySpecialty(input.clinicId, specName);
        for (const doc of matching) {
          if (!doctorsFound.some((d) => d.id === doc.id)) {
            doctorsFound.push(doc);
          }
        }
      }

      suggestedDoctors = doctorsFound.map((doc) => ({
        id: doc.id,
        name: doc.name,
        specialties: doc.doctorSpecialties?.map((ds: any) => ds.specialty.name) || [],
        slotDurationMinutes: doc.slotDurationMinutes,
      }));
    }

    // Persist operational log without sensitive patient text
    await this.operationalLogsService.record({
      traceId: input.traceId,
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      level: 'info',
      category: 'ai',
      message: `Patient message classified: intent=${classification.intent}, reason=${classification.reason}`,
      metadata: {
        intent: classification.intent,
        reason: classification.reason,
        confidence: classification.confidence,
        clarificationNeeded: classification.clarificationNeeded,
        provider: result.metadata.provider,
        model: result.metadata.model,
        tokensUsed: result.metadata.tokensUsed,
        fallbackUsed: result.metadata.fallbackUsed,
        suggestedDoctorsCount: suggestedDoctors.length,
      },
      latencyMs: result.metadata.latencyMs,
    });

    return {
      intent: classification.intent,
      reason: classification.reason,
      confidence: classification.confidence,
      clarificationNeeded: classification.clarificationNeeded,
      clarificationQuestion: classification.clarificationQuestion,
      suggestedDoctors,
      execution: {
        provider: result.metadata.provider,
        model: result.metadata.model,
        latencyMs: result.metadata.latencyMs,
        fallbackUsed: result.metadata.fallbackUsed,
      },
    };
  }
}
