-- Allow the Supabase **anon** key (browser + Android) to read/write inbox tables.
-- Same policies as the tail of supabase/schema.sql (idempotent).
-- Run in Supabase → SQL if:
--   • Advisors report rls_disabled_in_public, or
--   • Table Editor shows rows in `messages` but the dashboard Inbox is empty, or
--   • Android logs HTTP 401/403 when posting to `/rest/v1/messages`.
-- RLS with no matching policy returns **zero rows** for SELECT without surfacing an error in the client.
--
-- Prerequisite: tables exist (run schema.sql or setup_complete.sql + messages from schema.sql).

-- devices (Android registers here before inserting messages)
alter table public.devices enable row level security;
drop policy if exists "anon_all_devices" on public.devices;
create policy "anon_all_devices" on public.devices
  for all
  to anon
  using (true)
  with check (true);

-- notification-backed social messages
alter table public.messages enable row level security;
drop policy if exists "anon_all_messages" on public.messages;
create policy "anon_all_messages" on public.messages
  for all
  to anon
  using (true)
  with check (true);

-- orders (linked from parsed notifications)
alter table public.orders enable row level security;
drop policy if exists "anon_all_orders" on public.orders;
create policy "anon_all_orders" on public.orders
  for all
  to anon
  using (true)
  with check (true);

-- native SMS + call log sync
alter table public.sms_messages enable row level security;
drop policy if exists "anon_all_sms_messages" on public.sms_messages;
create policy "anon_all_sms_messages" on public.sms_messages
  for all
  to anon
  using (true)
  with check (true);

alter table public.phone_calls enable row level security;
drop policy if exists "anon_all_phone_calls" on public.phone_calls;
create policy "anon_all_phone_calls" on public.phone_calls
  for all
  to anon
  using (true)
  with check (true);
