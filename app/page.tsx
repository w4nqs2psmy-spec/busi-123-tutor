import { resolveLearnerId, UnauthenticatedError } from '@/lib/auth';
import { buildRows, buildTopicCards, selectHero } from '@/lib/browse-model';
import { EMPTY_BROWSE_DATA, getBrowseData, type BrowseData } from '@/lib/db/dashboard';
import { allTopics } from '@/lib/topics';

import BrowseShell from './_browse/BrowseShell';

// Mastery changes on every answer, so this must not be cached.
export const dynamic = 'force-dynamic';

/**
 * Browse page.
 *
 * Server component: reads the seven real topics from `topics.json` and this
 * learner's real mastery, builds the view model, and hands it to the client
 * shell. No mock data — when learner data cannot be read the page still
 * renders every topic as unstarted and says why.
 */
export default async function Home() {
  const topics = allTopics();

  let data: BrowseData = EMPTY_BROWSE_DATA;
  let notice: string | null = null;

  try {
    const learnerId = resolveLearnerId();
    data = await getBrowseData(learnerId);
    if (data.error) {
      notice = `Showing content only — your progress could not be loaded (${data.error}).`;
    }
  } catch (error) {
    notice =
      error instanceof UnauthenticatedError
        ? `Not signed in, so no progress is shown. ${error.message}`
        : 'Your progress could not be loaded.';
  }

  const cards = buildTopicCards(topics, data.masteryByTopic);
  const hero = selectHero(cards);
  const rows = buildRows(cards);

  return (
    <BrowseShell hero={hero} rows={rows} displayName={data.displayName} notice={notice} />
  );
}
