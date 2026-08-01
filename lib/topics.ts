/**
 * Typed access to `topics.json` — the content source of truth.
 *
 * The database holds only what it needs for foreign keys and per-LO reporting
 * (see supabase/migrations/0002_seed_topics.sql); prompts, options, answer keys
 * and rubrics live here and are read server-side.
 *
 * The whole topic object is sent to the generator as its grounding, exactly as
 * `quiz-generation-prompt.md` §2 specifies.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { Difficulty } from './mastery.js';

export type QuestionType = 'mcq' | 'open';
export type GenerativeStrategy = 'self_test' | 'self_explain' | 'elaborate' | 'apply';

export interface AnchorQuestion {
  id: string;
  type: 'mcq';
  difficulty: Difficulty;
  generative_strategy: GenerativeStrategy;
  prompt: string;
  options: string[];
  /** 0-based index into `options`. Server-side only — never send to the browser. */
  answer: number;
  rationale: string;
}

export interface GenerativeActivity {
  id: string;
  type: 'open';
  difficulty: Difficulty;
  generative_strategy: GenerativeStrategy;
  prompt: string;
  scoring: 'ai_graded';
  rubric: string[];
}

export interface Topic {
  id: string;
  slug: string;
  title: string;
  /** May be compound in the raw file, e.g. "LO2/LO3" — use `learningOutcomes()`. */
  learning_outcome: string;
  learning_outcome_text: string;
  description: string;
  key_concepts: string[];
  generative_activity: GenerativeActivity;
  diagnostic_questions: AnchorQuestion[];
}

export interface TopicsFile {
  meta: {
    spec_version: string;
    course_code: string;
    course_title: string;
    [key: string]: unknown;
  };
  topics: Topic[];
}

// lib/ sits alongside topics.json at the repo root. `__dirname` does not exist
// under ESM, so derive it from import.meta.url.
const here = dirname(fileURLToPath(import.meta.url));
const TOPICS_PATH = join(here, '..', 'topics.json');

let cached: TopicsFile | undefined;

/** Read and cache topics.json. Content is static per deploy. */
export function loadTopics(): TopicsFile {
  cached ??= JSON.parse(readFileSync(TOPICS_PATH, 'utf8')) as TopicsFile;
  return cached;
}

/** The content revision every assessment_snapshot is stamped with. */
export function specVersion(): string {
  return loadTopics().meta.spec_version;
}

export function allTopics(): Topic[] {
  return loadTopics().topics;
}

export function getTopic(topicId: string): Topic {
  const topic = allTopics().find((t) => t.id === topicId);
  if (!topic) {
    throw new Error(`unknown topic_id: ${topicId}`);
  }
  return topic;
}

/** Split the compound `learning_outcome` string ("LO2/LO3") into its parts. */
export function learningOutcomes(topic: Topic): string[] {
  return topic.learning_outcome.split('/').map((lo) => lo.trim()).filter(Boolean);
}

/**
 * Anchor questions for a topic, in served order (easy -> medium -> hard).
 *
 * This is the baseline diagnostic, and the fallback pool when generation fails
 * outside a post assessment.
 */
export function anchorQuestions(topicId: string): AnchorQuestion[] {
  const order: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };
  return [...getTopic(topicId).diagnostic_questions].sort(
    (a, b) => order[a.difficulty] - order[b.difficulty],
  );
}

/**
 * The topic object as sent to the generator.
 *
 * `quiz-generation-prompt.md` §2 says to send the full topic object, and §1
 * rule 1 grounds generation in `title`, `description` and `key_concepts`. The
 * anchor questions travel with it so the model can honour the self-check rule
 * "no question duplicates an anchor question"; answer keys are stripped, since
 * nothing downstream needs them and they only invite the model to echo one.
 */
export function topicForPrompt(topicId: string): Record<string, unknown> {
  const topic = getTopic(topicId);
  return {
    id: topic.id,
    title: topic.title,
    learning_outcome: topic.learning_outcome,
    learning_outcome_text: topic.learning_outcome_text,
    description: topic.description,
    key_concepts: topic.key_concepts,
    diagnostic_questions: topic.diagnostic_questions.map((q) => ({
      id: q.id,
      difficulty: q.difficulty,
      prompt: q.prompt,
      options: q.options,
    })),
  };
}
