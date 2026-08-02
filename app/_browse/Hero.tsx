'use client';

import Link from 'next/link';
import { Check, Info, Play, Plus } from 'lucide-react';

import { describeAge, type TopicCard } from '@/lib/browse-model';

import styles from './browse.module.css';

/** "Continue where you left off" — the most recently practised unfinished topic. */
export default function Hero({
  topic,
  inList,
  onOpen,
  onList,
}: {
  topic: TopicCard;
  inList: boolean;
  onOpen: () => void;
  onList: () => void;
}) {
  const pct = Math.round(topic.masteryProb * 100);

  return (
    <section className={styles.hero}>
      <div
        className={styles.heroBg}
        style={{
          background: `linear-gradient(115deg, ${topic.accent[0]} 0%, ${topic.accent[1]} 42%, #0A0A0C 78%)`,
        }}
      />
      <div className={styles.heroGrain} aria-hidden />
      <div className={styles.heroVignette} aria-hidden />

      <div className={styles.heroInner}>
        <div className={styles.heroEyebrow}>
          <span>{topic.genre}</span>
          <i />
          <span>{topic.started ? 'Continue watching' : 'New series'}</span>
        </div>

        <h1 className={styles.heroTitle}>{topic.title}</h1>

        <div className={styles.heroMeta}>
          <span className={styles.band} style={{ color: topic.bandColor }}>
            {topic.bandLabel}
          </span>
          <span className={styles.dot} />
          <span>{topic.learningOutcomes.join(' · ')}</span>
          <span className={styles.dot} />
          <span>3 episodes</span>
          <span className={styles.dot} />
          <span>{topic.conceptCount} key concepts</span>
        </div>

        <p className={styles.heroBlurb}>{topic.blurb}</p>

        {topic.started && (
          <div className={styles.heroProgress}>
            <div className={styles.bar}>
              <i style={{ width: `${pct}%`, background: topic.bandColor }} />
            </div>
            <span className={styles.heroProgressLabel}>
              Mastery {pct}% · last practised {describeAge(topic.daysSinceActive).toLowerCase()} ·{' '}
              {topic.attemptCount} {topic.attemptCount === 1 ? 'attempt' : 'attempts'}
            </span>
          </div>
        )}

        <div className={styles.heroActions}>
          <Link href={topic.href} className={`${styles.btn} ${styles.btnPlay}`}>
            <Play size={19} fill="#0A0A0C" strokeWidth={0} />
            {topic.started ? 'Resume' : 'Start'}
          </Link>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onList}>
            {inList ? <Check size={19} /> : <Plus size={19} />}
            My List
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onOpen}>
            <Info size={19} /> Details
          </button>
        </div>
      </div>
    </section>
  );
}
