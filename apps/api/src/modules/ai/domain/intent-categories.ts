import { z } from 'zod';

export enum PatientIntent {
  AGENDAR_CITA = 'AGENDAR_CITA',
  CANCELAR_CITA = 'CANCELAR_CITA',
  CONSULTA_GENERAL = 'CONSULTA_GENERAL',
  OTRO = 'OTRO',
}

export enum ClosedConsultationReason {
  LIMPIEZA = 'LIMPIEZA',
  ORTODONCIA = 'ORTODONCIA',
  ENDODONCIA = 'ENDODONCIA',
  URGENCIA_DOLOR = 'URGENCIA_DOLOR',
  VALORACION_GENERAL = 'VALORACION_GENERAL',
  NO_DETERMINADO = 'NO_DETERMINADO',
}

export const ReasonToSpecialtyMapping: Record<ClosedConsultationReason, string[]> = {
  [ClosedConsultationReason.LIMPIEZA]: ['Limpieza', 'Odontología General', 'Periodoncia'],
  [ClosedConsultationReason.ORTODONCIA]: ['Ortodoncia'],
  [ClosedConsultationReason.ENDODONCIA]: ['Endodoncia'],
  [ClosedConsultationReason.URGENCIA_DOLOR]: ['Odontología General', 'Endodoncia', 'Cirugía'],
  [ClosedConsultationReason.VALORACION_GENERAL]: ['Odontología General', 'Valoración'],
  [ClosedConsultationReason.NO_DETERMINADO]: ['Odontología General'],
};

export const PatientMessageClassificationSchema = z.object({
  intent: z.nativeEnum(PatientIntent).describe('Intención principal del mensaje del paciente'),
  reason: z.nativeEnum(ClosedConsultationReason).describe('Categoría cerrada de motivo odontológico. CERO texto clínico libre.'),
  confidence: z.number().min(0).max(1).describe('Nivel de certeza de la clasificación entre 0.0 y 1.0'),
  clarificationNeeded: z.boolean().describe('True si el motivo es ambiguo o no determinado'),
  clarificationQuestion: z.string().optional().describe('Pregunta sugerida para orientar al paciente hacia las especialidades de la clínica'),
});

export type PatientMessageClassification = z.infer<typeof PatientMessageClassificationSchema>;
