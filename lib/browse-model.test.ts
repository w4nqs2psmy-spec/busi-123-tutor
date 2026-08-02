import { describe, expect, it } from 'vitest';

import {
  BAND_STYLE,
  accentFor,
  buildRows,
  buildTopicCard,
  buildTopicCards,
  daysSince,
  describeAge,
  genreFor,
  selectHero,
  type TopicMastery,
} from './browse-model';
import { masteryBand, masteryProbability } from './mastery';
import { allTopics, getTopic } from './topics';

const NOW = new Date('2026-08-01T12:00:00Z');

const mastery = (over: Partial<TopicMastery> = {}): TopicMastery => ({
  topicId: 'market-research',
  rating: 1500,
  attempts: 0,
  updatedAt: null,
  episodes: [],
  ...over,
});

// ---------------------------------------------------------------------------
// Real content, not the prototype's placeholders
// ---------------------------------------------------------------------------

describe('content binding', () => {
  it('builds a card for all seven real topics', () => {
    const cards = buildTopicCards(allTopics(), new Map(), NOW);
    expect(cards).toHaveLength(7);
    expect(cards.map((c) => c.id)).toEqual([
      'market-research',
      'pestel',
      'five-forces',
      'competitive-advantage',
      'business-model-canvas',
      'entrepreneurial-csf',
      'sustainability',
    ]);
  });

  it('does not contain the prototype placeholder ids', () => {
    const ids = buildTopicCards(allTopics(), new Map(), NOW).map((c) => c.id);
    for (const fake of ['business-model', 'financial-forecasting', 'marketing-strategy']) {
      expect(ids).not.toContain(fake);
    }
  });

  it('takes title, blurb and concept count from topics.json', () => {
    const topic = getTopic('business-model-canvas');
    const card = buildTopicCard(topic, undefined, NOW);

    expect(card.title).toBe(topic.title);
    expect(card.blurb).toBe(topic.description);
    expect(card.conceptCount).toBe(10); // the canvas has nine blocks + coherence
    expect(card.href).toBe('/quiz/business-model-canvas');
  });

  it('splits the compound learning outcome for the watermark', () => {
    const card = buildTopicCard(getTopic('competitive-advantage'), undefined, NOW);
    expect(card.learningOutcomes).toEqual(['LO2', 'LO3']);
  });

  it('gives every real topic a designed palette, never the fallback', () => {
    const fallback = accentFor('does-not-exist');
    for (const topic of allTopics()) {
      expect(accentFor(topic.id)).not.toBe(fallback);
    }
  });

  it('derives genre from the real learning outcome', () => {
    expect(genreFor(getTopic('market-research'))).toBe('RESEARCH');
    expect(genreFor(getTopic('five-forces'))).toBe('STRATEGY');
    expect(genreFor(getTopic('business-model-canvas'))).toBe('BUILD');
    expect(genreFor(getTopic('entrepreneurial-csf'))).toBe('TEAM');
    expect(genreFor(getTopic('sustainability'))).toBe('CONTEXT');
  });
});

// ---------------------------------------------------------------------------
// Band + progress come from the real model, not the prototype's thresholds
// ---------------------------------------------------------------------------

describe('mastery binding', () => {
  it('uses masteryBand, not the prototype 1400/1750 rating cutoffs', () => {
    // Rating 1600 is "developing" under the real p-based thresholds, but the
    // prototype's raw-rating rule would also say developing; 1700 is where they
    // diverge — real model says developing (p 0.76 -> proficient actually),
    // so assert against the model rather than a remembered number.
    for (const rating of [1300, 1450, 1600, 1700, 1900]) {
      const card = buildTopicCard(getTopic('pestel'), mastery({ rating, attempts: 10 }), NOW);
      expect(card.band).toBe(masteryBand(masteryProbability(rating), 10));
    }
  });

  it('honours the confidence gate the prototype had no state for', () => {
    const card = buildTopicCard(
      getTopic('market-research'),
      mastery({ rating: 1466.04, attempts: 1 }),
      NOW,
    );
    expect(card.band).toBe('provisional');
    expect(card.bandLabel).toBe('Provisional');
    // Provisional is deliberately colourless — no band colour is claimed.
    expect(card.bandColor).toBe(BAND_STYLE.provisional.color);
    expect(card.bandColor).not.toBe(BAND_STYLE.developing.color);
  });

  it('drives the progress bar from masteryProb, not (rating-1000)/1100', () => {
    const card = buildTopicCard(getTopic('pestel'), mastery({ rating: 1647.2, attempts: 8 }), NOW);
    expect(card.masteryProb).toBeCloseTo(0.7, 3);
    // The prototype's scale would have produced ~0.59 here.
    expect(card.masteryProb).not.toBeCloseTo((1647.2 - 1000) / 1100, 2);
  });

  it('treats a topic with no mastery row as unstarted at the 1500 prior', () => {
    const card = buildTopicCard(getTopic('sustainability'), undefined, NOW);
    expect(card.started).toBe(false);
    expect(card.rating).toBe(1500);
    expect(card.attemptCount).toBe(0);
    expect(card.daysSinceActive).toBeNull();
    expect(card.band).toBe('provisional');
  });
});

// ---------------------------------------------------------------------------
// Episodes come from persisted attempts
// ---------------------------------------------------------------------------

describe('episodes', () => {
  it('always exposes three episodes in easy -> medium -> hard order', () => {
    const card = buildTopicCard(getTopic('pestel'), undefined, NOW);
    expect(card.episodes.map((e) => e.difficulty)).toEqual(['easy', 'medium', 'hard']);
    expect(card.episodes.map((e) => e.n)).toEqual([1, 2, 3]);
  });

  it('marks an episode done only on a correct answer, not on an attempt', () => {
    const card = buildTopicCard(
      getTopic('market-research'),
      mastery({
        attempts: 3,
        episodes: [
          { difficulty: 'easy', attempted: 2, correct: 0 },
          { difficulty: 'medium', attempted: 1, correct: 1 },
        ],
      }),
      NOW,
    );

    expect(card.episodes[0]!.done).toBe(false); // attempted twice, never right
    expect(card.episodes[0]!.attempted).toBe(2);
    expect(card.episodes[1]!.done).toBe(true);
    expect(card.episodes[2]!.attempted).toBe(0);
    expect(card.episodes[2]!.done).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lastActive, derived from updated_at
// ---------------------------------------------------------------------------

describe('last active', () => {
  it('derives whole days from the mastery timestamp', () => {
    expect(daysSince('2026-08-01T09:00:00Z', NOW)).toBe(0);
    expect(daysSince('2026-07-31T09:00:00Z', NOW)).toBe(1);
    expect(daysSince('2026-07-25T09:00:00Z', NOW)).toBe(7);
    expect(daysSince(null, NOW)).toBeNull();
  });

  it('clamps a future timestamp to today rather than going negative', () => {
    expect(daysSince('2026-08-05T09:00:00Z', NOW)).toBe(0);
  });

  it('describes ages the way the prototype did', () => {
    expect(describeAge(null)).toBe('New');
    expect(describeAge(0)).toBe('Today');
    expect(describeAge(1)).toBe('Yesterday');
    expect(describeAge(3)).toBe('3 days ago');
    expect(describeAge(9)).toBe('Last week');
    expect(describeAge(21)).toBe('3 weeks ago');
  });
});

// ---------------------------------------------------------------------------
// Hero + rows
// ---------------------------------------------------------------------------

describe('selectHero', () => {
  it('picks the most recently practised unfinished topic', () => {
    const cards = buildTopicCards(
      allTopics(),
      new Map([
        ['pestel', mastery({ topicId: 'pestel', rating: 1500, attempts: 4, updatedAt: '2026-07-20T12:00:00Z' })],
        ['five-forces', mastery({ topicId: 'five-forces', rating: 1500, attempts: 4, updatedAt: '2026-07-31T12:00:00Z' })],
      ]),
      NOW,
    );

    expect(selectHero(cards)?.id).toBe('five-forces');
  });

  it('skips a proficient topic in favour of one still in progress', () => {
    const cards = buildTopicCards(
      allTopics(),
      new Map([
        ['pestel', mastery({ topicId: 'pestel', rating: 1900, attempts: 12, updatedAt: '2026-08-01T11:00:00Z' })],
        ['five-forces', mastery({ topicId: 'five-forces', rating: 1500, attempts: 5, updatedAt: '2026-07-28T12:00:00Z' })],
      ]),
      NOW,
    );

    // Precondition: pestel really is proficient and was practised more recently.
    const pestel = cards.find((c) => c.id === 'pestel')!;
    expect(pestel.band).toBe('proficient');
    expect(pestel.daysSinceActive).toBe(0);

    // It is still skipped, because a finished topic is not "continue watching".
    expect(selectHero(cards)?.id).toBe('five-forces');
    expect(selectHero(cards)?.band).toBe('developing');
  });

  it('falls back to the least-mastered topic for a brand-new learner', () => {
    const cards = buildTopicCards(allTopics(), new Map(), NOW);
    const hero = selectHero(cards);
    expect(hero).not.toBeNull();
    expect(hero!.started).toBe(false);
  });

  it('returns null when there is no content at all', () => {
    expect(selectHero([])).toBeNull();
  });
});

describe('buildRows', () => {
  it('drops empty lanes rather than rendering an empty row', () => {
    const rows = buildRows(buildTopicCards(allTopics(), new Map(), NOW));
    expect(rows.map((r) => r.key)).not.toContain('continue');
    expect(rows.map((r) => r.key)).toContain('fresh');
  });

  it('puts started topics in the continue lane, newest first', () => {
    const cards = buildTopicCards(
      allTopics(),
      new Map([
        ['pestel', mastery({ topicId: 'pestel', attempts: 2, updatedAt: '2026-07-25T12:00:00Z' })],
        ['market-research', mastery({ topicId: 'market-research', attempts: 1, updatedAt: '2026-07-31T12:00:00Z' })],
      ]),
      NOW,
    );

    const cont = buildRows(cards).find((r) => r.key === 'continue');
    expect(cont?.items.map((i) => i.id)).toEqual(['market-research', 'pestel']);
    expect(cont?.tall).toBe(true);
  });

  it('recommends by lowest mastery first', () => {
    const cards = buildTopicCards(
      allTopics(),
      new Map([
        ['pestel', mastery({ topicId: 'pestel', rating: 1900, attempts: 9 })],
        ['five-forces', mastery({ topicId: 'five-forces', rating: 1200, attempts: 9 })],
      ]),
      NOW,
    );

    const rec = buildRows(cards).find((r) => r.key === 'recommended');
    expect(rec?.items[0]!.id).toBe('five-forces');
    expect(rec?.items).toHaveLength(5);
    expect(rec?.reason).toBe(true);
  });

  it('builds the LO2 lane from real learning outcomes, including LO2/LO3', () => {
    const rows = buildRows(buildTopicCards(allTopics(), new Map(), NOW));
    const lo2 = rows.find((r) => r.key === 'lo2');

    expect(lo2?.items.map((i) => i.id)).toEqual([
      'pestel',
      'five-forces',
      'competitive-advantage',
    ]);
  });

  it('excludes started topics from the not-started lane', () => {
    const cards = buildTopicCards(
      allTopics(),
      new Map([['pestel', mastery({ topicId: 'pestel', attempts: 1, updatedAt: NOW.toISOString() })]]),
      NOW,
    );

    const fresh = buildRows(cards).find((r) => r.key === 'fresh');
    expect(fresh?.items.map((i) => i.id)).not.toContain('pestel');
    expect(fresh?.items).toHaveLength(6);
  });
});
