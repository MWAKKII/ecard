-- The application accesses Postgres only through Prisma as the database owner.
-- Supabase's Data API is not used, but new Supabase projects grant anon and
-- authenticated roles access to public tables by default. Without RLS those
-- roles could read or modify application data with the anon key.
--
-- The table owner (the Prisma connection) bypasses RLS unless FORCE ROW LEVEL
-- SECURITY is set, so these statements protect the Data API without changing
-- application behavior. No public policies are intentionally added: every
-- anon/authenticated request must be denied.
DO $$
DECLARE
  relation_name text;
BEGIN
  FOR relation_name IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated',
      relation_name
    );
  END LOOP;
END
$$;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Apply the same restriction to tables created by future Prisma migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
