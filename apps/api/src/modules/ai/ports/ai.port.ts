import { z } from 'zod';

export const AI_PORT = Symbol('AI_PORT');

export interface AiStructuredOutputParams<T> {
  prompt: string;
  systemPrompt: string;
  schema: z.ZodType<T>;
  clinicId?: string;
  traceId?: string;
}

export interface AiExecutionResult<T> {
  data: T;
  metadata: {
    provider: string;
    model: string;
    tokensUsed?: number;
    latencyMs: number;
    fallbackUsed: boolean;
  };
}

export interface AiPort {
  /**
   * Generates a typed structured object conforming to the given Zod schema,
   * handling multi-provider resilience and fallback automatically (RNF-008).
   */
  generateStructuredOutput<T>(
    params: AiStructuredOutputParams<T>,
  ): Promise<AiExecutionResult<T>>;
}
