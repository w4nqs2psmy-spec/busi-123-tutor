import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Difficulty } from '../mastery';
import type { TopicMastery } from '../browse-model';
import { serviceRoleClient } from '../supabase/server';

/**
 * Everything the browse page needs about one learner, in two queries.
 *
 * Episode completion is aggregated in JS rather than SQL: PostgREST has no
 * GROUP BY, and one learner's attempt history is bounded enough that fetching
 * the three needed columns and folding them is cheaper than a view.
 */

export interface BrowseData {
  displayName: string | null;
  masteryByTopic: Map<string, TopicMastery>;
  /** Non-null when the learner's data could not be read; the page degrades. */
  error: string | null;
}

export const EMPTY_BROWSE_DATA: BrowseData = {
  displayName: null,
  masteryByTopic: new Map(),
  error: null,
};

interface MasteryRow {
  topic_id: string;
  rating: number;
  attempts: number;
  updated_at: string | null;
}

interface AttemptRow {
  topic_id: string;
  difficulty: Difficulty;
  correct: boolean | null;
}

export async function getBrowseData(
  learnerId: string,
  client?: SupabaseClient,
): Promise<BrowseData> {
  const sb = client ?? serviceRoleClient();

  try {
    const [masteryResult, attemptsResult, profileResult] = await Promise.all([
      sb
        .from('learner_topic_mastery')
        .select('topic_id, rating, attempts, updated_at')
        .eq('learner_id', learnerId),
      sb.from('attempts').select('topic_id, difficulty, correct').eq('learner_id', learnerId),
      sb.from('profiles').select('display_name').eq('id', learnerId).maybeSingle(),
    ]);

    if (masteryResult.error) {
      return { ...EMPTY_BROWSE_DATA, error: masteryResult.error.message };
    }
    if (attemptsResult.error) {
      return { ...EMPTY_BROWSE_DATA, error: attemptsResult.error.message };
    }

    const episodes = new Map<string, Map<Difficulty, { attempted: number; correct: number }>>();
    for (const row of (attemptsResult.data ?? []) as AttemptRow[]) {
      let byDifficulty = episodes.get(row.topic_id);
      if (!byDifficulty) {
        byDifficulty = new Map();
        episodes.set(row.topic_id, byDifficulty);
      }
      const cell = byDifficulty.get(row.difficulty) ?? { attempted: 0, correct: 0 };
      cell.attempted += 1;
      if (row.correct === true) cell.correct += 1;
      byDifficulty.set(row.difficulty, cell);
    }

    const masteryByTopic = new Map<string, TopicMastery>();
    for (const row of (masteryResult.data ?? []) as MasteryRow[]) {
      masteryByTopic.set(row.topic_id, {
        topicId: row.topic_id,
        rating: row.rating,
        attempts: row.attempts,
        updatedAt: row.updated_at,
        episodes: [...(episodes.get(row.topic_id) ?? new Map())].map(
          ([difficulty, cell]) => ({ difficulty, ...cell }),
        ),
      });
    }

    return {
      displayName: (profileResult.data?.['display_name'] as string | undefined) ?? null,
      masteryByTopic,
      error: null,
    };
  } catch (error) {
    return {
      ...EMPTY_BROWSE_DATA,
      error: error instanceof Error ? error.message : 'could not read learner data',
    };
  }
}
