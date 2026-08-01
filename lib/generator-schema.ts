/**
 * The generator's output schema, as a Zod schema for structured outputs.
 *
 * This replaces `quiz-generation-prompt.md` §1's "Return ONLY a JSON object —
 * no prose, no markdown code fences" with an API-level guarantee: the response
 * is constrained to this shape rather than asked to conform to it, so there is
 * no fenced-JSON stripping and no parse step to fail. The field names, types
 * and enums are exactly the ones in §1's Output block.
 *
 * Structured-output schemas cannot express numeric or length constraints — the
 * SDK strips those before sending and validates them client-side. So `.min()` /
 * `.max()` here are real, but they are enforced by Zod on the way back rather
 * than by the model. Anything genuinely load-bearing is re-checked in
 * validate-questions.ts.
 */

import { z } from 'zod';

export const DIFFICULTY = z.enum(['easy', 'medium', 'hard']);
export const GENERATIVE_STRATEGY = z.enum(['self_test', 'self_explain', 'elaborate', 'apply']);

export const GeneratedQuestionSchema = z.object({
  id: z.string(),
  type: z.literal('mcq'),
  difficulty: DIFFICULTY,
  generative_strategy: GENERATIVE_STRATEGY,
  prompt: z.string(),
  options: z.array(z.string()),
  /** 0-based index into `options`. */
  answer: z.number().int(),
  rationale: z.string(),
});

export const GenerationResponseSchema = z.object({
  topic_id: z.string(),
  verification_passed: z.boolean(),
  questions: z.array(GeneratedQuestionSchema),
});

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;
export type GenerationResponse = z.infer<typeof GenerationResponseSchema>;
