/**
 * Post-generation validation.
 *
 * `quiz-generation-prompt.md` §1 asks the model to run a self-check and set
 * `verification_passed`. That flag is a claim, not a guarantee: it is produced
 * by the same pass that produced the question. Everything the self-check
 * asserts and that code can actually decide is re-checked here, and a question
 * is only served if it survives both.
 *
 * Two self-check items are deliberately NOT machine-checkable and remain the
 * model's responsibility: "every question maps to a supplied key_concept" and
 * "no un-verifiable external facts". §5.3's optional validator pass is the
 * intended second line of defence on those; it is Phase 2.
 */

import type { Difficulty } from './mastery';
import { FORBIDDEN_OPTION_PATTERNS } from './quiz-generation-prompt';
import type { GeneratedQuestion } from './generator-schema';

/** Prompts already seen by this learner, capped at the most recent 30. */
export const AVOID_LIMIT = 30;

/** Jaccard similarity above which two prompts count as duplicates. */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;

/** Shortest rationale we will accept; §1 rule 6 wants a real justification. */
export const MIN_RATIONALE_LENGTH = 40;

export interface RejectedQuestion {
  question: GeneratedQuestion;
  reasons: string[];
}

export interface ValidationResult {
  accepted: GeneratedQuestion[];
  rejected: RejectedQuestion[];
}

export interface ValidationContext {
  targetDifficulty: Difficulty;
  /** Anchor prompts plus everything this learner has already been served. */
  avoid: readonly string[];
}

/** Lowercase, strip punctuation, collapse whitespace — for duplicate comparison. */
export function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Jaccard similarity over word sets.
 *
 * §1's self-check asks for no duplication "by MEANING, not just wording", which
 * no cheap string metric fully captures. This catches the reachable case — a
 * reworded near-copy — and leaves genuine paraphrase to the model and to the
 * §5.3 validator pass.
 */
export function promptSimilarity(a: string, b: string): number {
  const setA = new Set(normalizePrompt(a).split(' ').filter(Boolean));
  const setB = new Set(normalizePrompt(b).split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const word of setA) {
    if (setB.has(word)) shared += 1;
  }
  return shared / (setA.size + setB.size - shared);
}

/** True when `prompt` restates anything in `avoid`. */
export function duplicatesAvoided(prompt: string, avoid: readonly string[]): string | null {
  const normalized = normalizePrompt(prompt);
  for (const seen of avoid) {
    if (normalizePrompt(seen) === normalized) return seen;
    if (promptSimilarity(prompt, seen) >= DUPLICATE_SIMILARITY_THRESHOLD) return seen;
  }
  return null;
}

/** Every reason this question cannot be served; empty means it passes. */
export function validateQuestion(
  question: GeneratedQuestion,
  context: ValidationContext,
): string[] {
  const reasons: string[] = [];

  // §1 Output: "Always produce exactly 4 options."
  if (question.options.length !== 4) {
    reasons.push(`expected 4 options, got ${question.options.length}`);
  }

  if (question.options.some((option) => option.trim().length === 0)) {
    reasons.push('empty option text');
  }

  const distinct = new Set(question.options.map((o) => normalizePrompt(o)));
  if (distinct.size !== question.options.length) {
    // §1 rule 5 forbids options "that differ only trivially in wording".
    reasons.push('duplicate or near-identical options');
  }

  // §1 Output: `answer` is the 0-based index into `options`.
  if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.options.length) {
    reasons.push(`answer index ${question.answer} out of range`);
  }

  // §1 rule 5.
  for (const option of question.options) {
    for (const pattern of FORBIDDEN_OPTION_PATTERNS) {
      if (pattern.test.test(option)) {
        reasons.push(`forbidden option pattern: "${pattern.label}"`);
      }
    }
  }

  // The difficulty we asked for is the one the mastery model will log against
  // this attempt, so a mismatch would corrupt the Elo signal.
  if (question.difficulty !== context.targetDifficulty) {
    reasons.push(
      `difficulty ${question.difficulty} does not match requested ${context.targetDifficulty}`,
    );
  }

  // `topic_id` is NOT checked here: per §1's Output block it is a field on the
  // response envelope, not on each question. The generator checks it there.

  // §1 rule 6: a question whose key cannot be justified is invalid.
  if (question.rationale.trim().length < MIN_RATIONALE_LENGTH) {
    reasons.push('rationale too short to justify the key');
  }

  if (question.prompt.trim().length === 0) {
    reasons.push('empty prompt');
  }

  // §1 self-check: no duplication of an anchor question or anything in `avoid`.
  const duplicate = duplicatesAvoided(question.prompt, context.avoid);
  if (duplicate !== null) {
    reasons.push(`duplicates a prompt already seen: "${duplicate.slice(0, 60)}..."`);
  }

  return reasons;
}

/**
 * Validate a batch, and reject questions that duplicate each other within it —
 * `avoid` cannot catch that, since these prompts did not exist when it was built.
 */
export function validateQuestions(
  questions: readonly GeneratedQuestion[],
  context: ValidationContext,
): ValidationResult {
  const accepted: GeneratedQuestion[] = [];
  const rejected: RejectedQuestion[] = [];

  for (const question of questions) {
    const seen = [...context.avoid, ...accepted.map((q) => q.prompt)];
    const reasons = validateQuestion(question, { ...context, avoid: seen });

    if (reasons.length === 0) {
      accepted.push(question);
    } else {
      rejected.push({ question, reasons });
    }
  }

  return { accepted, rejected };
}

/**
 * Build the `avoid` list for a generation request.
 *
 * Newest first, capped — the list otherwise grows without bound and is re-sent
 * on every call. Anchor prompts are always included: the post assessment must
 * never repeat a pre item, and the adaptive loop should not re-serve one.
 */
export function buildAvoidList(
  anchorPrompts: readonly string[],
  servedPrompts: readonly string[],
  limit = AVOID_LIMIT,
): string[] {
  const avoid: string[] = [];
  const seen = new Set<string>();

  for (const prompt of [...anchorPrompts, ...servedPrompts]) {
    const key = normalizePrompt(prompt);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    avoid.push(prompt);
  }

  // Anchors are load-bearing for the post-assessment guard, so keep them and
  // drop the oldest served prompts when trimming.
  if (avoid.length <= limit) return avoid;
  const anchors = avoid.slice(0, anchorPrompts.length);
  const served = avoid.slice(anchorPrompts.length);
  return [...anchors, ...served.slice(-(limit - anchors.length))].slice(0, limit);
}
