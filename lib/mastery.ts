/**
 * Mastery estimation and learning gain — BUSI1620 Adaptive Tutor.
 *
 * Direct implementation of `mastery-model.md`. Every function here is pure and
 * has no database or network dependency, so the whole adaptive core is unit
 * testable and the §3 worked example can be pinned as a regression test.
 *
 * Two deliberately separate systems (see the table at the top of the spec):
 *   - Elo-style mastery estimate — fast, drifting, drives adaptivity.
 *   - Hake's normalized gain — stable matched pre/post, the reported evidence.
 *
 * Adapt off the first; report improvement off the second, never the reverse.
 */

// ---------------------------------------------------------------------------
// Parameters (mastery-model.md §1)
// ---------------------------------------------------------------------------

/** Item difficulty expressed on the Elo scale. */
export const ITEM_RATING = { easy: 1200, medium: 1500, hard: 1800 } as const;

/** Standard Elo logistic scale. */
export const SCALE = 400;

/** Learning rate for the adaptive loop. Spec: 32–48 for short sequences. */
export const K = 40;

/**
 * Learning rate for baseline seeding only.
 *
 * At K = 40 the three-item anchor baseline cannot separate outcomes: every
 * score from 0/3 to 3/3 lands in "developing" (p 0.419 – 0.584), so a learner
 * who got nothing right reads the same as one who got everything right.
 *
 * 96 restores the signal — 0/3 reads novice (p 0.326) while 3/3 stays
 * developing (p 0.688). It deliberately stops short of the 120 that would push
 * 3/3 to proficient: three correct answers on four-option items is not enough
 * evidence for the top band, which should be earned in the adaptive loop.
 *
 * A higher K while evidence is thin is the standard provisional-rating pattern
 * from Elo, not a workaround. The adaptive loop is unaffected.
 */
export const K_BASELINE = 96;

/** Reference item for expressing mastery as a probability. */
export const MEDIUM = 1500;

/** Prior for a learner with no evidence yet. */
export const INITIAL_RATING = 1500;

/**
 * Predicted-success target for item selection.
 *
 * The spec describes a productive 0.6–0.8 window; we select the difficulty
 * whose predicted success is *closest to this value* rather than applying a
 * floor, which centres selection in the window instead of hugging its lower
 * edge. Single named constant so it stays tunable.
 */
export const TARGET_SUCCESS = 0.7;

/**
 * Confidence gate: below this many attempts the band reads "provisional".
 *
 * Set to 3 so a completed 3-item anchor baseline yields a real band rather
 * than leaving every learner provisional on first load. Adaptivity always runs
 * on the underlying rating regardless of the band.
 */
export const BAND_MIN_ATTEMPTS = 3;

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];
export type Band = 'provisional' | 'novice' | 'developing' | 'proficient';

// ---------------------------------------------------------------------------
// Core Elo (mastery-model.md §1)
// ---------------------------------------------------------------------------

/** Logistic expectation that a learner at `learnerRating` answers an item at `itemRating` correctly. */
export function expectedScore(learnerRating: number, itemRating: number): number {
  return 1 / (1 + Math.pow(10, (itemRating - learnerRating) / SCALE));
}

/**
 * One Elo update, run once per answered item.
 *
 * `outcome` accepts a boolean for auto-scored MCQs, or a fraction in [0, 1]
 * for AI-graded open tasks (e.g. 2 of 3 rubric criteria met -> 0.667). Elo
 * handles a fractional outcome natively — no thresholding to boolean, which
 * would throw away the partial credit the rubric exists to capture.
 *
 * @param k Optional override for the learning rate. Present so baseline
 *          seeding can be tuned without touching the adaptive loop.
 */
export function updateMastery(
  learnerRating: number,
  difficulty: Difficulty,
  outcome: boolean | number,
  k: number = K,
): number {
  const score = typeof outcome === 'boolean' ? (outcome ? 1 : 0) : outcome;
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError(`outcome must be a boolean or a number in [0, 1]; received ${outcome}`);
  }
  const expected = expectedScore(learnerRating, ITEM_RATING[difficulty]);
  return learnerRating + k * (score - expected);
}

/**
 * Mastery as a 0–1 probability: expected success against a representative
 * (medium) item. Bounded and directly comparable over time.
 */
export function masteryProbability(learnerRating: number): number {
  return expectedScore(learnerRating, MEDIUM);
}

/**
 * Band for display. Never use this to choose an item — `nextDifficulty` is the
 * sole authority for selection, and the two disagree by design.
 */
export function masteryBand(p: number, attempts: number): Band {
  if (attempts < BAND_MIN_ATTEMPTS) return 'provisional';
  if (p < 0.4) return 'novice';
  if (p < 0.7) return 'developing';
  return 'proficient';
}

// ---------------------------------------------------------------------------
// Item selection (mastery-model.md §2)
// ---------------------------------------------------------------------------

/**
 * Pick the difficulty whose predicted success is closest to TARGET_SUCCESS.
 *
 * This is the ONLY authority for what to serve next; mastery bands are for
 * display. Its output goes straight into the generator's `target_difficulty`
 * (quiz-generation-prompt.md §2).
 *
 * Switch points, with TARGET_SUCCESS = 0.70:
 *
 *     rating < 1523.8            -> easy
 *     1523.8 <= rating < 1823.8  -> medium
 *     rating >= 1823.8           -> hard
 *
 * Residual dead zones are inherent to having three fixed buckets and cannot be
 * engineered away: no bucket sits exactly on 0.70 except at ratings 1347.2 /
 * 1647.2 / 1947.2. Worst case is at the switch points, where the served item
 * misses the target by about 0.166 (e.g. a learner at 1523.8 gets easy at
 * p≈0.866 or medium at p≈0.534). Outside roughly [1347, 1947] the miss grows,
 * because there is nothing easier than "easy" or harder than "hard" to serve.
 * Pedagogically harmless; documented so nobody mistakes it for a bug.
 *
 * Ties resolve toward the easier item (strict `<` over an easy-first array).
 */
export function nextDifficulty(learnerRating: number): Difficulty {
  let best: Difficulty = DIFFICULTIES[0];
  let bestDistance = Infinity;

  for (const difficulty of DIFFICULTIES) {
    const distance = Math.abs(
      expectedScore(learnerRating, ITEM_RATING[difficulty]) - TARGET_SUCCESS,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = difficulty;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Stateful helpers — the shape the persistence layer writes
// ---------------------------------------------------------------------------

/** Mirrors a `learner_topic_mastery` row. */
export interface MasteryState {
  rating: number;
  attempts: number;
  masteryProb: number;
  band: Band;
}

/** A graded answer, ready to fold into a MasteryState. */
export interface AttemptOutcome {
  difficulty: Difficulty;
  /** Boolean for MCQs, fraction in [0, 1] for rubric-graded open tasks. */
  outcome: boolean | number;
}

/** One applied attempt: the mastery cache plus the audit fields for an `attempts` row. */
export interface AppliedAttempt {
  ratingBefore: number;
  ratingAfter: number;
  state: MasteryState;
}

export function initialMastery(): MasteryState {
  return {
    rating: INITIAL_RATING,
    attempts: 0,
    masteryProb: masteryProbability(INITIAL_RATING),
    band: masteryBand(masteryProbability(INITIAL_RATING), 0),
  };
}

/** Rebuild the derived fields from a rating and attempt count. */
export function deriveState(rating: number, attempts: number): MasteryState {
  const masteryProb = masteryProbability(rating);
  return { rating, attempts, masteryProb, band: masteryBand(masteryProb, attempts) };
}

/**
 * Apply one graded answer. Returns both the new state (for the mastery cache)
 * and rating_before/rating_after (for the `attempts` row), so a caller cannot
 * persist one without the other.
 */
export function applyAttempt(
  state: MasteryState,
  { difficulty, outcome }: AttemptOutcome,
  k: number = K,
): AppliedAttempt {
  const ratingBefore = state.rating;
  const ratingAfter = updateMastery(ratingBefore, difficulty, outcome, k);
  return {
    ratingBefore,
    ratingAfter,
    state: deriveState(ratingAfter, state.attempts + 1),
  };
}

/**
 * Seed mastery from the anchor baseline by folding the standard update over
 * each answered item in served order (easy -> medium -> hard).
 *
 * One code path: a baseline answer is ordinary evidence, scored exactly like
 * an adaptive one. Returns every applied step so each becomes an `attempts`
 * row with context='baseline'.
 */
export function seedFromBaseline(
  results: readonly AttemptOutcome[],
  k: number = K_BASELINE,
): { state: MasteryState; applied: AppliedAttempt[] } {
  let state = initialMastery();
  const applied: AppliedAttempt[] = [];

  for (const result of results) {
    const step = applyAttempt(state, result, k);
    applied.push(step);
    state = step.state;
  }

  return { state, applied };
}

/** Proportion correct for a snapshot, from graded items. */
export function proportionCorrect(outcomes: readonly (boolean | number)[]): number {
  if (outcomes.length === 0) {
    throw new RangeError('cannot score an assessment with no items');
  }
  const total = outcomes.reduce<number>(
    (sum, o) => sum + (typeof o === 'boolean' ? (o ? 1 : 0) : o),
    0,
  );
  return total / outcomes.length;
}

// ---------------------------------------------------------------------------
// Learning gain (mastery-model.md §4)
// ---------------------------------------------------------------------------
//
// Pure functions only, and unwired in Phase 1 — the post checkpoint that feeds
// them is Phase 3. They live here now so the agreed fix to cohort gain is
// captured under test while the reasoning is fresh.

/**
 * Hake's individual normalized gain. Returns null at the ceiling (pre >= 1),
 * where gain is undefined and the learner must be excluded rather than
 * counted as zero.
 */
export function normalizedGain(pre: number, post: number): number | null {
  if (pre >= 1) return null;
  return (post - pre) / (1 - pre);
}

/** A learner's matched pre/post pair. */
export interface GainPair {
  learnerId: string;
  pre: number;
  post: number;
}

export interface CohortGain {
  /** Hake's cohort g from class-average pre/post; null when undefined. */
  g: number | null;
  /** Interpretation band (Hake 1998), null when g is null. */
  band: 'low' | 'medium' | 'high' | null;
  included: number;
  /** Learners dropped for pre >= 1 (no headroom). */
  excludedCeiling: number;
  /** Learners dropped for a missing pre or post score. */
  excludedUnmatched: number;
}

/**
 * Inner-join baseline and post scores by learner.
 *
 * The spec's version took two positional arrays, which silently misaligns the
 * moment one learner has a baseline but no post — a near-certainty in a real
 * cohort. Pair explicitly instead.
 */
export function pairByLearner(
  pre: readonly { learnerId: string; score: number }[],
  post: readonly { learnerId: string; score: number }[],
): { pairs: GainPair[]; unmatched: number } {
  const postByLearner = new Map(post.map((p) => [p.learnerId, p.score]));
  const pairs: GainPair[] = [];
  let unmatched = 0;

  for (const { learnerId, score } of pre) {
    const postScore = postByLearner.get(learnerId);
    if (postScore === undefined) {
      unmatched += 1;
      continue;
    }
    pairs.push({ learnerId, pre: score, post: postScore });
  }

  // A post score with no matching baseline is equally unusable.
  const preLearners = new Set(pre.map((p) => p.learnerId));
  for (const { learnerId } of post) {
    if (!preLearners.has(learnerId)) unmatched += 1;
  }

  return { pairs, unmatched };
}

/**
 * Cohort normalized gain — the headline improvement figure.
 *
 * Hake's convention: compute from the class-average pre and post, not the mean
 * of individual g's. Ceiling cases (pre >= 1) are excluded before averaging,
 * per §4's methodological guards, and preBar = 1 is guarded rather than
 * dividing by zero.
 *
 * Report the distribution of individual g alongside this, so a single average
 * cannot hide the spread.
 */
export function cohortNormalizedGain(
  pairs: readonly GainPair[],
  unmatched = 0,
): CohortGain {
  const eligible = pairs.filter((p) => p.pre < 1);
  const excludedCeiling = pairs.length - eligible.length;

  if (eligible.length === 0) {
    return {
      g: null,
      band: null,
      included: 0,
      excludedCeiling,
      excludedUnmatched: unmatched,
    };
  }

  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const preBar = mean(eligible.map((p) => p.pre));
  const postBar = mean(eligible.map((p) => p.post));

  // Possible even after excluding individual ceilings only in degenerate
  // cases, but dividing by zero here would silently emit Infinity.
  if (preBar >= 1) {
    return {
      g: null,
      band: null,
      included: eligible.length,
      excludedCeiling,
      excludedUnmatched: unmatched,
    };
  }

  const g = (postBar - preBar) / (1 - preBar);
  return {
    g,
    band: gainBand(g),
    included: eligible.length,
    excludedCeiling,
    excludedUnmatched: unmatched,
  };
}

/** Hake (1998) interpretation bands. */
export function gainBand(g: number): 'low' | 'medium' | 'high' {
  if (g > 0.7) return 'high';
  if (g >= 0.3) return 'medium';
  return 'low';
}
