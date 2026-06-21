-- ============================================================================
-- Reunite — Storage policy for the public "memories" bucket
-- ----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS:
--   The app uploads optional photos/video into Supabase Storage bucket
--   "memories" before sealing a letter. Storage has Row-Level Security (RLS)
--   on the internal table `storage.objects`. Without an INSERT policy that the
--   upload satisfies, every upload fails with:
--       "new row violates row-level security policy"
--
-- SECURITY MODEL (intentional):
--   - The bucket is PUBLIC for reads, but every file lives under an UNGUESSABLE
--     random folder path (see randomFolder() in src/lib/media.ts). Only someone
--     holding the exact reveal link can construct the URL.
--   - We deliberately add NO select / list policy, so nobody can ENUMERATE the
--     bucket and discover other people's files.
--   - We allow INSERT only. (Paths are unique per seal, so no UPDATE/upsert.)
--
-- HOW TO APPLY:
--   Supabase Dashboard → SQL Editor → paste ALL of this → Run.
--   You should see "Success. No rows returned."
--
-- NOTE: do NOT `alter table storage.objects ... enable row level security` from
--   the SQL editor — that table is owned by Supabase, so it errors with
--   "42501: must be owner of table objects". RLS is ALREADY on by default;
--   creating policies on it (below) is allowed. Just skip the ALTER line.
-- ============================================================================

-- Remove any earlier hand-made variants so there is exactly ONE clean policy.
drop policy if exists "memories upload by authenticated" on storage.objects;
drop policy if exists "memories insert"                  on storage.objects;
drop policy if exists "memories_insert"                  on storage.objects;

-- The one policy we want: anyone may INSERT a NEW object into the memories
-- bucket. (Role `public` = both anon and signed-in. Hackathon-robust: the
-- upload succeeds regardless of token-refresh timing. Tighten to
-- `to authenticated` after the hackathon for a stricter posture.)
create policy "memories insert"
on storage.objects
for insert
to public
with check ( bucket_id = 'memories' );

-- ---------------------------------------------------------------------------
-- VERIFY (optional): run this after the above. You should see ONE row:
--   policyname = "memories insert", cmd = INSERT, with_check mentions memories
-- ---------------------------------------------------------------------------
-- select policyname, cmd, roles, with_check
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
--   and policyname = 'memories insert';
