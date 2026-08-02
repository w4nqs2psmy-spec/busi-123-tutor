'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The adaptive loop's browser half.
 *
 * This component never receives an answer key. It posts the selected index and
 * learns whether it was right only from the server's reply — grading cannot be
 * spoofed from here, and the rationale does not exist in the bundle before
 * submission (quiz-generation-prompt.md §5.5).
 */

interface ServedQuestion {
  itemId: string;
  topicId: string;
  prompt: string;
  options: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  generativeStrategy: string;
  fromAnchor: boolean;
}

interface Mastery {
  rating: number;
  attempts: number;
  masteryProb: number;
  band: string;
}

interface AnswerResult {
  correct: boolean;
  answer: number;
  rationale: string | null;
  mastery: Mastery;
  ratingBefore: number;
  ratingAfter: number;
  duplicate: boolean;
}

export default function QuizClient({ topicId }: { topicId: string }) {
  const [question, setQuestion] = useState<ServedQuestion | null>(null);
  const [mastery, setMastery] = useState<Mastery | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSelected(null);
    try {
      const res = await fetch('/api/quiz/next', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topicId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setQuestion(body.question);
      setMastery(body.mastery);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load question');
    } finally {
      setLoading(false);
    }
  }, [topicId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (question === null || selected === null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/quiz/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId: question.itemId, selected }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult(body);
      setMastery(body.mastery);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to submit answer');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {mastery && (
        <div className="meta" style={{ marginBottom: '1.25rem' }}>
          <span>
            band <strong>{mastery.band}</strong>
          </span>
          <span className="mono">rating {mastery.rating.toFixed(1)}</span>
          <span className="mono">p {mastery.masteryProb.toFixed(3)}</span>
          <span className="mono">{mastery.attempts} attempts</span>
        </div>
      )}

      {error && (
        <div className="card" role="alert">
          <strong>Error</strong>
          <p style={{ marginBottom: 0 }}>{error}</p>
        </div>
      )}

      {loading && !question && <p className="sub">Loading…</p>}

      {question && (
        <div className="card">
          <div className="card-head">
            <span className={`dot ${question.difficulty}`} />
            <span className="card-title">{question.difficulty}</span>
            <span className="mono" style={{ opacity: 0.65 }}>
              {question.generativeStrategy}
            </span>
            {question.fromAnchor && <span className="lo">anchor fallback</span>}
          </div>

          <p style={{ color: 'var(--fg)', fontSize: '1.02rem', margin: '0.4rem 0 1rem' }}>
            {question.prompt}
          </p>

          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {question.options.map((option, i) => {
              const isKey = result !== null && i === result.answer;
              const isPicked = i === selected;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={result !== null || loading}
                  onClick={() => setSelected(i)}
                  className="option"
                  data-picked={isPicked || undefined}
                  data-key={isKey || undefined}
                >
                  {option}
                </button>
              );
            })}
          </div>

          {result === null ? (
            <button
              type="button"
              className="primary"
              disabled={selected === null || loading}
              onClick={() => void submit()}
            >
              Submit
            </button>
          ) : (
            <div style={{ marginTop: '1rem' }}>
              <p style={{ margin: '0 0 0.4rem', color: 'var(--fg)' }}>
                <strong>{result.correct ? 'Correct' : 'Not quite'}</strong>
                {result.duplicate && ' · already recorded, mastery unchanged'}
                {!result.duplicate && (
                  <span className="mono" style={{ marginLeft: '0.6rem', opacity: 0.75 }}>
                    {result.ratingBefore.toFixed(1)} → {result.ratingAfter.toFixed(1)}
                  </span>
                )}
              </p>
              {result.rationale && <p className="note">{result.rationale}</p>}
              <button type="button" className="primary" onClick={() => void load()}>
                Next question
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
