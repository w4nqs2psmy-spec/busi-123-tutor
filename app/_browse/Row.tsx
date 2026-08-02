'use client';

import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { BrowseRow, TopicCard } from '@/lib/browse-model';

import styles from './browse.module.css';
import Card from './Card';

/** One horizontally scrolling swimlane. */
export default function Row({
  row,
  myList,
  onOpen,
  onList,
}: {
  row: BrowseRow;
  myList: ReadonlySet<string>;
  onOpen: (topic: TopicCard) => void;
  onList: (id: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 1 | -1) => {
    const el = trackRef.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <section className={styles.row}>
      <h2 className={styles.rowTitle}>{row.label}</h2>
      <div className={styles.rowWrap}>
        <button
          type="button"
          className={`${styles.arrow} ${styles.arrowL}`}
          onClick={() => scroll(-1)}
          aria-label="Scroll left"
        >
          <ChevronLeft size={26} />
        </button>

        <div className={styles.track} ref={trackRef}>
          {row.items.map((topic) => (
            <Card
              key={topic.id}
              topic={topic}
              {...(row.tall ? { tall: true } : {})}
              {...(row.reason ? { reason: true } : {})}
              inList={myList.has(topic.id)}
              onOpen={() => onOpen(topic)}
              onList={() => onList(topic.id)}
            />
          ))}
        </div>

        <button
          type="button"
          className={`${styles.arrow} ${styles.arrowR}`}
          onClick={() => scroll(1)}
          aria-label="Scroll right"
        >
          <ChevronRight size={26} />
        </button>
      </div>
    </section>
  );
}
