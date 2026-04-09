-- Social Inbox schema
-- Run in Supabase SQL editor (replace nothing; this script is idempotent).

create extension if not exists pgcrypto;

-- Devices table
create table if not exists public.devices (
  id text primary key,
  device_name text,
  last_seen timestamptz not null default now(),
  is_online boolean not null default true,
  created_at timestamptz not null default now()
);

-- Messages table
-- message_fingerprint is used for deduplication on inserts from Android.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),

  message_fingerprint text unique not null,
  notification_key text,
  conversation_id text,
  received_at timestamptz,

  sender_name text,
  message_title text,
  message_text text not null,
  app_source text,

  device_id text references public.devices(id),

  -- Order hints (extracted from message text)
  order_ref text,
  order_status_hint text,
  amount numeric,
  currency text,

  -- Dashboard state
  is_read boolean not null default false,
  is_actioned boolean not null default false,
  archived boolean not null default false,
  notes text not null default '',

  created_at timestamptz not null default now()
);

-- Existing projects: CREATE TABLE IF NOT EXISTS does not alter an old table, so new columns
-- are missing and later CREATE INDEX fails (e.g. column "order_ref" does not exist).
alter table public.messages add column if not exists message_fingerprint text;
alter table public.messages add column if not exists notification_key text;
alter table public.messages add column if not exists conversation_id text;
alter table public.messages add column if not exists received_at timestamptz;
alter table public.messages add column if not exists sender_name text;
alter table public.messages add column if not exists message_title text;
alter table public.messages add column if not exists app_source text;
alter table public.messages add column if not exists device_id text;
alter table public.messages add column if not exists order_ref text;
alter table public.messages add column if not exists order_status_hint text;
alter table public.messages add column if not exists amount numeric;
alter table public.messages add column if not exists currency text;
alter table public.messages add column if not exists is_read boolean not null default false;
alter table public.messages add column if not exists is_actioned boolean not null default false;
alter table public.messages add column if not exists archived boolean not null default false;
alter table public.messages add column if not exists notes text not null default '';

-- Orders table
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),

  order_ref text unique not null,
  status text,

  amount numeric,
  currency text,

  last_message_fingerprint text,
  last_message_text text,
  last_message_at timestamptz,

  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.orders add column if not exists last_message_fingerprint text;
alter table public.orders add column if not exists last_message_text text;
alter table public.orders add column if not exists last_message_at timestamptz;
alter table public.orders add column if not exists status text;
alter table public.orders add column if not exists amount numeric;
alter table public.orders add column if not exists currency text;
alter table public.orders add column if not exists updated_at timestamptz not null default now();
alter table public.orders add column if not exists created_at timestamptz not null default now();

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- Helpful indexes
create index if not exists idx_messages_created_at on public.messages (created_at desc);
create index if not exists idx_messages_received_at on public.messages (received_at desc);
create index if not exists idx_messages_conversation on public.messages (conversation_id, received_at desc);
create index if not exists idx_messages_order_ref on public.messages (order_ref);
create index if not exists idx_messages_app_source_sender_time on public.messages (app_source, sender_name, received_at desc);
create index if not exists idx_messages_is_actioned on public.messages (is_actioned) where is_actioned = false;
create unique index if not exists idx_messages_fingerprint_unique on public.messages (message_fingerprint) where message_fingerprint is not null;
create index if not exists idx_devices_last_seen on public.devices (last_seen desc);
create index if not exists idx_orders_updated_at on public.orders (updated_at desc);
create index if not exists idx_orders_status on public.orders (status);

-- Native SMS (full body from Telephony provider; optional Android sync)
create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  sync_fingerprint text unique not null,
  device_id text references public.devices(id) on delete cascade,
  android_sms_id bigint not null,
  thread_id text,
  address text not null,
  contact_name text,
  body text not null,
  sms_box text not null,
  read_flag boolean not null default false,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (device_id, android_sms_id)
);

alter table public.sms_messages add column if not exists contact_name text;

create index if not exists idx_sms_occurred on public.sms_messages (occurred_at desc);
create index if not exists idx_sms_device on public.sms_messages (device_id);

-- Native call log (from CallLog.Calls)
create table if not exists public.phone_calls (
  id uuid primary key default gen_random_uuid(),
  sync_fingerprint text unique not null,
  device_id text references public.devices(id) on delete cascade,
  android_call_id bigint not null,
  phone_number text not null,
  contact_name text,
  duration_seconds int not null default 0,
  call_type text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (device_id, android_call_id)
);

alter table public.phone_calls add column if not exists contact_name text;

create index if not exists idx_phone_calls_occurred on public.phone_calls (occurred_at desc);
create index if not exists idx_phone_calls_device on public.phone_calls (device_id);

-- Row Level Security (Supabase Advisors: avoid rls_disabled_in_public).
-- Dashboard + Android use the anon key; these policies allow that role full access.
-- Tighten later with auth + scoped policies if you stop using anon in the client.

alter table public.devices enable row level security;
drop policy if exists "anon_all_devices" on public.devices;
create policy "anon_all_devices" on public.devices
  for all
  to anon
  using (true)
  with check (true);

alter table public.messages enable row level security;
drop policy if exists "anon_all_messages" on public.messages;
create policy "anon_all_messages" on public.messages
  for all
  to anon
  using (true)
  with check (true);

alter table public.orders enable row level security;
drop policy if exists "anon_all_orders" on public.orders;
create policy "anon_all_orders" on public.orders
  for all
  to anon
  using (true)
  with check (true);

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

