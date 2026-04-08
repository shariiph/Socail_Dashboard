-- Run in Supabase → SQL Editor if you see:
-- "Could not find the table 'public.orders' in the schema cache"
-- Safe to run more than once.

create extension if not exists pgcrypto;

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

create index if not exists idx_orders_updated_at on public.orders (updated_at desc);
create index if not exists idx_orders_status on public.orders (status);
