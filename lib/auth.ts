import 'server-only';

/**
 * Resolving the current learner.
 *
 * Real magic-link auth is not built yet, and `attempts.learner_id` is a
 * foreign key to `profiles(id)` -> `auth.users(id)`, so the loop needs a real
 * learner row to write against.
 *
 * Outside production this falls back to `DEV_LEARNER_ID`, which must point at
 * an actual auth user created by `scripts/seed-dev-learner.ts` — not a made-up
 * uuid, or the foreign key rejects it. In production there is no fallback:
 * without a session the request is rejected.
 */

export class UnauthenticatedError extends Error {
  constructor(message = 'No learner session') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

export function resolveLearnerId(): string {
  // TODO(phase-1): read the Supabase session once magic-link auth exists.
  const devLearner = process.env['DEV_LEARNER_ID'];

  if (process.env.NODE_ENV === 'production') {
    throw new UnauthenticatedError(
      'Sign-in is required. DEV_LEARNER_ID is ignored in production.',
    );
  }

  if (!devLearner) {
    throw new UnauthenticatedError(
      'No session and no DEV_LEARNER_ID. Run: npm run seed:learner',
    );
  }

  return devLearner;
}
