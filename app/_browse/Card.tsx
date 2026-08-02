'use client';

import { useRouter } from 'next/navigation';
import { Check, ChevronRight, Clock, Play, Plus, Sparkles } from 'lucide-react';

import { describeAge, type TopicCard } from '@/lib/browse-model';

import styles from './browse.module.css';

/**
 * Poster card.
 *
 * Typography-led by design: gradient, grain, an oversized dimmed learning-
 * outcome watermark, and the title. No icons on the poster itself — icons
 * appear only in the hover bar.
 */
export default function Card({
  topic,
  tall,
  reason,
  inList,
  onOpen,
  onList,
}: {
  topic: TopicCard;
  tall?: boolean;
  reason?: boolean;
  inList: boolean;
  onOpen: () => void;
  onList: () => void;
}) {
  const router = useRouter();
  const pct = Math.round(topic.masteryProb * 100);

  return (
    <div
      className={`${styles.card} ${tall ? styles.cardTall : ''}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div
        className={styles.poster}
        style={{ background: `linear-gradient(155deg, ${topic.accent[0]}, ${topic.accent[1]})` }}
      >
        <div className={styles.posterGrain} aria-hidden />
        <div className={styles.posterSheen} aria-hidden />
        <span className={styles.posterWatermark} aria-hidden>
          {topic.learningOutcomes.join('')}
        </span>

        <div className={styles.posterTop}>
          <span className={styles.genre}>{topic.genre}</span>
        </div>

        <div className={styles.posterTitle}>{topic.title}</div>

        {topic.started && (
          <div className={styles.posterBar}>
            <i style={{ width: `${pct}%`, background: topic.bandColor }} />
          </div>
        )}
      </div>

      <div className={styles.hovercard}>
        <div className={styles.hoverbar}>
          <button
            type="button"
            className={`${styles.mini} ${styles.miniPlay}`}
            aria-label={`${topic.started ? 'Resume' : 'Start'} ${topic.title}`}
            onClick={(e) => {
              e.stopPropagation();
              router.push(topic.href);
            }}
          >
            <Play size={15} fill="#0A0A0C" strokeWidth={0} />
          </button>
          <button
            type="button"
            className={styles.mini}
            aria-label={inList ? 'Remove from My List' : 'Add to My List'}
            onClick={(e) => {
              e.stopPropagation();
              onList();
            }}
          >
            {inList ? <Check size={15} /> : <Plus size={15} />}
          </button>
          <button
            type="button"
            className={`${styles.mini} ${styles.miniR}`}
            aria-label={`Details for ${topic.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            <ChevronRight size={15} />
          </button>
        </div>

        <div className={styles.hovertitle}>{topic.title}</div>

        <div className={styles.hovermeta}>
          <span style={{ color: topic.bandColor, fontWeight: 600 }}>{topic.bandLabel}</span>
          <span className={styles.dot} />
          <span>{topic.learningOutcomes.join(' · ')}</span>
          <span className={styles.dot} />
          <span>3 ep</span>
        </div>

        <div className={styles.hovertag}>
          {reason ? (
            <>
              <Sparkles size={12} /> Lowest mastery — practise this next
            </>
          ) : topic.started ? (
            <>
              <Clock size={12} /> {describeAge(topic.daysSinceActive)}
            </>
          ) : (
            <>
              <Sparkles size={12} /> New series
            </>
          )}
        </div>
      </div>
    </div>
  );
}
