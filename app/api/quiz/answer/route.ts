import { NextResponse } from 'next/server';

import { resolveLearnerId, UnauthenticatedError } from '@/lib/auth';
import { submitAnswer } from '@/lib/quiz';

export const dynamic = 'force-dynamic';

/**
 * Grade one answer server-side against `item_keys`.
 *
 * The browser sends only the selected index — it never held the key, so it
 * cannot report its own correctness. The rationale is released here, after
 * submission, which is the first moment §5.5 permits it.
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

  let itemId: string;
  let selected: number;
  try {
    const body = (await request.json()) as { itemId?: unknown; selected?: unknown };
    if (typeof body.itemId !== 'string' || body.itemId.length === 0) {
      return NextResponse.json({ error: 'itemId is required' }, { status: 400 });
    }
    if (typeof body.selected !== 'number' || !Number.isInteger(body.selected)) {
      return NextResponse.json({ error: 'selected must be an integer' }, { status: 400 });
    }
    itemId = body.itemId;
    selected = body.selected;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await submitAnswer({ learnerId, itemId, selected });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[quiz/answer]', message);
    const status = /out of range|unknown item/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
