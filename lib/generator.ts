/**
 * Question generation — the one Anthropic call site in Phase 1.
 *
 * Server-only. The API key must never reach a client bundle, and neither must
 * `answer` or `rationale` (quiz-generation-prompt.md §5.5) — strip them with
 * `forBrowser()` before returning anything to a page.
 *
 * Implements the §5.1 retry/fallback policy, with one deliberate divergence in
 * the post-assessment context; see FallbackPolicy below.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import type { Difficulty, Band } from './mastery';
import { GenerationResponseSchema, type GeneratedQuestion } from './generator-schema';
import { SYSTEM_PROMPT } from './quiz-generation-prompt';
import { anchorQuestions, topicForPrompt } from './topics';
import { buildAvoidList, validateQuestions, type RejectedQuestion } from './validate-questions';

/**
 * `README.md` and `quiz-generation-prompt.md` both name "claude-sonnet", which
 * is not a callable id; the current Sonnet is `claude-sonnet-5`. Swap to
 * `claude-opus-5` here if the cohort needs the stronger model — nothing else
 * changes.
 */
export const GENERATION_MODEL = 'claude-sonnet-5';

/**
 * Thinking depth. The derive-answer-first protocol (§1 rule 3) is reasoning
 * work, so this is not a knob to bottom out; `medium` is the starting point and
 * the API default is `high`.
 */
export const GENERATION_EFFORT = 'medium';

export const MAX_TOKENS = 8000;

/**
 * NOTE: `quiz-generation-prompt.md` specifies "temperature ~0.7 (variety)".
 * `temperature` is rejected with a 400 on every current model, so it is not set
 * here. Variety comes from the `avoid` list (§2) and the Variety section added
 * to the system prompt instead. See the Phase-1 notes.
 */

export type GenerationContext = 'baseline' | 'adaptive' | 'post';

export interface GenerateOptions {
  topicId: string;
  targetDifficulty: Difficulty;
  /** Displayed band, passed through as `learner_mastery` per the §2 contract. */
  learnerMastery: Band;
  count?: number;
  /** Prompts this learner has already been served, oldest first. */
  servedPrompts?: readonly string[];
  context?: GenerationContext;
  client?: Anthropic;
}

export interface GenerationFailure {
  reason: string;
  raw?: string;
}

export interface GenerateResult {
  questions: GeneratedQuestion[];
  /** True when questions came from the anchor pool rather than the model. */
  usedFallback: boolean;
  attempts: number;
  rejected: RejectedQuestion[];
  failures: GenerationFailure[];
}

let defaultClient: Anthropic | undefined;

function getClient(): Anthropic {
  // Zero-arg constructor: resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or
  // an `ant auth login` profile, in that order.
  defaultClient ??= new Anthropic();
  return defaultClient;
}

/** The §2 user-message contract, as sent. */
export function buildUserMessage(options: GenerateOptions, avoid: readonly string[]): string {
  return JSON.stringify(
    {
      topic: topicForPrompt(options.topicId),
      target_difficulty: options.targetDifficulty,
      count: options.count ?? 1,
      learner_mastery: options.learnerMastery,
      avoid,
    },
    null,
    2,
  );
}

/** Strip the answer key before anything crosses the network to a browser (§5.5). */
export function forBrowser(question: GeneratedQuestion): Omit<GeneratedQuestion, 'answer' | 'rationale'> {
  const { answer: _answer, rationale: _rationale, ...safe } = question;
  return safe;
}

/**
 * One generation attempt. Returns validated questions, or throws with a reason
 * the caller records in `generation_failures`.
 */
async function attemptGeneration(
  options: GenerateOptions,
  avoid: readonly string[],
  client: Anthropic,
): Promise<{ questions: GeneratedQuestion[]; rejected: RejectedQuestion[] }> {
  const response = await client.messages.parse({
    model: GENERATION_MODEL,
    max_tokens: MAX_TOKENS,
    output_config: {
      effort: GENERATION_EFFORT,
      format: zodOutputFormat(GenerationResponseSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(options, avoid) }],
  });

  // Structured outputs do not survive a safety refusal — the schema is not
  // applied to a refused response.
  if (response.stop_reason === 'refusal') {
    throw new Error(`model refused: ${response.stop_details?.category ?? 'unspecified'}`);
  }

  // A truncated response can still parse into a valid-looking partial batch.
  if (response.stop_reason === 'max_tokens') {
    throw new Error('response truncated at max_tokens');
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error('structured output missing or failed schema validation');
  }

  // §5.1: treat a false flag exactly like a parse failure. We never trust a
  // true flag on its own either — validation runs regardless.
  if (parsed.verification_passed !== true) {
    throw new Error('verification_passed was not true');
  }

  // `topic_id` is an envelope field (§1 Output), so it is checked once here
  // rather than per question. A mismatch means the batch is grounded in the
  // wrong anchor and every question in it is suspect.
  if (parsed.topic_id !== options.topicId) {
    throw new Error(
      `topic_id ${parsed.topic_id} does not match requested ${options.topicId}`,
    );
  }

  const { accepted, rejected } = validateQuestions(parsed.questions, {
    targetDifficulty: options.targetDifficulty,
    avoid,
  });

  if (accepted.length === 0) {
    const detail = rejected.flatMap((r) => r.reasons).join('; ');
    throw new Error(`all questions failed validation: ${detail || 'no questions returned'}`);
  }

  return { questions: accepted, rejected };
}

/**
 * Generate questions, retrying once and then falling back per §5.1.
 *
 * Fallback policy by context:
 *   baseline / adaptive — serve an unseen anchor question, so a learner is
 *                         never blocked (§5.1).
 *   post               — NO anchor fallback. §4's guard forbids a post item
 *                         that repeats a pre item, and the pre form is the
 *                         anchors. Return fewer questions and let the caller
 *                         score out of `item_count`.
 */
export async function generateQuestions(options: GenerateOptions): Promise<GenerateResult> {
  const client = options.client ?? getClient();
  const context = options.context ?? 'adaptive';
  const anchors = anchorQuestions(options.topicId);
  const avoid = buildAvoidList(
    anchors.map((q) => q.prompt),
    options.servedPrompts ?? [],
  );

  const failures: GenerationFailure[] = [];
  let rejected: RejectedQuestion[] = [];

  // Initial attempt plus exactly one retry with the same inputs (§5.1).
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await attemptGeneration(options, avoid, client);
      return {
        questions: result.questions,
        usedFallback: false,
        attempts: attempt,
        rejected: [...rejected, ...result.rejected],
        failures,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ reason });
      if (error && typeof error === 'object' && 'rejected' in error) {
        rejected = [...rejected, ...(error.rejected as RejectedQuestion[])];
      }
    }
  }

  if (context === 'post') {
    // Scoring out of fewer valid items keeps the proportion honest; falling
    // back to an anchor here would silently confound the learning-gain metric.
    return { questions: [], usedFallback: false, attempts: 2, rejected, failures };
  }

  const servedNormalised = new Set((options.servedPrompts ?? []).map((p) => p.trim()));
  const unseenAnchor = anchors.find(
    (q) => q.difficulty === options.targetDifficulty && !servedNormalised.has(q.prompt.trim()),
  ) ?? anchors.find((q) => !servedNormalised.has(q.prompt.trim()));

  if (!unseenAnchor) {
    return { questions: [], usedFallback: false, attempts: 2, rejected, failures };
  }

  return {
    questions: [
      {
        id: unseenAnchor.id,
        type: 'mcq',
        difficulty: unseenAnchor.difficulty,
        generative_strategy: unseenAnchor.generative_strategy,
        prompt: unseenAnchor.prompt,
        options: unseenAnchor.options,
        answer: unseenAnchor.answer,
        rationale: unseenAnchor.rationale,
      },
    ],
    usedFallback: true,
    attempts: 2,
    rejected,
    failures,
  };
}
