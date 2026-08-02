import { NextResponse } from 'next/server';

import { resolveLearnerId, UnauthenticatedError } from '@/lib/auth';
import { nextQuestion } from '@/lib/quiz';

export const dynamic = 'force-dynamic';

/**
 * Serve the next adaptive question.
 *
 * The response body is browser-safe by construction — `nextQuestion` returns a
 * shape with no `answer` and no `rationale` (quiz-generation-prompt.md §5.5).
 */
export async function POST(request: Request) {
  let learnerId: string;
  try {
    learnerId = resolveLearnerId();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  let topicId: string;
  try {
    const body = (await request.json()) as { topicId?: unknown };
    if (typeof body.topicId !== 'string' || body.topicId.length === 0) {
      return NextResponse.json({ error: 'topicId is required' }, { status: 400 });
    }
    topicId = body.topicId;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await nextQuestion({ learnerId, topicId });

    if (!result.question) {
      return NextResponse.json(
        {
          error: 'generation failed and no fallback was available',
          targetDifficulty: result.targetDifficulty,
        },
        { status: 503 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[quiz/next]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
