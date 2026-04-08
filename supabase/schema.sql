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
  archived boolean not null default false,
  notes text not null default '',

  created_at timestamptz not null default now()
);

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
create index if not exists idx_messages_order_ref on public.messages (order_ref);
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

create index if not exists idx_phone_calls_occurred on public.phone_calls (occurred_at desc);
create index if not exists idx_phone_calls_device on public.phone_calls (device_id);

-- IMPORTANT:
-- The current dashboard uses the Supabase "anon" key directly from the browser.
-- For it to work, ensure RLS is disabled OR add policies that allow SELECT/UPDATE/INSERT
-- for the anon role on these tables.

