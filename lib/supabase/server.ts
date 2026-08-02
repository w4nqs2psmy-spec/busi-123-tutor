import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase clients.
 *
 * The `server-only` import above is load-bearing: it makes the build fail if
 * this module is ever pulled into a client component, which is what keeps the
 * service-role key out of the browser bundle.
 *
 * Two clients, deliberately separate:
 *
 *   serviceRoleClient() — bypasses RLS. Every write in this app goes through
 *     it, because learners hold no INSERT/UPDATE anywhere (see
 *     supabase/migrations/0001_initial_schema.sql). It is also the only way to
 *     read `items` and `item_keys`, which have RLS on and no policy at all.
 *
 *   anonClient() — respects RLS. Use it for reads that should be constrained
 *     to the signed-in learner's own rows.
 *
 * Never hand a serviceRoleClient result straight to a page: strip answer keys
 * with forBrowser() first (quiz-generation-prompt.md §5.5).
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.local.example to .env.local and fill it in.`,
    );
  }
  return value;
}

let cachedServiceRole: SupabaseClient | undefined;

/** Full-access client. Bypasses RLS — never expose its results unfiltered. */
export function serviceRoleClient(): SupabaseClient {
  cachedServiceRole ??= createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cachedServiceRole;
}

/** RLS-respecting client for reads scoped to the current learner. */
export function anonClient(): SupabaseClient {
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false } },
  );
}

export type SupabaseHealth =
  | { ok: true; detail: string }
  | { ok: false; detail: string };

/**
 * Actually reach the database, rather than checking that variables exist.
 *
 * The presence-only version of this check reported "configured" while the URL
 * pointed at a hostname that did not resolve and the service-role key was
 * rejected — it gave confidence it had not earned. A real query is the only
 * answer worth showing.
 */
export const HEALTH_TIMEOUT_MS = 2500;

export async function checkSupabaseHealth(): Promise<SupabaseHealth> {
  if (!process.env['NEXT_PUBLIC_SUPABASE_URL']) {
    return { ok: false, detail: 'NEXT_PUBLIC_SUPABASE_URL is not set' };
  }
  if (!process.env['SUPABASE_SERVICE_ROLE_KEY']) {
    return { ok: false, detail: 'SUPABASE_SERVICE_ROLE_KEY is not set' };
  }

  // Hard deadline. This runs in a page render, so an unreachable backend must
  // degrade to a message rather than block the response indefinitely.
  const timeout = new Promise<SupabaseHealth>((resolve) =>
    setTimeout(
      () => resolve({ ok: false, detail: `no response in ${HEALTH_TIMEOUT_MS}ms` }),
      HEALTH_TIMEOUT_MS,
    ).unref?.(),
  );

  const probe = (async (): Promise<SupabaseHealth> => {
    try {
      // A real GET, not `head: true`. A HEAD response carries no body, so
      // PostgREST errors arrive with an empty `message` and the page ends up
      // reporting "unreachable —" with no reason. `count: 'exact'` still gives
      // the row count via the Content-Range header.
      const { count, error } = await serviceRoleClient()
        .from('topics')
        .select('id', { count: 'exact' })
        .limit(1);

      if (error) {
        const detail = [error.message, error.code, error.hint]
          .filter((part) => typeof part === 'string' && part.length > 0)
          .join(' · ');
        return { ok: false, detail: detail || 'request rejected, no detail returned' };
      }
      return { ok: true, detail: `${count ?? 0} topics seeded` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'unreachable' };
    }
  })();

  return Promise.race([probe, timeout]);
}
