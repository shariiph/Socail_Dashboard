-- Admin auth and audit tables for dashboard security hardening.
-- Run this in Supabase SQL editor using a privileged role.

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  salt text not null,
  is_active boolean not null default true,
  totp_enabled boolean not null default false,
  totp_secret_enc text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_logs (
  id bigserial primary key,
  event_type text not null,
  success boolean not null,
  detail text,
  ip_address text,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_logs_occurred_at
  on public.admin_audit_logs (occurred_at desc);

create table if not exists public.admin_security_settings (
  key text primary key,
  value jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.admin_security_settings (key, value)
values ('allowed_ips', '[]'::jsonb)
on conflict (key) do nothing;

-- RLS: anon/authenticated have no policies (deny). service_role bypasses RLS (dashboard server).
alter table public.admin_users enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.admin_security_settings enable row level security;

-- Optional bootstrap admin from env values (replace placeholders first)
-- insert into public.admin_users (username, password_hash, salt)
-- values ('shariiph', '<hash>', '<salt>');

