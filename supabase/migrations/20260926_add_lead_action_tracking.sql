-- Formalise lead action tracking fields already used by the application.
-- Safe to run against environments where these columns already exist.

alter table public.leads
  add column if not exists last_action_type text,
  add column if not exists last_action_at timestamptz,
  add column if not exists call_requested_at timestamptz,
  add column if not exists pdf_email_requested_at timestamptz,
  add column if not exists pdf_downloaded_at timestamptz,
  add column if not exists updated_at timestamptz;
