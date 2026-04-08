-- Wallet Hub: enable Postgres → Realtime so the web dashboard updates without relying only on polling.
-- Run once in the Supabase SQL editor. If a line errors with "already member of publication", skip that line.

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.devices;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.sms_messages;
alter publication supabase_realtime add table public.phone_calls;

-- Also ensure Realtime can read row changes (Supabase dashboard: Database → Replication).
