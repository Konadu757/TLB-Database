-- Canonical foundation (100001–100007).
-- This file does not copy those migrations. It points psql at them.
--
-- Run from the repository root (the folder that contains supabase\ and scripts\):
--
--   psql "postgresql://postgres:[DATABASE_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" -v ON_ERROR_STOP=1 -f scripts/apply-canonical-db.sql
--
-- Historical public migrations are conditional. Apply them first only when
-- scripts/apply-canonical-db.md says they are missing.
--
-- The Supabase SQL editor does not understand \i. Paste each migration file
-- there by hand, using the order in scripts/apply-canonical-db.md.
--
-- 100006 leaves anon EXECUTE on public.create_invite and public.accept_invite.
-- 100007 does not revoke that grant. See docs/operations/client-runbook.md.

\set ON_ERROR_STOP on
\i supabase/migrations/20260928_100001_core_identity.sql
\i supabase/migrations/20260928_100002_master_data.sql
\i supabase/migrations/20260928_100003_inventory_ledger.sql
\i supabase/migrations/20260928_100004_documents_audit_rls.sql
\i supabase/migrations/20260928_100005_ledger_post_and_document_numbers.sql
\i supabase/migrations/20260928_100006_access_control.sql
\i supabase/migrations/20260928_100007_app_catalog.sql
