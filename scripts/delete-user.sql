-- ============================================================================
-- Manual account deletion (fallback — the admin UI at /admin/users is the
-- preferred way). Run in the Supabase SQL editor.
--
-- Rules enforced here mirror app/api/admin/users/route.ts:
--   * accounts owning events, payments or templates are refused
--     (ON DELETE RESTRICT foreign keys + payments are financial history)
--   * the last ADMIN account is refused
--   * the deletion is written to audit_logs
-- ============================================================================

-- 1) List every account with what each one owns, to find the id/email you want.
SELECT
  u.id,
  u.email,
  u.name,
  u.role,
  u."authorizationStatus",
  u."createdAt",
  (SELECT count(*) FROM events e        WHERE e."ownerId"    = u.id) AS events,
  (SELECT count(*) FROM payments p      WHERE p."userId"     = u.id) AS payments,
  (SELECT count(*) FROM card_templates t WHERE t."createdById" = u.id) AS templates
FROM users u
ORDER BY u."createdAt" DESC;

-- 2) Delete ONE account: put its email between the quotes, then run.
DO $$
DECLARE
  v_email     TEXT := 'PUT-EMAIL-HERE';   -- <--- EDIT THIS LINE
  v_user      users%ROWTYPE;
  v_events    INT;
  v_payments  INT;
  v_templates INT;
  v_admins    INT;
BEGIN
  SELECT * INTO v_user FROM users WHERE email = v_email;
  IF NOT FOUND THEN
    RAISE NOTICE 'No account with email % — nothing to do.', v_email;
    RETURN;
  END IF;

  SELECT count(*) INTO v_events    FROM events         WHERE "ownerId"    = v_user.id;
  SELECT count(*) INTO v_payments  FROM payments       WHERE "userId"     = v_user.id;
  SELECT count(*) INTO v_templates FROM card_templates WHERE "createdById" = v_user.id;

  IF v_events + v_payments + v_templates > 0 THEN
    RAISE EXCEPTION 'Refusing to delete %: owns % event(s), % payment record(s), % template(s).',
      v_email, v_events, v_payments, v_templates;
  END IF;

  IF v_user.role = 'ADMIN' THEN
    SELECT count(*) INTO v_admins FROM users WHERE role = 'ADMIN' AND id <> v_user.id;
    IF v_admins = 0 THEN
      RAISE EXCEPTION 'Refusing to delete %: this is the last ADMIN account.', v_email;
    END IF;
  END IF;

  INSERT INTO audit_logs (id, action, "entityType", "entityId", metadata, "createdAt")
  VALUES (
    gen_random_uuid(),
    'user.deleted',
    'user',
    v_user.id::text,
    jsonb_build_object(
      'email', v_email,
      'name', v_user.name,
      'role', v_user.role,
      'authorizationStatus', v_user."authorizationStatus",
      'via', 'sql-script'
    ),
    now()
  );

  DELETE FROM users WHERE id = v_user.id;
  RAISE NOTICE 'Deleted % (%).', v_email, v_user.id;
END $$;
