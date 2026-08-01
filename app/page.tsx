import {
  ITEM_RATING,
  INITIAL_RATING,
  TARGET_SUCCESS,
  expectedScore,
  nextDifficulty,
  type Difficulty,
} from '@/lib/mastery';
import { allTopics, learningOutcomes, specVersion } from '@/lib/topics';
import { isSupabaseConfigured } from '@/lib/supabase/server';

// topics.json is read from disk per request, so keep this off the static path.
export const dynamic = 'force-dynamic';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** Ratings worth showing: the prior, both switch points, and each ideal. */
const SAMPLE_RATINGS = [INITIAL_RATING, 1347.2, 1523.8, 1647.2, 1823.8, 1947.2];

export default function Home() {
  const topics = allTopics();
  const anchorCount = topics.reduce((n, t) => n + t.diagnostic_questions.length, 0);

  return (
    <main>
      <h1>BUSI1620 Adaptive Tutor</h1>
      <p className="sub">
        Business Creation Project · Level 6 · content spec{' '}
        <span className="mono">v{specVersion()}</span>
      </p>
      <p className="sub">
        <span className="status">
          Supabase {isSupabaseConfigured() ? 'configured' : 'not configured'}
        </span>
      </p>

      <h2>Content anchors</h2>
      <p className="sub">
        {topics.length} topics · {anchorCount} anchor questions · read live from{' '}
        <span className="mono">topics.json</span>
      </p>

      <ul className="card-list">
        {topics.map((topic) => (
          <li key={topic.id} className="card">
            <div className="card-head">
              <span className="card-title">{topic.title}</span>
              {learningOutcomes(topic).map((lo) => (
                <span key={lo} className="lo">
                  {lo}
                </span>
              ))}
            </div>
            <p>{topic.description}</p>
            <div className="meta">
              <span>{topic.key_concepts.length} key concepts</span>
              {DIFFICULTIES.map((d) => {
                const n = topic.diagnostic_questions.filter((q) => q.difficulty === d).length;
                return (
                  <span key={d}>
                    <span className={`dot ${d}`} />
                    {n} {d}
                  </span>
                );
              })}
              <span className="mono">{topic.id}</span>
            </div>
          </li>
        ))}
      </ul>

      <h2>Item selection</h2>
      <p className="sub">
        Live output of <span className="mono">nextDifficulty()</span> — the sole authority for
        what gets served. Bands are display-only.
      </p>

      <table>
        <thead>
          <tr>
            <th>Rating</th>
            <th>p(easy)</th>
            <th>p(medium)</th>
            <th>p(hard)</th>
            <th>Serves</th>
            <th>Miss vs {TARGET_SUCCESS.toFixed(2)}</th>
          </tr>
        </thead>
        <tbody>
          {SAMPLE_RATINGS.map((rating) => {
            const served = nextDifficulty(rating);
            const miss = Math.abs(expectedScore(rating, ITEM_RATING[served]) - TARGET_SUCCESS);
            return (
              <tr key={rating}>
                <td className="num">{rating.toFixed(1)}</td>
                {DIFFICULTIES.map((d) => (
                  <td key={d} className="num">
                    {expectedScore(rating, ITEM_RATING[d]).toFixed(3)}
                  </td>
                ))}
                <td>
                  <span className={`dot ${served}`} />
                  {served}
                </td>
                <td className="num">{miss.toFixed(3)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="note">
        Switch points sit at 1523.8 (easy→medium) and 1823.8 (medium→hard). The worst miss across
        the buckets&rsquo; span is ≈0.166, at those boundaries — inherent to three fixed buckets,
        not a defect.
      </p>

      <footer>
        Phase 1 walking skeleton. Mastery and generator modules are wired and tested; the
        diagnostic, adaptive quiz and learner dashboard are not built yet.
      </footer>
    </main>
  );
}
