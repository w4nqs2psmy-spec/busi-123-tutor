import { describe, expect, it, vi } from 'vitest';

import {
  K,
  K_BASELINE,
  applyAttempt,
  initialMastery,
  masteryBand,
  masteryProbability,
  seedFromBaseline,
  type Difficulty,
} from './mastery';

// The repo module imports `server-only`, which throws outside a server
// component graph. Stub it so the data layer can be unit tested.
vi.mock('server-only', () => ({}));

const repo = await import('./db/quiz-repo.js');

// ---------------------------------------------------------------------------
// A minimal PostgREST-shaped fake. Records every call so we can assert on the
// exact rows written — the point of these tests is what lands in the database.
// ---------------------------------------------------------------------------

interface TableStub {
  select?: unknown;
  insertError?: { code?: string; message: string } | null;
  upsertError?: { message: string } | null;
}

function makeClient(tables: Record<string, TableStub>) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];

  const client = {
    from(table: string) {
      const stub = tables[table] ?? {};
      const builder: Record<string, unknown> = {};

      const terminal = (result: unknown) => Promise.resolve(result);

      builder['insert'] = (payload: unknown) => {
        calls.push({ table, op: 'insert', payload });
        const err = stub.insertError ?? null;
        const chain = {
          select: () => terminal({ data: err ? null : stub.select, error: err }),
          then: (r: (v: unknown) => unknown) => terminal({ data: null, error: err }).then(r),
        };
        return chain;
      };

      builder['upsert'] = (payload: unknown) => {
        calls.push({ table, op: 'upsert', payload });
        return terminal({ data: null, error: stub.upsertError ?? null });
      };

      builder['delete'] = () => {
        calls.push({ table, op: 'delete' });
        return { in: () => terminal({ data: null, error: null }) };
      };

      builder['select'] = () => {
        calls.push({ table, op: 'select' });
        const chain: Record<string, unknown> = {};
        for (const m of ['eq', 'order', 'limit']) {
          chain[m] = () => chain;
        }
        chain['maybeSingle'] = () => terminal({ data: stub.select ?? null, error: null });
        chain['then'] = (r: (v: unknown) => unknown) =>
          terminal({ data: stub.select ?? [], error: null }).then(r);
        return chain;
      };

      return builder;
    },
  };

  return { client: client as never, calls };
}

const itemRow = (over: Record<string, unknown> = {}) => ({
  id: 'item-uuid-1',
  topic_id: 'market-research',
  difficulty: 'hard' as Difficulty,
  options: ['a', 'b', 'c', 'd'],
  item_keys: { answer: 1, rationale: 'Because the keyed option triangulates both sources.' },
  ...over,
});

// ---------------------------------------------------------------------------
// The decision: baseline K
// ---------------------------------------------------------------------------

describe('baseline calibration (K_BASELINE)', () => {
  const anchors = (o: [boolean, boolean, boolean]) => [
    { difficulty: 'easy' as const, outcome: o[0] },
    { difficulty: 'medium' as const, outcome: o[1] },
    { difficulty: 'hard' as const, outcome: o[2] },
  ];

  it('separates 0/3 from 3/3, which K=40 could not', () => {
    const zero = seedFromBaseline(anchors([false, false, false]));
    const perfect = seedFromBaseline(anchors([true, true, true]));

    expect(zero.state.band).toBe('novice');
    expect(perfect.state.band).toBe('developing');
    expect(zero.state.masteryProb).toBeCloseTo(0.326, 3);
    expect(perfect.state.masteryProb).toBeCloseTo(0.688, 3);
  });

  it('deliberately does not promote 3/3 to proficient on three items', () => {
    expect(seedFromBaseline(anchors([true, true, true])).state.band).not.toBe('proficient');
  });

  it('keeps the middle outcomes in developing, which is honest', () => {
    expect(seedFromBaseline(anchors([true, false, false])).state.band).toBe('developing');
    expect(seedFromBaseline(anchors([true, true, false])).state.band).toBe('developing');
  });

  it('leaves the adaptive learning rate untouched', () => {
    expect(K).toBe(40);
    expect(K_BASELINE).toBe(96);
    // The §3 worked example runs on the adaptive K and must not move.
    expect(applyAttempt(initialMastery(), { difficulty: 'hard', outcome: true }).ratingAfter)
      .toBeCloseTo(1533.96, 2);
  });

  it('lowering K would have made it worse, not better', () => {
    const spread = (k: number) =>
      seedFromBaseline(anchors([true, true, true]), k).state.masteryProb -
      seedFromBaseline(anchors([false, false, false]), k).state.masteryProb;

    expect(spread(10)).toBeLessThan(spread(40));
    expect(spread(40)).toBeLessThan(spread(K_BASELINE));
  });
});

// ---------------------------------------------------------------------------
// persistGeneratedQuestions
// ---------------------------------------------------------------------------

const question = {
  id: 'market-research-gen-1',
  type: 'mcq' as const,
  difficulty: 'hard' as const,
  generative_strategy: 'apply' as const,
  prompt: 'A defensible SOM estimate for a niche B2B tool requires what?',
  options: ['a', 'b', 'c', 'd'],
  answer: 2,
  rationale: 'Triangulating top-down sizing with bottom-up reachability is the defensible route.',
};

describe('persistGeneratedQuestions', () => {
  it('writes the item and its key to separate tables', async () => {
    const { client, calls } = makeClient({
      items: { select: [{ id: 'item-uuid-1', difficulty: 'hard' }] },
      item_keys: {},
    });

    const persisted = await repo.persistGeneratedQuestions(
      { topicId: 'market-research', learnerId: 'learner-1', questions: [question] },
      client,
    );

    expect(persisted[0]!.id).toBe('item-uuid-1');

    const itemInsert = calls.find((c) => c.table === 'items' && c.op === 'insert');
    const row = (itemInsert!.payload as Record<string, unknown>[])[0]!;
    expect(row['source_ref']).toBe('market-research-gen-1');
    expect(row['created_for']).toBe('learner-1');
    // The answer key must not be on the items row.
    expect(row).not.toHaveProperty('answer');
    expect(row).not.toHaveProperty('rationale');

    const keyInsert = calls.find((c) => c.table === 'item_keys' && c.op === 'insert');
    const key = (keyInsert!.payload as Record<string, unknown>[])[0]!;
    expect(key).toEqual({
      item_id: 'item-uuid-1',
      answer: 2,
      rationale: question.rationale,
    });
  });

  it('deletes the orphaned item when the key insert fails', async () => {
    const { client, calls } = makeClient({
      items: { select: [{ id: 'item-uuid-1', difficulty: 'hard' }] },
      item_keys: { insertError: { message: 'boom' } },
    });

    await expect(
      repo.persistGeneratedQuestions(
        { topicId: 'market-research', learnerId: 'learner-1', questions: [question] },
        client,
      ),
    ).rejects.toThrow(/failed to persist item keys/);

    // An item with no key is ungradeable — it must not survive.
    expect(calls.some((c) => c.table === 'items' && c.op === 'delete')).toBe(true);
  });

  it('is a no-op for an empty batch', async () => {
    const { client, calls } = makeClient({});
    expect(
      await repo.persistGeneratedQuestions(
        { topicId: 'market-research', learnerId: 'learner-1', questions: [] },
        client,
      ),
    ).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// recordAttempt — grading, attempts row, mastery cache
// ---------------------------------------------------------------------------

describe('recordAttempt', () => {
  it('grades against item_keys, not against anything the client sent', async () => {
    const { client, calls } = makeClient({
      items: { select: itemRow() },
      attempts: {},
      learner_topic_mastery: { select: null },
    });

    const graded = await repo.recordAttempt(
      { learnerId: 'learner-1', itemId: 'item-uuid-1', selected: 1, context: 'adaptive' },
      client,
    );

    expect(graded.correct).toBe(true);
    expect(graded.duplicate).toBe(false);

    const attempt = (
      calls.find((c) => c.table === 'attempts' && c.op === 'insert')!.payload as Record<string, unknown>
    );
    expect(attempt['correct']).toBe(true);
    expect(attempt['response']).toEqual({ selected: 1 });
    expect(attempt['context']).toBe('adaptive');
    expect(attempt['difficulty']).toBe('hard');
  });

  it('marks a wrong answer wrong even when the learner picked confidently', async () => {
    const { client } = makeClient({
      items: { select: itemRow() },
      attempts: {},
      learner_topic_mastery: { select: null },
    });

    const graded = await repo.recordAttempt(
      { learnerId: 'learner-1', itemId: 'item-uuid-1', selected: 3, context: 'adaptive' },
      client,
    );
    expect(graded.correct).toBe(false);
    expect(graded.ratingAfter).toBeLessThan(graded.ratingBefore);
  });

  it('applies the §3 Elo update and writes both rating columns', async () => {
    const { client, calls } = makeClient({
      items: { select: itemRow() },
      attempts: {},
      learner_topic_mastery: { select: null },
    });

    const graded = await repo.recordAttempt(
      { learnerId: 'learner-1', itemId: 'item-uuid-1', selected: 1, context: 'adaptive' },
      client,
    );

    // Hard item, correct, from the 1500 prior.
    expect(graded.ratingBefore).toBe(1500);
    expect(graded.ratingAfter).toBeCloseTo(1533.96, 2);

    const attempt = calls.find((c) => c.table === 'attempts')!.payload as Record<string, number>;
    expect(attempt['rating_before']).toBe(1500);
    expect(attempt['rating_after']).toBeCloseTo(1533.96, 2);
  });

  it('refreshes the mastery cache consistently with the rating', async () => {
    const { client, calls } = makeClient({
      items: { select: itemRow() },
      attempts: {},
      learner_topic_mastery: { select: null },
    });

    await repo.recordAttempt(
      { learnerId: 'learner-1', itemId: 'item-uuid-1', selected: 1, context: 'adaptive' },
      client,
    );

    const cache = calls.find((c) => c.table === 'learner_topic_mastery' && c.op === 'upsert')!
      .payload as Record<string, unknown>;

    expect(cache['attempts']).toBe(1);
    expect(cache['mastery_prob']).toBeCloseTo(masteryProbability(cache['rating'] as number), 12);
    expect(cache['band']).toBe(masteryBand(cache['mastery_prob'] as number, 1));
    // One attempt is below the confidence gate.
    expect(cache['band']).toBe('provisional');
  });

  it('writes the attempt BEFORE touching mastery, so the constraint can guard', async () => {
    const { client, calls } = makeClient({
      items: { select: itemRow() },
      attempts: {},
      learner_topic_mastery: { select: null },
    });

    await repo.recordAttempt(
      { learnerId: 'learner-1', itemId: 'item-uuid-1', selected: 1, context: 'adaptive' },
      client,
    );

    const attemptIdx = calls.findIndex((c) => c.table === 'attempts' && c.op === 'insert');
    const masteryIdx = calls.findIndex((c) => c.table === 'learner_topic_mastery' && c.op === 'upsert');
    expect(attemptIdx).toBeLessThan(masteryIdx);
  });

  it('[F19] does not re-apply mastery on a duplicate submit', async () => {
    const { client, calls } = makeClient({
      items: { select: itemRow() },
      attempts: { insertError: { code: '23505', message: 'duplicate key' } },
      learner_topic_mastery: { select: { rating: 1533.96, attempts: 1 } },
    });

    const graded = await repo.recordAttempt(
      { learnerId: 'learner-1', itemId: 'item-uuid-1', selected: 1, context: 'adaptive' },
      client,
    );

    expect(graded.duplicate).toBe(true);
    expect(graded.ratingBefore).toBe(graded.ratingAfter);
    expect(calls.some((c) => c.table === 'learner_topic_mastery' && c.op === 'upsert')).toBe(false);
  });

  it('refuses an item that has no answer key rather than guessing', async () => {
    const { client } = makeClient({ items: { select: itemRow({ item_keys: null }) } });

    await expect(
      repo.recordAttempt(
        { learnerId: 'learner-1', itemId: 'item-uuid-1', selected: 0, context: 'adaptive' },
        client,
      ),
    ).rejects.toThrow(/no answer key/);
  });

  it('rejects an out-of-range selection', async () => {
    const { client } = makeClient({ items: { select: itemRow() } });

    for (const selected of [-1, 4, 1.5]) {
      await expect(
        repo.recordAttempt(
          { learnerId: 'learner-1', itemId: 'item-uuid-1', selected, context: 'adaptive' },
          client,
        ),
      ).rejects.toThrow(/out of range/);
    }
  });

  it('reports a stale cache as replayable rather than silently succeeding', async () => {
    const { client } = makeClient({
      items: { select: itemRow() },
      attempts: {},
      learner_topic_mastery: { select: null, upsertError: { message: 'conn reset' } },
    });

    await expect(
      repo.recordAttempt(
        { learnerId: 'learner-1', itemId: 'item-uuid-1', selected: 1, context: 'adaptive' },
        client,
      ),
    ).rejects.toThrow(/replayable from attempts/);
  });
});

// ---------------------------------------------------------------------------
// getMasteryState
// ---------------------------------------------------------------------------

describe('getMasteryState', () => {
  it('returns the 1500 prior for a learner with no history', async () => {
    const { client } = makeClient({ learner_topic_mastery: { select: null } });
    const state = await repo.getMasteryState('learner-1', 'market-research', client);

    expect(state.rating).toBe(1500);
    expect(state.attempts).toBe(0);
    expect(state.band).toBe('provisional');
  });

  it('rederives the cache from the stored rating rather than trusting it', async () => {
    const { client } = makeClient({
      learner_topic_mastery: { select: { rating: 1647.2, attempts: 12 } },
    });
    const state = await repo.getMasteryState('learner-1', 'market-research', client);

    expect(state.masteryProb).toBeCloseTo(0.7, 3);
    expect(state.band).toBe('proficient');
  });
});
