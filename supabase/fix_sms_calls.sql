-- ONE-TIME: add native SMS + call log tables (run in Supabase SQL editor if missing)

create extension if not exists pgcrypto;

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
