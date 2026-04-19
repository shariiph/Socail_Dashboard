-- Enable RLS on dashboard-only tables (fixes Supabase Security Advisor: "RLS Disabled in Public").
-- Run in Supabase → SQL Editor after admin_auth_schema.sql.
--
-- The app reads/writes these tables only with SUPABASE_SERVICE_ROLE_KEY (service_role).
-- In Supabase, service_role bypasses RLS, so server routes keep working.
-- anon / authenticated get no policies here → default deny for PostgREST.

alter table if exists public.admin_users enable row level security;
alter table if exists public.admin_audit_logs enable row level security;
alter table if exists public.admin_security_settings enable row level security;
