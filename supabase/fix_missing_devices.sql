-- Run this in Supabase → SQL → New query if the dashboard says
-- "Could not find the table 'public.devices' in the schema cache".
-- Safe to run more than once.

create extension if not exists pgcrypto;

create table if not exists public.devices (
  id text primary key,
  device_name text,
  last_seen timestamptz not null default now(),
  is_online boolean not null default true,
  created_at timestamptz not null default now()
);

-- After running: wait ~1 minute or refresh the dashboard. If the API still says
-- "schema cache", open Supabase Dashboard → Settings → API and check for a schema reload option.
