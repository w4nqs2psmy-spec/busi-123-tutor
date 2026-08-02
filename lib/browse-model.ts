/**
 * View model for the browse page.
 *
 * Pure — no database, no React. Everything the streaming-style UI shows is
 * derived here from real content (`topics.json`) and real mastery, so the
 * mapping is unit testable and nothing gets invented in a component.
 *
 * Two categories of value live in this file, and the distinction matters:
 *
 *   Derived from data — band, progress, started, episode completion, "last
 *   active". These come from `lib/mastery.ts` and persisted attempts.
 *
 *   Design tokens — poster palettes and genre labels. These are not learner
 *   facts and never pretend to be. Palettes are fixed per topic; genre is
 *   derived from the topic's real learning outcome.
 */

import {
  masteryBand,
  masteryProbability,
  INITIAL_RATING,
  type Band,
  type Difficulty,
} from './mastery';
import { splitLearningOutcomes } from './learning-outcome';
// TYPE-ONLY on purpose. `topics.ts` reads the filesystem, and this module is
// imported by client components — a value import here would drag `node:fs`
// into the browser bundle and fail the build.
import type { Topic } from './topics';

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'hard'];

/**
 * Band colours.
 *
 * `provisional` is deliberately colourless: below the confidence gate there is
 * no trustworthy signal, and giving it a band colour would overstate what we
 * know. The prototype had no such state.
 */
export const BAND_STYLE: Record<Band, { label: string; color: string }> = {
  provisional: { label: 'Provisional', color: '#8A8A93' },
  novice: { label: 'Novice', color: '#D66A5C' },
  developing: { label: 'Developing', color: '#D2A94A' },
  proficient: { label: 'Proficient', color: '#6BAE7C' },
};

/**
 * Poster palettes — design tokens, not data.
 *
 * The first four are the prototype's palettes for the topics it covered with
 * real ids, kept byte-for-byte. The last three are the prototype's remaining
 * designed palettes, reassigned from its placeholder topics to the real topics
 * it never covered.
 */
const ACCENTS: Record<string, readonly [string, string]> = {
  'market-research': ['#2C4A52', '#101E23'],
  pestel: ['#33463A', '#111B15'],
  'five-forces': ['#5A2A24', '#26100D'],
  'competitive-advantage': ['#5E4A24', '#22190C'],
  'business-model-canvas': ['#2E3E52', '#121A26'],
  'entrepreneurial-csf': ['#294A38', '#0D1F16'],
  sustainability: ['#4E2A3E', '#1E1019'],
};

const FALLBACK_ACCENT: readonly [string, string] = ['#2A2A31', '#131317'];

/** Genre label, derived from the topic's first real learning outcome. */
const GENRE_BY_LO: Record<string, string> = {
  LO1: 'RESEARCH',
  LO2: 'STRATEGY',
  LO3: 'BUILD',
  LO4: 'TEAM',
  LO5: 'CONTEXT',
};

export interface EpisodeProgress {
  difficulty: Difficulty;
  attempted: number;
  correct: number;
}

/** One learner's mastery for one topic, as read from the database. */
export interface TopicMastery {
  topicId: string;
  rating: number;
  attempts: number;
  /** ISO timestamp of the last mastery write; null when never practised. */
  updatedAt: string | null;
  episodes: EpisodeProgress[];
}

export interface Episode {
  n: 1 | 2 | 3;
  name: string;
  difficulty: Difficulty;
  attempted: number;
  correct: number;
  /** Cleared = at least one correct answer at this difficulty. */
  done: boolean;
}

export interface TopicCard {
  id: string;
  title: string;
  blurb: string;
  learningOutcomes: string[];
  conceptCount: number;
  genre: string;
  accent: readonly [string, string];

  rating: number;
  attemptCount: number;
  /** 0–1. The spec's display measure; not the prototype's invented scale. */
  masteryProb: number;
  band: Band;
  bandLabel: string;
  bandColor: string;

  started: boolean;
  /** Whole days since last practised; null when never practised. */
  daysSinceActive: number | null;
  episodes: Episode[];
  href: string;
}

const EPISODE_NAMES: Record<Difficulty, string> = {
  easy: 'Warm-up',
  medium: 'Applied',
  hard: 'Challenge',
};

export function genreFor(topic: Topic): string {
  const first = splitLearningOutcomes(topic.learning_outcome)[0];
  return (first && GENRE_BY_LO[first]) ?? 'CORE';
}

export function accentFor(topicId: string): readonly [string, string] {
  return ACCENTS[topicId] ?? FALLBACK_ACCENT;
}

/** Whole days between `iso` and `now`, or null when there is no timestamp. */
export function daysSince(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((now.getTime() - then) / 86_400_000);
  return days < 0 ? 0 : days;
}

export function describeAge(days: number | null): string {
  if (days === null) return 'New';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  return `${Math.floor(days / 7)} weeks ago`;
}

function buildEpisodes(mastery: TopicMastery | undefined): Episode[] {
  return DIFFICULTY_ORDER.map((difficulty, i) => {
    const found = mastery?.episodes.find((e) => e.difficulty === difficulty);
    const attempted = found?.attempted ?? 0;
    const correct = found?.correct ?? 0;
    return {
      n: (i + 1) as 1 | 2 | 3,
      name: EPISODE_NAMES[difficulty],
      difficulty,
      attempted,
      correct,
      done: correct > 0,
    };
  });
}

export function buildTopicCard(
  topic: Topic,
  mastery: TopicMastery | undefined,
  now: Date = new Date(),
): TopicCard {
  const rating = mastery?.rating ?? INITIAL_RATING;
  const attemptCount = mastery?.attempts ?? 0;
  const masteryProb = masteryProbability(rating);
  const band = masteryBand(masteryProb, attemptCount);
  const style = BAND_STYLE[band];

  return {
    id: topic.id,
    title: topic.title,
    blurb: topic.description,
    learningOutcomes: splitLearningOutcomes(topic.learning_outcome),
    conceptCount: topic.key_concepts.length,
    genre: genreFor(topic),
    accent: accentFor(topic.id),

    rating,
    attemptCount,
    masteryProb,
    band,
    bandLabel: style.label,
    bandColor: style.color,

    started: attemptCount > 0,
    daysSinceActive: daysSince(mastery?.updatedAt ?? null, now),
    episodes: buildEpisodes(mastery),
    href: `/quiz/${topic.id}`,
  };
}

export function buildTopicCards(
  topics: readonly Topic[],
  masteryByTopic: ReadonlyMap<string, TopicMastery>,
  now: Date = new Date(),
): TopicCard[] {
  return topics.map((t) => buildTopicCard(t, masteryByTopic.get(t.id), now));
}

/**
 * Hero = the started topic practised most recently that is not yet proficient.
 *
 * Falls back to the least-mastered topic when nothing has been started, so a
 * brand-new learner still gets a meaningful "start here" rather than an
 * arbitrary first row.
 */
export function selectHero(cards: readonly TopicCard[]): TopicCard | null {
  if (cards.length === 0) return null;

  const inProgress = cards
    .filter((c) => c.started && c.band !== 'proficient')
    .sort((a, b) => (a.daysSinceActive ?? Infinity) - (b.daysSinceActive ?? Infinity));

  if (inProgress[0]) return inProgress[0];

  const started = cards
    .filter((c) => c.started)
    .sort((a, b) => (a.daysSinceActive ?? Infinity) - (b.daysSinceActive ?? Infinity));
  if (started[0]) return started[0];

  return [...cards].sort((a, b) => a.masteryProb - b.masteryProb)[0] ?? null;
}

export interface BrowseRow {
  key: string;
  label: string;
  items: TopicCard[];
  /** Taller 3:4 posters, used for the continue row. */
  tall?: boolean;
  /** Show the "lowest mastery" reason tag on hover. */
  reason?: boolean;
}

export function buildRows(cards: readonly TopicCard[]): BrowseRow[] {
  const continueRow = cards
    .filter((c) => c.started)
    .sort((a, b) => (a.daysSinceActive ?? Infinity) - (b.daysSinceActive ?? Infinity));

  const recommended = [...cards].sort((a, b) => a.masteryProb - b.masteryProb).slice(0, 5);

  const lo2 = cards.filter((c) => c.learningOutcomes.includes('LO2'));

  const fresh = cards.filter((c) => !c.started);

  return [
    { key: 'continue', label: 'Continue where you left off', items: continueRow, tall: true },
    { key: 'recommended', label: 'Recommended for you', items: recommended, reason: true },
    { key: 'lo2', label: 'Strategy track · Learning outcome LO2', items: lo2 },
    { key: 'fresh', label: "Haven't started", items: fresh },
  ].filter((r) => r.items.length > 0);
}
