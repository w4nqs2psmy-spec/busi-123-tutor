import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  applyAttempt,
  deriveState,
  initialMastery,
  type Difficulty,
  type MasteryState,
} from '../mastery';
import type { GeneratedQuestion } from '../generator-schema';
import { serviceRoleClient } from '../supabase/server';
import { AVOID_LIMIT } from '../validate-questions';

/**
 * Every database call in the quiz loop.
 *
 * All of it runs through the service-role client, and that is deliberate:
 * learners hold no INSERT or UPDATE anywhere (a learner who could write
 * `attempts` could fabricate their own mastery), and `items` / `item_keys`
 * have RLS enabled with no policy at all, so nothing else can read them.
 *
 * Nothing here returns an answer key to a caller that might forward it — use
 * `forBrowser()` from generator.ts before anything reaches a page.
 */

export type AttemptContext = 'baseline' | 'adaptive' | 'post';

export interface PersistedItem {
  /** Database uuid — the real identity. The model's id is only `source_ref`. */
  id: string;
  topicId: string;
  difficulty: Difficulty;
  question: GeneratedQuestion;
}

export interface GradedAttempt {
  correct: boolean;
  /** Released only after submission (quiz-generation-prompt.md §5.5). */
  rationale: string | null;
  answer: number;
  state: MasteryState;
  ratingBefore: number;
  ratingAfter: number;
  /** True when this exact (learner, item) pair was already recorded. */
  duplicate: boolean;
}

function db(client?: SupabaseClient): SupabaseClient {
  return client ?? serviceRoleClient();
}

/**
 * Write accepted questions to `items` + `item_keys`.
 *
 * The model's `id` (e.g. "market-research-gen-1") is stored as `source_ref`
 * only — it collides by construction across calls, so the uuid primary key is
 * the identity. Keys go in a separate table with no RLS policy.
 */
export async function persistGeneratedQuestions(
  params: {
    topicId: string;
    learnerId: string;
    questions: readonly GeneratedQuestion[];
    source?: 'generated' | 'anchor';
  },
  client?: SupabaseClient,
): Promise<PersistedItem[]> {
  const sb = db(client);
  if (params.questions.length === 0) return [];

  const rows = params.questions.map((q) => ({
    topic_id: params.topicId,
    source: params.source ?? 'generated',
    source_ref: q.id,
    type: 'mcq' as const,
    difficulty: q.difficulty,
    generative_strategy: q.generative_strategy,
    prompt: q.prompt,
    options: q.options,
    created_for: params.learnerId,
    verification_passed: true,
  }));

  const { data: inserted, error } = await sb.from('items').insert(rows).select('id, difficulty');
  if (error) throw new Error(`failed to persist items: ${error.message}`);
  if (!inserted || inserted.length !== params.questions.length) {
    throw new Error(
      `expected ${params.questions.length} inserted items, got ${inserted?.length ?? 0}`,
    );
  }

  const keys = inserted.map((row, i) => ({
    item_id: row['id'] as string,
    answer: params.questions[i]!.answer,
    rationale: params.questions[i]!.rationale,
  }));

  const { error: keyError } = await sb.from('item_keys').insert(keys);
  if (keyError) {
    // An item without a key is ungradeable, so do not leave one behind.
    await sb
      .from('items')
      .delete()
      .in('id', inserted.map((r) => r['id'] as string));
    throw new Error(`failed to persist item keys: ${keyError.message}`);
  }

  return inserted.map((row, i) => ({
    id: row['id'] as string,
    topicId: params.topicId,
    difficulty: row['difficulty'] as Difficulty,
    question: params.questions[i]!,
  }));
}

/** Current mastery for a (learner, topic), or the 1500 prior if none yet. */
export async function getMasteryState(
  learnerId: string,
  topicId: string,
  client?: SupabaseClient,
): Promise<MasteryState> {
  const { data, error } = await db(client)
    .from('learner_topic_mastery')
    .select('rating, attempts')
    .eq('learner_id', learnerId)
    .eq('topic_id', topicId)
    .maybeSingle();

  if (error) throw new Error(`failed to read mastery: ${error.message}`);
  if (!data) return initialMastery();

  return deriveState(data['rating'] as number, data['attempts'] as number);
}

/**
 * Prompts this learner has already been served in this topic, newest first.
 *
 * Feeds the `avoid` list. Capped in SQL rather than in memory, so the query
 * cost stays flat as a learner's history grows.
 */
export async function getServedPrompts(
  learnerId: string,
  topicId: string,
  limit = AVOID_LIMIT,
  client?: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await db(client)
    .from('attempts')
    .select('created_at, items(prompt)')
    .eq('learner_id', learnerId)
    .eq('topic_id', topicId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`failed to read served prompts: ${error.message}`);

  return (data ?? [])
    .map((row) => {
      const item = row['items'] as { prompt?: string } | { prompt?: string }[] | null;
      if (Array.isArray(item)) return item[0]?.prompt;
      return item?.prompt;
    })
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
}

interface ItemForGrading {
  itemId: string;
  topicId: string;
  difficulty: Difficulty;
  answer: number;
  rationale: string;
  optionCount: number;
}

/** Load an item together with its key. Service-role only — never forward this. */
export async function loadItemForGrading(
  itemId: string,
  client?: SupabaseClient,
): Promise<ItemForGrading> {
  const { data, error } = await db(client)
    .from('items')
    .select('id, topic_id, difficulty, options, item_keys(answer, rationale)')
    .eq('id', itemId)
    .maybeSingle();

  if (error) throw new Error(`failed to load item: ${error.message}`);
  if (!data) throw new Error(`unknown item: ${itemId}`);

  const rawKey = data['item_keys'] as
    | { answer: number; rationale: string }
    | { answer: number; rationale: string }[]
    | null;
  const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  if (!key || typeof key.answer !== 'number') {
    throw new Error(`item ${itemId} has no answer key — it must not be served`);
  }

  return {
    itemId: data['id'] as string,
    topicId: data['topic_id'] as string,
    difficulty: data['difficulty'] as Difficulty,
    answer: key.answer,
    rationale: key.rationale,
    optionCount: (data['options'] as unknown[] | null)?.length ?? 0,
  };
}

/**
 * Grade one answer, append to `attempts`, and refresh the mastery cache.
 *
 * Ordering is load-bearing. The `attempts` row goes first, because its
 * `(learner_id, item_id)` unique constraint is the idempotency guard: a
 * double submit hits the constraint and returns before mastery is touched.
 *
 * This is not atomic. If the mastery upsert fails after the attempt lands, the
 * cache is stale but recoverable — `rating_before` / `rating_after` make the
 * whole chain replayable from `attempts` alone. Moving both writes into a
 * Postgres function would close the gap and is the right Phase 2 change.
 */
export async function recordAttempt(
  params: {
    learnerId: string;
    itemId: string;
    selected: number;
    context: AttemptContext;
    sessionId?: string | null;
  },
  client?: SupabaseClient,
): Promise<GradedAttempt> {
  const sb = db(client);
  const item = await loadItemForGrading(params.itemId, sb);

  if (
    !Number.isInteger(params.selected) ||
    params.selected < 0 ||
    (item.optionCount > 0 && params.selected >= item.optionCount)
  ) {
    throw new Error(`selected index ${params.selected} out of range`);
  }

  const correct = params.selected === item.answer;
  const before = await getMasteryState(params.learnerId, item.topicId, sb);
  const applied = applyAttempt(before, { difficulty: item.difficulty, outcome: correct });

  const { error: attemptError } = await sb.from('attempts').insert({
    learner_id: params.learnerId,
    topic_id: item.topicId,
    item_id: item.itemId,
    session_id: params.sessionId ?? null,
    context: params.context,
    difficulty: item.difficulty,
    response: { selected: params.selected },
    correct,
    score: correct ? 1 : 0,
    rating_before: applied.ratingBefore,
    rating_after: applied.ratingAfter,
  });

  if (attemptError) {
    // 23505 = unique_violation on attempts_one_per_item. Already graded, so
    // report the outcome without applying the Elo update a second time.
    if (attemptError.code === '23505') {
      return {
        correct,
        rationale: item.rationale,
        answer: item.answer,
        state: before,
        ratingBefore: before.rating,
        ratingAfter: before.rating,
        duplicate: true,
      };
    }
    throw new Error(`failed to record attempt: ${attemptError.message}`);
  }

  const { error: masteryError } = await sb.from('learner_topic_mastery').upsert(
    {
      learner_id: params.learnerId,
      topic_id: item.topicId,
      rating: applied.state.rating,
      attempts: applied.state.attempts,
      mastery_prob: applied.state.masteryProb,
      band: applied.state.band,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'learner_id,topic_id' },
  );

  if (masteryError) {
    throw new Error(
      `attempt recorded but mastery cache update failed (replayable from attempts): ${masteryError.message}`,
    );
  }

  return {
    correct,
    rationale: item.rationale,
    answer: item.answer,
    state: applied.state,
    ratingBefore: applied.ratingBefore,
    ratingAfter: applied.ratingAfter,
    duplicate: false,
  };
}

/** Record a rejected generation for QA (quiz-generation-prompt.md §5.1). */
export async function recordGenerationFailure(
  params: {
    learnerId: string;
    topicId: string;
    targetDifficulty: Difficulty;
    reason: string;
  },
  client?: SupabaseClient,
): Promise<void> {
  const { error } = await db(client).from('generation_failures').insert({
    learner_id: params.learnerId,
    topic_id: params.topicId,
    target_difficulty: params.targetDifficulty,
    reason: params.reason,
  });
  // QA telemetry must never break the learner's turn.
  if (error) console.error('[generation_failures] insert failed:', error.message);
}
