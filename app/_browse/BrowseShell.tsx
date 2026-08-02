'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { BrowseRow, TopicCard } from '@/lib/browse-model';

import styles from './browse.module.css';
import Hero from './Hero';
import Row from './Row';
import Detail from './Detail';

/**
 * Interactive shell for the browse page.
 *
 * The server component owns data fetching; everything stateful — hover, the
 * detail modal, and My List — lives here.
 *
 * My List is intentionally in-memory only. There is no table for it in the
 * schema, so persisting it would mean inventing storage. It resets on reload,
 * and the footnote on the page says so rather than letting the UI imply
 * otherwise.
 */
export default function BrowseShell({
  hero,
  rows,
  displayName,
  notice,
}: {
  hero: TopicCard | null;
  rows: BrowseRow[];
  displayName: string | null;
  notice: string | null;
}) {
  const [active, setActive] = useState<TopicCard | null>(null);
  const [myList, setMyList] = useState<ReadonlySet<string>>(() => new Set());

  const toggleList = useCallback((id: string) => {
    setMyList((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Escape closes the modal; without this the only way out is the scrim.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const initials = useMemo(() => {
    if (!displayName) return '··';
    return displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }, [displayName]);

  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>BUSI</span>
          <span className={styles.brandNum}>1620</span>
        </div>
        <nav className={styles.links}>
          <button type="button" className={`${styles.link} ${styles.linkOn}`}>
            Home
          </button>
          <button type="button" className={styles.link}>
            My List
          </button>
          <button type="button" className={styles.link}>
            Progress
          </button>
        </nav>
        <div className={styles.avatar} aria-hidden>
          {initials}
        </div>
      </header>

      {hero && (
        <Hero
          topic={hero}
          inList={myList.has(hero.id)}
          onOpen={() => setActive(hero)}
          onList={() => toggleList(hero.id)}
        />
      )}

      <main className={styles.rows}>
        {notice && <p className={styles.notice}>{notice}</p>}

        {rows.map((row) => (
          <Row
            key={row.key}
            row={row}
            myList={myList}
            onOpen={setActive}
            onList={toggleList}
          />
        ))}

        <p className={styles.footnote}>
          Mastery is read live from your attempt history · My List is not persisted (no table for
          it yet)
        </p>
      </main>

      {active && (
        <Detail
          topic={active}
          inList={myList.has(active.id)}
          onList={() => toggleList(active.id)}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}
