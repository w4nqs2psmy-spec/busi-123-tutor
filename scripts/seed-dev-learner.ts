/**
 * Create a real auth user + profile so the quiz loop can be exercised before
 * magic-link auth exists.
 *
 * `attempts.learner_id` is a foreign key to `profiles(id)` -> `auth.users(id)`,
 * so a made-up uuid will be rejected by the database. This creates an actual
 * user via the admin API; the `on_auth_user_created` trigger writes the
 * matching profile row.
 *
 * Run with:  npm run seed:learner
 * Then copy the printed id into .env.local as DEV_LEARNER_ID.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!url || !serviceRoleKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Run via `npm run seed:learner`, which loads .env.local.',
  );
  process.exit(1);
}

const EMAIL = process.env['DEV_LEARNER_EMAIL'] ?? 'dev-learner@busi1620.local';

const sb = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main(): Promise<void> {
  const { data: created, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    email_confirm: true,
    user_metadata: { display_name: 'Dev Learner' },
  });

  let learnerId: string;

  if (error) {
    // Already seeded — find the existing user rather than failing.
    const { data: list, error: listError } = await sb.auth.admin.listUsers();
    if (listError) throw new Error(`could not create or list users: ${listError.message}`);

    const existing = list.users.find((u) => u.email === EMAIL);
    if (!existing) throw new Error(`createUser failed and ${EMAIL} not found: ${error.message}`);

    learnerId = existing.id;
    console.log(`Reusing existing dev learner (${EMAIL})`);
  } else {
    learnerId = created.user.id;
    console.log(`Created dev learner (${EMAIL})`);
  }

  // The trigger should have made the profile; make sure, and mark it clearly.
  const { error: profileError } = await sb
    .from('profiles')
    .upsert(
      { id: learnerId, display_name: 'Dev Learner', role: 'learner', cohort: 'dev' },
      { onConflict: 'id' },
    );
  if (profileError) throw new Error(`profile upsert failed: ${profileError.message}`);

  const { count } = await sb
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('id', learnerId);

  console.log(`profiles row present: ${count === 1 ? 'yes' : 'NO'}`);
  console.log('\nAdd this line to .env.local:\n');
  console.log(`DEV_LEARNER_ID=${learnerId}\n`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
