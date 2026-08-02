import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { forBrowser, generateQuestions } from './generator';
import type { GeneratedQuestion } from './generator-schema';
import { masteryBand, nextDifficulty, type Band, type Difficulty } from './mastery';
import { getTopic } from './topics';
import {
  getMasteryState,
  getServedPrompts,
  persistGeneratedQuestions,
  recordAttempt,
  recordGenerationFailure,
  type AttemptContext,
} from './db/quiz-repo';

/**
 * The adaptive turn, end to end.
 *
 * mastery -> nextDifficulty -> avoid list -> generate -> validate -> persist
 * -> serve without the key; then grade server-side, append to `attempts`, and
 * refresh the mastery cache.
 *
 * The one invariant worth restating: the answer key never leaves the server.
 * `nextQuestion` returns a browser-safe shape by construction, and the key is
 * released only by `submitAnswer`, after the learner has committed.
 */

/** What the browser receives. No `answer`, no `rationale`. */
export interface ServedQuestion {
  itemId: string;
  topicId: string;
  prompt: string;
  options: string[];
  difficulty: Difficulty;
  generativeStrategy: string;
  /** True when generation failed twice and an anchor was substituted (§5.1). */
  fromAnchor: boolean;
}

export interface NextQuestionResult {
  question: ServedQuestion | null;
  mastery: { rating: number; attempts: number; masteryProb: number; band: Band };
  /** Difficulty asked for — `nextDifficulty` is the sole authority (§2). */
  targetDifficulty: Difficulty;
}

export async function nextQuestion(
  params: { learnerId: string; topicId: string; context?: AttemptContext },
  client?: SupabaseClient,
): Promise<NextQuestionResult> {
  getTopic(params.topicId); // throws early on an unknown topic
  const context = params.context ?? 'adaptive';

  const mastery = await getMasteryState(params.learnerId, params.topicId, client);
  const targetDifficulty = nextDifficulty(mastery.rating);
  const servedPrompts = await getServedPrompts(params.learnerId, params.topicId, undefined, client);

  const result = await generateQuestions({
    topicId: params.topicId,
    targetDifficulty,
    learnerMastery: masteryBand(mastery.masteryProb, mastery.attempts),
    count: 1,
    servedPrompts,
    context,
  });

  for (const failure of result.failures) {
    await recordGenerationFailure(
      {
        learnerId: params.learnerId,
        topicId: params.topicId,
        targetDifficulty,
        reason: failure.reason,
      },
      client,
    );
  }

  const question: GeneratedQuestion | undefined = result.questions[0];
  if (!question) {
    // Post context refuses the anchor fallback by design (§4) — the caller
    // scores out of however many valid items it managed to get.
    return { question: null, mastery, targetDifficulty };
  }

  const [persisted] = await persistGeneratedQuestions(
    {
      topicId: params.topicId,
      learnerId: params.learnerId,
      questions: [question],
      source: result.usedFallback ? 'anchor' : 'generated',
    },
    client,
  );

  if (!persisted) {
    return { question: null, mastery, targetDifficulty };
  }

  const safe = forBrowser(question);
  return {
    question: {
      itemId: persisted.id,
      topicId: params.topicId,
      prompt: safe.prompt,
      options: safe.options,
      difficulty: safe.difficulty,
      generativeStrategy: safe.generative_strategy,
      fromAnchor: result.usedFallback,
    },
    mastery,
    targetDifficulty,
  };
}

export interface SubmitAnswerResult {
  correct: boolean;
  /** The keyed option index, released only now. */
  answer: number;
  /** Released only after submission (§5.5). */
  rationale: string | null;
  mastery: { rating: number; attempts: number; masteryProb: number; band: Band };
  ratingBefore: number;
  ratingAfter: number;
  duplicate: boolean;
}

export async function submitAnswer(
  params: {
    learnerId: string;
    itemId: string;
    selected: number;
    context?: AttemptContext;
    sessionId?: string | null;
  },
  client?: SupabaseClient,
): Promise<SubmitAnswerResult> {
  const graded = await recordAttempt(
    {
      learnerId: params.learnerId,
      itemId: params.itemId,
      selected: params.selected,
      context: params.context ?? 'adaptive',
      sessionId: params.sessionId ?? null,
    },
    client,
  );

  return {
    correct: graded.correct,
    answer: graded.answer,
    rationale: graded.rationale,
    mastery: graded.state,
    ratingBefore: graded.ratingBefore,
    ratingAfter: graded.ratingAfter,
    duplicate: graded.duplicate,
  };
}
