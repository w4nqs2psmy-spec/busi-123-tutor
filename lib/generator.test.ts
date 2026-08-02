import { describe, expect, it } from 'vitest';

import { buildUserMessage, forBrowser, generateQuestions } from './generator';
import type { GeneratedQuestion } from './generator-schema';
import { GenerationResponseSchema } from './generator-schema';
import { SYSTEM_PROMPT } from './quiz-generation-prompt';
import { anchorQuestions, allTopics, getTopic, learningOutcomes, specVersion } from './topics';
import {
  AVOID_LIMIT,
  buildAvoidList,
  duplicatesAvoided,
  normalizePrompt,
  promptSimilarity,
  validateQuestion,
  validateQuestions,
} from './validate-questions';

const validQuestion = (over: Partial<GeneratedQuestion> = {}): GeneratedQuestion => ({
  id: 'market-research-gen-1',
  type: 'mcq',
  difficulty: 'medium',
  generative_strategy: 'apply',
  prompt: 'A founder must size a niche market with no published report. What is the best first step?',
  options: [
    'Assume a fixed one percent share of the total addressable market',
    'Interview reachable target customers to establish a conversion baseline',
    'Use the largest figure available in any adjacent industry report',
    'Skip sizing entirely and proceed straight to product build',
  ],
  answer: 1,
  rationale:
    'Bottom-up evidence from reachable customers grounds the estimate in observed demand, whereas a fixed percentage assumption and borrowed figures are unjustified.',
  ...over,
});

// `topic_id` is an envelope field, not a per-question one — see the
// "rejects an envelope topic_id that does not match" test below.
const context = { targetDifficulty: 'medium' as const, avoid: [] };

// ---------------------------------------------------------------------------
// topics.json loader
// ---------------------------------------------------------------------------

describe('topics loader', () => {
  it('exposes the seven topics and the spec version', () => {
    expect(allTopics()).toHaveLength(7);
    expect(specVersion()).toBe('1.0.0');
  });

  it('splits the compound learning outcome on competitive-advantage', () => {
    expect(learningOutcomes(getTopic('competitive-advantage'))).toEqual(['LO2', 'LO3']);
    expect(learningOutcomes(getTopic('market-research'))).toEqual(['LO1']);
  });

  it('orders anchor questions easy -> medium -> hard for baseline seeding', () => {
    for (const topic of allTopics()) {
      expect(anchorQuestions(topic.id).map((q) => q.difficulty)).toEqual([
        'easy',
        'medium',
        'hard',
      ]);
    }
  });

  it('every anchor answer index is in range and keys a real option', () => {
    for (const topic of allTopics()) {
      for (const q of topic.diagnostic_questions) {
        expect(q.options).toHaveLength(4);
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.answer).toBeLessThan(q.options.length);
        expect(q.options[q.answer]!.length).toBeGreaterThan(0);
        expect(q.rationale.length).toBeGreaterThan(20);
      }
    }
  });

  it('throws on an unknown topic rather than returning undefined', () => {
    expect(() => getTopic('nope')).toThrow(/unknown topic_id/);
  });
});

// ---------------------------------------------------------------------------
// System prompt fidelity
// ---------------------------------------------------------------------------

describe('system prompt', () => {
  it('carries the derive-answer-first rule verbatim', () => {
    expect(SYSTEM_PROMPT).toContain(
      'Decide the CORRECT answer FIRST from the key_concepts and write its justification.',
    );
  });

  it('keeps the forbidden-pattern and self-check rules', () => {
    expect(SYSTEM_PROMPT).toContain('all of the above');
    expect(SYSTEM_PROMPT).toContain('Only set "verification_passed": true if every check passes.');
    expect(SYSTEM_PROMPT).toContain('Always produce exactly 4 options.');
  });
});

// ---------------------------------------------------------------------------
// User message contract (§2)
// ---------------------------------------------------------------------------

describe('buildUserMessage', () => {
  it('sends the topic object with key_concepts as the grounding', () => {
    const payload = JSON.parse(
      buildUserMessage(
        { topicId: 'five-forces', targetDifficulty: 'hard', learnerMastery: 'proficient' },
        ['a prior prompt'],
      ),
    );

    expect(payload.topic.id).toBe('five-forces');
    expect(payload.topic.key_concepts).toContain('Threat of substitutes');
    expect(payload.target_difficulty).toBe('hard');
    expect(payload.learner_mastery).toBe('proficient');
    expect(payload.count).toBe(1);
    expect(payload.avoid).toEqual(['a prior prompt']);
  });

  it('never sends anchor answer keys to the model', () => {
    const payload = JSON.parse(
      buildUserMessage(
        { topicId: 'market-research', targetDifficulty: 'easy', learnerMastery: 'novice' },
        [],
      ),
    );

    for (const q of payload.topic.diagnostic_questions) {
      expect(q).not.toHaveProperty('answer');
      expect(q).not.toHaveProperty('rationale');
    }
  });
});

// ---------------------------------------------------------------------------
// §5.5 — the answer key must not reach the browser
// ---------------------------------------------------------------------------

describe('forBrowser', () => {
  it('strips answer and rationale', () => {
    const safe = forBrowser(validQuestion());
    expect(safe).not.toHaveProperty('answer');
    expect(safe).not.toHaveProperty('rationale');
    expect(JSON.stringify(safe)).not.toContain('Bottom-up evidence');
    expect(safe.prompt).toBe(validQuestion().prompt);
    expect(safe.options).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validateQuestion', () => {
  it('accepts a well-formed question', () => {
    expect(validateQuestion(validQuestion(), context)).toEqual([]);
  });

  it('rejects anything other than four options', () => {
    const three = validQuestion({ options: ['a', 'b', 'c'], answer: 1 });
    expect(validateQuestion(three, context).join()).toMatch(/expected 4 options/);
  });

  it('rejects an out-of-range answer index', () => {
    expect(validateQuestion(validQuestion({ answer: 4 }), context).join()).toMatch(/out of range/);
    expect(validateQuestion(validQuestion({ answer: -1 }), context).join()).toMatch(/out of range/);
  });

  it.each([
    'All of the above',
    'None of the above',
    'Both A and B are correct',
    'I don’t know',
    'none of these apply',
  ])('rejects the forbidden option pattern %j', (bad) => {
    const q = validQuestion({ options: [...validQuestion().options.slice(0, 3), bad] });
    expect(validateQuestion(q, context).join()).toMatch(/forbidden option pattern/);
  });

  it('rejects options that differ only trivially in wording', () => {
    const q = validQuestion({
      options: [
        'Buyer power rises',
        'Buyer power rises.',
        'Supplier power rises',
        'Rivalry falls',
      ],
    });
    expect(validateQuestion(q, context).join()).toMatch(/duplicate or near-identical options/);
  });

  it('rejects a difficulty that is not the one requested', () => {
    const q = validQuestion({ difficulty: 'hard' });
    expect(validateQuestion(q, context).join()).toMatch(/does not match requested medium/);
  });

  it('rejects a rationale too thin to justify the key', () => {
    expect(validateQuestion(validQuestion({ rationale: 'Because.' }), context).join()).toMatch(
      /rationale too short/,
    );
  });

  it('rejects an empty option', () => {
    const q = validQuestion({ options: ['a valid option', '   ', 'another', 'and another'] });
    expect(validateQuestion(q, context).join()).toMatch(/empty option text/);
  });

  it('collects every failure rather than stopping at the first', () => {
    const bad = validQuestion({ options: ['x', 'y'], answer: 9, rationale: 'no', difficulty: 'easy' });
    expect(validateQuestion(bad, context).length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

describe('duplicate detection', () => {
  it('normalizes case, punctuation and whitespace', () => {
    expect(normalizePrompt('  Which  of the FOLLOWING, exactly?  ')).toBe(
      'which of the following exactly',
    );
  });

  it('scores an identical prompt as 1', () => {
    const p = 'Which of the following is an example of secondary research?';
    expect(promptSimilarity(p, p)).toBe(1);
  });

  it('catches a reworded near-copy of an anchor', () => {
    const anchor = 'Which of the following is an example of secondary research?';
    const reworded = 'Which of the following is an example of secondary research';
    expect(duplicatesAvoided(reworded, [anchor])).toBe(anchor);
  });

  it('lets a genuinely different prompt through', () => {
    const anchor = 'Which of the following is an example of secondary research?';
    const different =
      'A founder must estimate obtainable market share for a niche B2B tool in year one.';
    expect(duplicatesAvoided(different, [anchor])).toBeNull();
  });

  it('rejects a generated question that restates an anchor', () => {
    const anchor = anchorQuestions('market-research')[0]!;
    const q = validQuestion({ prompt: anchor.prompt, difficulty: 'easy' });
    const reasons = validateQuestion(q, {
      targetDifficulty: 'easy',
      avoid: [anchor.prompt],
    });
    expect(reasons.join()).toMatch(/duplicates a prompt already seen/);
  });
});

describe('validateQuestions', () => {
  it('rejects the batch when the envelope topic_id is wrong', async () => {
    const { client } = stubClient([
      {
        stop_reason: 'end_turn',
        parsed_output: {
          topic_id: 'pestel', // grounded in the wrong anchor
          verification_passed: true,
          questions: [validQuestion()],
        },
      },
    ]);
    const result = await generateQuestions({
      topicId: 'market-research',
      targetDifficulty: 'medium',
      learnerMastery: 'developing',
      client,
      context: 'post',
    });

    expect(result.questions).toHaveLength(0);
    expect(result.failures[0]!.reason).toMatch(/topic_id pestel does not match requested/);
  });

  it('rejects a second question that duplicates the first in the same batch', () => {
    const first = validQuestion({ id: 'a' });
    const second = validQuestion({ id: 'b' });

    const { accepted, rejected } = validateQuestions([first, second], context);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reasons.join()).toMatch(/duplicates a prompt already seen/);
  });

  it('keeps the good questions when only some fail', () => {
    const good = validQuestion();
    const bad = validQuestion({ id: 'bad', answer: 7, prompt: 'A completely unrelated scenario.' });

    const { accepted, rejected } = validateQuestions([good, bad], context);
    expect(accepted.map((q) => q.id)).toEqual(['market-research-gen-1']);
    expect(rejected).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// avoid list
// ---------------------------------------------------------------------------

describe('buildAvoidList', () => {
  it('always retains the anchors, which the post form must never repeat', () => {
    const anchors = ['anchor one', 'anchor two', 'anchor three'];
    const served = Array.from({ length: 60 }, (_, i) => `served ${i}`);

    const avoid = buildAvoidList(anchors, served);
    expect(avoid).toHaveLength(AVOID_LIMIT);
    for (const anchor of anchors) expect(avoid).toContain(anchor);
  });

  it('drops the oldest served prompts when trimming', () => {
    const served = Array.from({ length: 60 }, (_, i) => `served ${i}`);
    const avoid = buildAvoidList(['anchor'], served);

    expect(avoid).toContain('served 59');
    expect(avoid).not.toContain('served 0');
  });

  it('deduplicates an anchor that also appears in served history', () => {
    const avoid = buildAvoidList(['shared prompt'], ['shared prompt', 'other']);
    expect(avoid).toEqual(['shared prompt', 'other']);
  });

  it('stays under the cap for a fresh learner', () => {
    expect(buildAvoidList(['a', 'b', 'c'], [])).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Retry and fallback policy (§5.1 / §4), with a stubbed client — no network
// ---------------------------------------------------------------------------

type ParseResult = {
  stop_reason: string;
  parsed_output: unknown;
  stop_details?: { category: string } | null;
};

function stubClient(responses: ParseResult[]) {
  const calls: unknown[] = [];
  let index = 0;
  return {
    calls,
    client: {
      messages: {
        parse: async (params: unknown) => {
          calls.push(params);
          const next = responses[Math.min(index, responses.length - 1)]!;
          index += 1;
          return next;
        },
      },
    } as never,
  };
}

const okResponse = (questions: GeneratedQuestion[]): ParseResult => ({
  stop_reason: 'end_turn',
  parsed_output: { topic_id: 'market-research', verification_passed: true, questions },
});

const failedVerification: ParseResult = {
  stop_reason: 'end_turn',
  parsed_output: {
    topic_id: 'market-research',
    verification_passed: false,
    questions: [validQuestion()],
  },
};

describe('generateQuestions', () => {
  const base = {
    topicId: 'market-research',
    targetDifficulty: 'medium' as const,
    learnerMastery: 'developing' as const,
  };

  it('returns validated questions on the first attempt', async () => {
    const { client, calls } = stubClient([okResponse([validQuestion()])]);
    const result = await generateQuestions({ ...base, client });

    expect(result.questions).toHaveLength(1);
    expect(result.usedFallback).toBe(false);
    expect(result.attempts).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('retries exactly once when verification_passed is false', async () => {
    const { client, calls } = stubClient([failedVerification, okResponse([validQuestion()])]);
    const result = await generateQuestions({ ...base, client });

    expect(calls).toHaveLength(2);
    expect(result.attempts).toBe(2);
    expect(result.usedFallback).toBe(false);
    expect(result.failures[0]!.reason).toMatch(/verification_passed was not true/);
  });

  it('never trusts verification_passed on its own — validation still rejects', async () => {
    // Flag says true, but the question carries a forbidden option.
    const cheating = validQuestion({
      options: [...validQuestion().options.slice(0, 3), 'All of the above'],
    });
    const { client } = stubClient([okResponse([cheating])]);
    const result = await generateQuestions({ ...base, client });

    expect(result.usedFallback).toBe(true);
    expect(result.failures.map((f) => f.reason).join()).toMatch(/forbidden option pattern/);
  });

  it('falls back to an unseen anchor in the adaptive context so a learner is never blocked', async () => {
    const { client, calls } = stubClient([failedVerification]);
    const result = await generateQuestions({ ...base, client, context: 'adaptive' });

    expect(calls).toHaveLength(2);
    expect(result.usedFallback).toBe(true);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.id).toBe('mr-q2'); // the medium anchor
    expect(result.questions[0]!.difficulty).toBe('medium');
  });

  it('does NOT fall back to an anchor in the post context', async () => {
    // §4: a post item must never repeat a pre item, and the pre form is the
    // anchors. Returning zero is correct here; the caller scores out of fewer.
    const { client } = stubClient([failedVerification]);
    const result = await generateQuestions({ ...base, client, context: 'post' });

    expect(result.usedFallback).toBe(false);
    expect(result.questions).toHaveLength(0);
    expect(result.failures).toHaveLength(2);
  });

  it('treats a refusal as a failed attempt', async () => {
    const { client } = stubClient([
      { stop_reason: 'refusal', parsed_output: null, stop_details: { category: 'cyber' } },
    ]);
    const result = await generateQuestions({ ...base, client, context: 'post' });

    expect(result.failures[0]!.reason).toMatch(/model refused: cyber/);
    expect(result.questions).toHaveLength(0);
  });

  it('treats a truncated response as a failed attempt rather than a partial batch', async () => {
    const { client } = stubClient([{ stop_reason: 'max_tokens', parsed_output: null }]);
    const result = await generateQuestions({ ...base, client, context: 'post' });

    expect(result.failures[0]!.reason).toMatch(/truncated at max_tokens/);
  });

  it('treats a missing parsed_output as a failed attempt', async () => {
    const { client } = stubClient([{ stop_reason: 'end_turn', parsed_output: null }]);
    const result = await generateQuestions({ ...base, client, context: 'post' });

    expect(result.failures[0]!.reason).toMatch(/structured output missing/);
  });

  it('passes the served history into avoid, capped', async () => {
    const served = Array.from({ length: 60 }, (_, i) => `previously served prompt number ${i}`);
    const { client, calls } = stubClient([okResponse([validQuestion()])]);
    await generateQuestions({ ...base, client, servedPrompts: served });

    const sent = JSON.parse((calls[0] as { messages: { content: string }[] }).messages[0]!.content);
    expect(sent.avoid.length).toBeLessThanOrEqual(AVOID_LIMIT);
    expect(sent.avoid).toContain('previously served prompt number 59');
  });

  it('does not set temperature — rejected with a 400 on current models', async () => {
    const { client, calls } = stubClient([okResponse([validQuestion()])]);
    await generateQuestions({ ...base, client });

    const params = calls[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('top_p');
    expect(params).not.toHaveProperty('top_k');
  });
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe('GenerationResponseSchema', () => {
  it('accepts the §3 worked example from the spec', () => {
    const workedExample = {
      topic_id: 'five-forces',
      verification_passed: true,
      questions: [
        {
          id: 'five-forces-gen-1',
          type: 'mcq',
          difficulty: 'medium',
          generative_strategy: 'apply',
          prompt:
            'A new food-delivery app enters a market where switching apps is free and instant for both riders and customers. Which of Porter’s forces is intensified by this, and what is the effect?',
          options: [
            'Threat of new entrants falls, protecting margins',
            'Buyer power rises, putting downward pressure on prices and margins',
            'Supplier power rises, raising input costs',
            'Competitive rivalry falls, because switching is easy',
          ],
          answer: 1,
          rationale:
            'Zero switching costs let customers move freely between apps, which increases buyer bargaining power; firms must compete on price and promotions, squeezing margins.',
        },
      ],
    };

    expect(GenerationResponseSchema.safeParse(workedExample).success).toBe(true);
  });

  it('rejects an unknown generative_strategy', () => {
    const bad = {
      topic_id: 'x',
      verification_passed: true,
      questions: [{ ...validQuestion(), generative_strategy: 'guessing' }],
    };
    expect(GenerationResponseSchema.safeParse(bad).success).toBe(false);
  });
});
