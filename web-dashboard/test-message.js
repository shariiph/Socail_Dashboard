/**
 * Send a test row to `messages` — for local debugging only.
 *
 * Usage:
 *   export NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
 *   node test-message.js
 *
 * Never commit real keys; use env vars only.
 */
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function sendTest() {
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  console.log('Sending test message...');

  const { error } = await supabase.from('messages').insert([
    {
      sender_name: 'CLI test',
      message_text: 'Test message from test-message.js',
      app_source: 'com.whatsapp',
      device_id: 'cli_test',
      message_fingerprint: `cli-${Date.now()}`,
    },
  ]);

  if (error) {
    console.error('Failed:', error.message);
    process.exit(1);
  }
  console.log('Done. Check the dashboard.');
}

sendTest();
