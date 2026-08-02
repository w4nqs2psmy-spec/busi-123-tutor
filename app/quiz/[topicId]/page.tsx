import Link from 'next/link';
import { notFound } from 'next/navigation';

import { allTopics, getTopic, learningOutcomes } from '@/lib/topics';

import QuizClient from './quiz-client';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return allTopics().map((t) => ({ topicId: t.id }));
}

export default async function QuizPage({ params }: { params: Promise<{ topicId: string }> }) {
  const { topicId } = await params;

  let topic;
  try {
    topic = getTopic(topicId);
  } catch {
    notFound();
  }

  return (
    <main>
      <p className="sub">
        <Link href="/">← All topics</Link>
      </p>
      <h1>{topic.title}</h1>
      <p className="sub">
        {learningOutcomes(topic).join(' · ')} — {topic.description}
      </p>

      <h2>Adaptive quiz</h2>
      <p className="sub">
        Difficulty is chosen by <span className="mono">nextDifficulty()</span> from your current
        rating; answers are graded on the server.
      </p>

      <QuizClient topicId={topic.id} />
    </main>
  );
}
