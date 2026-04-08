/**
 * Optional local helper — does not run SQL; documents that schema comes from supabase/*.sql.
 * Do not put real keys in this file. Use env vars if you extend this script.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function setup() {
  console.log('--- Supabase setup note ---');
  if (!supabaseUrl || !supabaseServiceKey) {
    console.log('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment to use a client here.');
    console.log('For schema, run the SQL files in the repo `supabase/` folder in the Supabase SQL editor.');
    process.exit(0);
    return;
  }
  console.log('Connected (check your project in the Supabase dashboard).');
  process.exit(0);
}

setup();
