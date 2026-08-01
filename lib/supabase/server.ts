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

/** True when Supabase is configured, so pages can degrade instead of throwing. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] && process.env['SUPABASE_SERVICE_ROLE_KEY'],
  );
}
