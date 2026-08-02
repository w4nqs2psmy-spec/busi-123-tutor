import { describe, expect, it } from 'vitest';

import {
  BAND_MIN_ATTEMPTS,
  K,
  INITIAL_RATING,
  ITEM_RATING,
  TARGET_SUCCESS,
  applyAttempt,
  cohortNormalizedGain,
  deriveState,
  expectedScore,
  gainBand,
  initialMastery,
  masteryBand,
  masteryProbability,
  nextDifficulty,
  normalizedGain,
  pairByLearner,
  proportionCorrect,
  seedFromBaseline,
  updateMastery,
} from './mastery';

// ---------------------------------------------------------------------------
// The pinned worked example — mastery-model.md §3
// ---------------------------------------------------------------------------
// If these numbers move, the spec and the implementation have diverged.

describe('mastery-model.md §3 worked example', () => {
  it('answer 1 — hard item, correct: 1500 -> ~1534, p ~0.55', () => {
    expect(expectedScore(1500, ITEM_RATING.hard)).toBeCloseTo(0.151, 3);

    const rating = updateMastery(1500, 'hard', true);
    expect(rating).toBeCloseTo(1533.96, 2);
    expect(Math.round(rating)).toBe(1534);
    expect(masteryProbability(rating)).toBeCloseTo(0.55, 2);
  });

  it('answer 2 — medium item, incorrect: ~1534 -> ~1512, p ~0.52', () => {
    const afterFirst = updateMastery(1500, 'hard', true);

    expect(expectedScore(afterFirst, ITEM_RATING.medium)).toBeCloseTo(0.549, 3);

    const rating = updateMastery(afterFirst, 'medium', false);

    // The spec quotes 1512.05, which it reaches by feeding the ROUNDED 1534
    // back in. Chaining the true 1533.9608 — which is what a stored rating
    // must do — gives 1512.012. Both satisfy the spec's own "≈ 1512"; the
    // 0.04 difference is display rounding in the worked example, not a
    // divergence in the model. Never round a rating between updates.
    expect(rating).toBeCloseTo(1512.012, 3);
    expect(Math.round(rating)).toBe(1512);
    expect(masteryProbability(rating)).toBeCloseTo(0.52, 2);
  });

  it('a miss on an expected item pulls the estimate down only modestly', () => {
    const rise = updateMastery(1500, 'hard', true) - INITIAL_RATING;
    const afterFirst = updateMastery(1500, 'hard', true);
    const fall = afterFirst - updateMastery(afterFirst, 'medium', false);

    // Succeeding on a hard item is stronger evidence (+33.96) than missing a
    // coin-flip medium is against you (-21.95): one miss is not decisive.
    expect(rise).toBeCloseTo(33.96, 2);
    expect(fall).toBeCloseTo(21.95, 2);
    expect(fall).toBeLessThan(rise);
  });
});

// ---------------------------------------------------------------------------
// Elo mechanics
// ---------------------------------------------------------------------------

describe('updateMastery', () => {
  it('rewards the surprising outcome more than the expected one', () => {
    const hardWin = updateMastery(1500, 'hard', true) - 1500;
    const easyWin = updateMastery(1500, 'easy', true) - 1500;
    expect(hardWin).toBeGreaterThan(easyWin);
  });

  it('barely moves a strong learner who clears an easy item', () => {
    const easyWinWhenStrong = updateMastery(1800, 'easy', true) - 1800;
    const hardWinWhenAverage = updateMastery(1500, 'hard', true) - 1500;

    expect(easyWinWhenStrong).toBeCloseTo(1.23, 2);
    expect(easyWinWhenStrong).toBeLessThan(hardWinWhenAverage / 25);
  });

  it('accepts a fractional outcome for rubric-graded open tasks', () => {
    // 2 of 3 criteria met, medium item, learner at the 1500 prior:
    // expected = 0.5, so 1500 + 40 * (0.6667 - 0.5).
    expect(updateMastery(1500, 'medium', 2 / 3)).toBeCloseTo(1506.667, 3);
  });

  it('treats a fractional 1 and 0 identically to booleans', () => {
    expect(updateMastery(1500, 'hard', 1)).toBe(updateMastery(1500, 'hard', true));
    expect(updateMastery(1500, 'hard', 0)).toBe(updateMastery(1500, 'hard', false));
  });

  it('rejects an outcome outside [0, 1]', () => {
    expect(() => updateMastery(1500, 'medium', 1.5)).toThrow(RangeError);
    expect(() => updateMastery(1500, 'medium', -0.1)).toThrow(RangeError);
    expect(() => updateMastery(1500, 'medium', Number.NaN)).toThrow(RangeError);
  });

  it('honours a K override without touching the default', () => {
    const base = updateMastery(1500, 'hard', true) - 1500;
    const doubled = updateMastery(1500, 'hard', true, 80) - 1500;
    expect(doubled).toBeCloseTo(base * 2, 6);
  });
});

describe('masteryProbability', () => {
  it('is 0.5 at the medium reference rating', () => {
    expect(masteryProbability(1500)).toBeCloseTo(0.5, 10);
  });

  it('is monotonic in rating', () => {
    expect(masteryProbability(1400)).toBeLessThan(masteryProbability(1500));
    expect(masteryProbability(1500)).toBeLessThan(masteryProbability(1600));
  });
});

describe('masteryBand', () => {
  it('gates on thin evidence below BAND_MIN_ATTEMPTS', () => {
    expect(masteryBand(0.95, BAND_MIN_ATTEMPTS - 1)).toBe('provisional');
    expect(masteryBand(0.05, BAND_MIN_ATTEMPTS - 1)).toBe('provisional');
  });

  it('reports a real band once a 3-item baseline is complete', () => {
    expect(masteryBand(0.95, BAND_MIN_ATTEMPTS)).toBe('proficient');
  });

  it('applies the spec thresholds at their boundaries', () => {
    expect(masteryBand(0.399, 10)).toBe('novice');
    expect(masteryBand(0.4, 10)).toBe('developing');
    expect(masteryBand(0.699, 10)).toBe('developing');
    expect(masteryBand(0.7, 10)).toBe('proficient');
  });
});

// ---------------------------------------------------------------------------
// Item selection
// ---------------------------------------------------------------------------

describe('nextDifficulty', () => {
  it('selects the bucket closest to TARGET_SUCCESS, not merely above a floor', () => {
    for (const rating of [1100, 1350, 1500, 1600, 1700, 1900, 2100]) {
      const chosen = nextDifficulty(rating);
      const chosenDistance = Math.abs(expectedScore(rating, ITEM_RATING[chosen]) - TARGET_SUCCESS);

      for (const other of ['easy', 'medium', 'hard'] as const) {
        const distance = Math.abs(expectedScore(rating, ITEM_RATING[other]) - TARGET_SUCCESS);
        expect(chosenDistance).toBeLessThanOrEqual(distance + 1e-12);
      }
    }
  });

  it('hits each bucket exactly on target at its ideal rating', () => {
    expect(nextDifficulty(1347.2)).toBe('easy');
    expect(nextDifficulty(1647.2)).toBe('medium');
    expect(nextDifficulty(1947.2)).toBe('hard');

    expect(expectedScore(1347.2, ITEM_RATING.easy)).toBeCloseTo(TARGET_SUCCESS, 3);
    expect(expectedScore(1647.2, ITEM_RATING.medium)).toBeCloseTo(TARGET_SUCCESS, 3);
    expect(expectedScore(1947.2, ITEM_RATING.hard)).toBeCloseTo(TARGET_SUCCESS, 3);
  });

  it('switches easy -> medium at ~1523.8', () => {
    expect(nextDifficulty(1523)).toBe('easy');
    expect(nextDifficulty(1525)).toBe('medium');
  });

  it('switches medium -> hard at ~1823.8', () => {
    expect(nextDifficulty(1823)).toBe('medium');
    expect(nextDifficulty(1825)).toBe('hard');
  });

  it('serves easy at the 1500 prior', () => {
    expect(nextDifficulty(INITIAL_RATING)).toBe('easy');
  });

  it('is monotonic — difficulty never falls as rating rises', () => {
    const order = { easy: 0, medium: 1, hard: 2 };
    let previous = -1;
    for (let rating = 1000; rating <= 2200; rating += 10) {
      const current = order[nextDifficulty(rating)];
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('never misses the target by more than ~0.166 across the buckets’ span', () => {
    for (let rating = 1347; rating <= 1947; rating += 1) {
      const miss = Math.abs(
        expectedScore(rating, ITEM_RATING[nextDifficulty(rating)]) - TARGET_SUCCESS,
      );
      expect(miss).toBeLessThanOrEqual(0.167);
    }
  });

  it('clamps to the extreme buckets outside that span', () => {
    expect(nextDifficulty(900)).toBe('easy');
    expect(nextDifficulty(2400)).toBe('hard');
  });
});

// ---------------------------------------------------------------------------
// Stateful helpers
// ---------------------------------------------------------------------------

describe('applyAttempt', () => {
  it('returns the audit fields an attempts row needs', () => {
    const step = applyAttempt(initialMastery(), { difficulty: 'hard', outcome: true });

    expect(step.ratingBefore).toBe(1500);
    expect(step.ratingAfter).toBeCloseTo(1533.96, 2);
    expect(step.state.rating).toBe(step.ratingAfter);
    expect(step.state.attempts).toBe(1);
  });

  it('keeps the derived cache consistent with the rating', () => {
    const step = applyAttempt(initialMastery(), { difficulty: 'medium', outcome: true });
    expect(step.state.masteryProb).toBe(masteryProbability(step.state.rating));
    expect(step.state.band).toBe(masteryBand(step.state.masteryProb, step.state.attempts));
  });

  it('chains — replaying the §3 example through state matches the raw functions', () => {
    const first = applyAttempt(initialMastery(), { difficulty: 'hard', outcome: true });
    const second = applyAttempt(first.state, { difficulty: 'medium', outcome: false });

    expect(second.ratingBefore).toBeCloseTo(1533.96, 2);
    expect(second.ratingAfter).toBeCloseTo(1512.012, 3);
    expect(second.state.attempts).toBe(2);
  });
});

describe('seedFromBaseline', () => {
  const anchors = (outcomes: [boolean, boolean, boolean]) =>
    [
      { difficulty: 'easy' as const, outcome: outcomes[0] },
      { difficulty: 'medium' as const, outcome: outcomes[1] },
      { difficulty: 'hard' as const, outcome: outcomes[2] },
    ];

  it('folds one update per anchor item, in served order', () => {
    const { state, applied } = seedFromBaseline(anchors([true, true, true]));

    expect(applied).toHaveLength(3);
    expect(state.attempts).toBe(3);
    // Each step's before must equal the previous step's after — the chain is
    // what makes the attempts table replayable.
    expect(applied[0]!.ratingBefore).toBe(INITIAL_RATING);
    expect(applied[1]!.ratingBefore).toBe(applied[0]!.ratingAfter);
    expect(applied[2]!.ratingBefore).toBe(applied[1]!.ratingAfter);
    expect(state.rating).toBe(applied[2]!.ratingAfter);
  });

  it('clears the confidence gate exactly at a completed baseline', () => {
    const { state } = seedFromBaseline(anchors([true, false, false]));
    expect(state.attempts).toBe(BAND_MIN_ATTEMPTS);
    expect(state.band).not.toBe('provisional');
  });

  it('orders outcomes sensibly: 3/3 outranks 0/3', () => {
    const perfect = seedFromBaseline(anchors([true, true, true])).state;
    const zero = seedFromBaseline(anchors([false, false, false])).state;
    expect(perfect.rating).toBeGreaterThan(zero.rating);
  });

  // The adaptive K collapses the whole 0/3..3/3 range into one band over only
  // three items. That is why baseline seeding uses its own rate; kept pinned
  // so the reason for K_BASELINE stays legible.
  it('would land every baseline score in "developing" at the adaptive K=40', () => {
    const scores: [boolean, boolean, boolean][] = [
      [false, false, false],
      [true, false, false],
      [true, true, false],
      [true, true, true],
    ];
    for (const outcome of scores) {
      expect(seedFromBaseline(anchors(outcome), K).state.band).toBe('developing');
    }

    expect(seedFromBaseline(anchors([false, false, false]), K).state.masteryProb)
      .toBeCloseTo(0.419, 3);
    expect(seedFromBaseline(anchors([true, true, true]), K).state.masteryProb)
      .toBeCloseTo(0.584, 3);
  });

  it('separates the extremes at the K_BASELINE default', () => {
    expect(seedFromBaseline(anchors([false, false, false])).state.band).toBe('novice');
    expect(seedFromBaseline(anchors([true, true, true])).state.band).toBe('developing');
  });
});

describe('deriveState / initialMastery', () => {
  it('starts at the 1500 prior with no evidence', () => {
    const state = initialMastery();
    expect(state.rating).toBe(1500);
    expect(state.attempts).toBe(0);
    expect(state.masteryProb).toBeCloseTo(0.5, 10);
    expect(state.band).toBe('provisional');
  });

  it('round-trips a stored row', () => {
    const state = deriveState(1647.2, 12);
    expect(state.masteryProb).toBeCloseTo(0.7, 3);
    expect(state.band).toBe('proficient');
  });
});

describe('proportionCorrect', () => {
  it('scores a 3-item anchor baseline', () => {
    expect(proportionCorrect([true, true, false])).toBeCloseTo(2 / 3, 10);
  });

  it('averages fractional rubric scores', () => {
    expect(proportionCorrect([1, 0.5, 0])).toBeCloseTo(0.5, 10);
  });

  it('refuses to score an empty assessment', () => {
    expect(() => proportionCorrect([])).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Learning gain — mastery-model.md §4
// ---------------------------------------------------------------------------

describe('normalizedGain', () => {
  it('matches the spec example: 0.45 -> 0.68 gives g ~0.42', () => {
    expect(normalizedGain(0.45, 0.68)).toBeCloseTo(0.418, 3);
    expect(gainBand(normalizedGain(0.45, 0.68)!)).toBe('medium');
  });

  it('returns null at the ceiling, where gain is undefined', () => {
    expect(normalizedGain(1, 1)).toBeNull();
    expect(normalizedGain(1.0, 0.9)).toBeNull();
  });

  it('goes negative when the learner regresses', () => {
    expect(normalizedGain(0.6, 0.4)).toBeLessThan(0);
  });
});

describe('gainBand', () => {
  it('applies Hake 1998 thresholds', () => {
    expect(gainBand(0.71)).toBe('high');
    expect(gainBand(0.7)).toBe('medium');
    expect(gainBand(0.3)).toBe('medium');
    expect(gainBand(0.29)).toBe('low');
  });
});

describe('pairByLearner', () => {
  it('inner-joins on learner, never on position', () => {
    const { pairs, unmatched } = pairByLearner(
      [
        { learnerId: 'a', score: 0.3 },
        { learnerId: 'b', score: 0.5 },
        { learnerId: 'c', score: 0.4 },
      ],
      // Deliberately reordered, and 'b' never sat the post assessment.
      [
        { learnerId: 'c', score: 0.8 },
        { learnerId: 'a', score: 0.6 },
      ],
    );

    expect(pairs).toEqual([
      { learnerId: 'a', pre: 0.3, post: 0.6 },
      { learnerId: 'c', pre: 0.4, post: 0.8 },
    ]);
    expect(unmatched).toBe(1);
  });

  it('counts a post score with no baseline as unmatched', () => {
    const { pairs, unmatched } = pairByLearner(
      [{ learnerId: 'a', score: 0.3 }],
      [
        { learnerId: 'a', score: 0.6 },
        { learnerId: 'z', score: 0.9 },
      ],
    );
    expect(pairs).toHaveLength(1);
    expect(unmatched).toBe(1);
  });
});

describe('cohortNormalizedGain', () => {
  it('computes from class-average pre/post, per Hake convention', () => {
    // Averages 0.45 -> 0.68, the spec's §4 example.
    const result = cohortNormalizedGain([
      { learnerId: 'a', pre: 0.4, post: 0.66 },
      { learnerId: 'b', pre: 0.5, post: 0.7 },
    ]);

    expect(result.g).toBeCloseTo(0.418, 3);
    expect(result.band).toBe('medium');
    expect(result.included).toBe(2);
  });

  it('is not the mean of individual gains', () => {
    const pairs = [
      { learnerId: 'a', pre: 0.1, post: 0.5 },
      { learnerId: 'b', pre: 0.8, post: 0.9 },
    ];
    const meanOfIndividual =
      (normalizedGain(0.1, 0.5)! + normalizedGain(0.8, 0.9)!) / 2;

    expect(cohortNormalizedGain(pairs).g).not.toBeCloseTo(meanOfIndividual, 3);
  });

  it('excludes ceiling learners before averaging', () => {
    const result = cohortNormalizedGain([
      { learnerId: 'a', pre: 0.4, post: 0.66 },
      { learnerId: 'b', pre: 0.5, post: 0.7 },
      { learnerId: 'ceiling', pre: 1, post: 1 },
    ]);

    expect(result.excludedCeiling).toBe(1);
    expect(result.included).toBe(2);
    expect(result.g).toBeCloseTo(0.418, 3);
  });

  it('returns null rather than dividing by zero when everyone is at the ceiling', () => {
    const result = cohortNormalizedGain([
      { learnerId: 'a', pre: 1, post: 1 },
      { learnerId: 'b', pre: 1, post: 1 },
    ]);

    expect(result.g).toBeNull();
    expect(result.band).toBeNull();
    expect(result.included).toBe(0);
    expect(result.excludedCeiling).toBe(2);
    expect(Number.isFinite(result.g as number)).toBe(false);
  });

  it('returns null for an empty cohort', () => {
    expect(cohortNormalizedGain([]).g).toBeNull();
  });

  it('carries the unmatched count through from pairing', () => {
    const { pairs, unmatched } = pairByLearner(
      [
        { learnerId: 'a', score: 0.4 },
        { learnerId: 'b', score: 0.5 },
      ],
      [{ learnerId: 'a', score: 0.66 }],
    );

    expect(cohortNormalizedGain(pairs, unmatched).excludedUnmatched).toBe(1);
  });
});
