'use client';

import Link from 'next/link';
import { Check, Play, Plus, X } from 'lucide-react';

import { describeAge, type TopicCard } from '@/lib/browse-model';

import styles from './browse.module.css';

/**
 * Detail modal with the episode list.
 *
 * Episode state is real: an episode is cleared when the learner has answered
 * an item of that difficulty correctly, counted from persisted `attempts`.
 * The prototype faked this from a progress threshold.
 */
export default function Detail({
  topic,
  inList,
  onList,
  onClose,
}: {
  topic: TopicCard;
  inList: boolean;
  onList: () => void;
  onClose: () => void;
}) {
  const pct = Math.round(topic.masteryProb * 100);

  return (
    <div
      className={styles.scrim}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={topic.title}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className={styles.modalX} onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>

        <div
          className={styles.modalHero}
          style={{ background: `linear-gradient(155deg, ${topic.accent[0]}, ${topic.accent[1]})` }}
        >
          <div className={styles.posterGrain} aria-hidden />
          <div className={styles.modalHeroFade} aria-hidden />
          <span className={styles.modalWatermark} aria-hidden>
            {topic.learningOutcomes.join('')}
          </span>

          <div className={styles.modalHeroBody}>
            <span className={styles.genre}>{topic.genre}</span>
            <h3 className={styles.modalTitle}>{topic.title}</h3>
            <div className={styles.modalActions}>
              <Link href={topic.href} className={`${styles.btn} ${styles.btnPlay}`}>
                <Play size={18} fill="#0A0A0C" strokeWidth={0} />
                {topic.started ? 'Resume' : 'Start'}
              </Link>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost} ${styles.btnRound}`}
                onClick={onList}
                aria-label={inList ? 'Remove from My List' : 'Add to My List'}
              >
                {inList ? <Check size={18} /> : <Plus size={18} />}
              </button>
            </div>
          </div>
        </div>

        <div className={styles.modalContent}>
          <div className={styles.modalMeta}>
            <span className={styles.band} style={{ color: topic.bandColor }}>
              {topic.bandLabel}
            </span>
            <span className={styles.dot} />
            <span>{topic.learningOutcomes.join(' · ')}</span>
            <span className={styles.dot} />
            <span>{topic.conceptCount} key concepts</span>
            <span className={styles.dot} />
            <span>{topic.started ? describeAge(topic.daysSinceActive) : 'Not started'}</span>
          </div>

          <p className={styles.modalBlurb}>{topic.blurb}</p>

          {topic.started && (
            <div className={styles.modalProgress}>
              <div className={styles.bar}>
                <i style={{ width: `${pct}%`, background: topic.bandColor }} />
              </div>
              <span>{pct}% mastery</span>
            </div>
          )}

          <h4 className={styles.eplistTitle}>Episodes</h4>
          <ul className={styles.eplist}>
            {topic.episodes.map((ep) => (
              <li key={ep.n} className={styles.ep}>
                <div
                  className={styles.epNum}
                  style={{
                    borderColor: ep.done ? topic.bandColor : '#2C2C31',
                    color: ep.done ? topic.bandColor : '#78767F',
                  }}
                >
                  {ep.done ? <Check size={16} /> : ep.n}
                </div>
                <div className={styles.epBody}>
                  <div className={styles.epName}>
                    Episode {ep.n} · {ep.name}
                  </div>
                  <div className={styles.epDiff}>
                    {ep.difficulty}
                    {ep.attempted > 0
                      ? ` · ${ep.correct}/${ep.attempted} correct`
                      : ' · not attempted yet'}
                  </div>
                </div>
                <Link
                  href={topic.href}
                  className={styles.epPlay}
                  aria-label={`Practise ${ep.difficulty} questions`}
                >
                  <Play size={16} fill="currentColor" strokeWidth={0} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
