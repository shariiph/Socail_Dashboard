-- Run once in Supabase SQL editor if sms_messages was created before contact_name existed.
alter table public.sms_messages add column if not exists contact_name text;
