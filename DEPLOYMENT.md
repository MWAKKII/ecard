# Production Deployment: Vercel + Supabase

This document is the deployment runbook for the E-Card app. It assumes the
existing application structure: Next.js 16 on Vercel, Prisma 7 against Supabase
Postgres, and private Supabase Storage for uploaded card-design images.

## Architecture and production assumptions

| Component | Production choice | Why |
| --- | --- | --- |
| Application | Vercel, Next.js framework preset | Native Next.js hosting, HTTPS and function logs |
| Function region | `dub1` (Dublin) | The linked Supabase project is in `eu-west-1` (Ireland) |
| Database | Supabase Postgres through the shared Supavisor pooler | IPv4 reachable from Vercel; no direct-IPv6 dependency |
| Runtime DB URL | Transaction pooler, port `6543` | Vercel functions are short-lived and scale horizontally |
| Migration DB URL | Session pooler, port `5432` | Prisma Migrate needs one stable session |
| Uploaded design files | Private Supabase Storage bucket `ecard-assets` | Keeps large base64 image payloads out of Postgres |
| Generated guest PNGs | Existing Postgres `Guest.cardPng` cache | They are private, regenerable and tied to the guest row |
| Authentication | Existing app JWT + `auth_token` HTTP-only cookie | No Supabase Auth configuration is required |
| App error logs | Structured JSON via `instrumentation.ts` + route logs | Captured by Vercel Logs and optional Log Drains |
| Database API protection | RLS enabled, `anon`/`authenticated` grants revoked | The app uses Prisma as the owner role, not the Supabase Data API |

The checked-in `vercel.json` pins the framework, install/build commands and
`dub1`. If you create the Supabase project in a different region, change the
`regions` array before deploying. Keeping the app and database close matters for
login, card rendering and every guest operation.

## 0. Deployment checklist

Work through these in order:

1. [ ] Create the Supabase project, save the database password and note its
       region.
2. [ ] Create the private Storage bucket.
3. [ ] Copy the pooler URLs and API keys.
4. [ ] Apply migrations and seed the first admin.
5. [ ] Add all Vercel environment variables.
6. [ ] Import the Git repository into Vercel and deploy.
7. [ ] Add the custom domain and verify HTTPS.
8. [ ] Verify health, login, upload, camera and logs.
9. [ ] Configure backups and optional firewall/log-drain settings.

## 1. Supabase dashboard settings

### 1.1 Create the project

In the Supabase Dashboard:

1. **New project**.
2. Choose the organization.
3. **Project name**: for example `ecard-production`.
4. **Database password**: generate a long random password and save it in your
   password manager. Do not put it in Git.
5. **Region**: choose the region closest to your users. For this deployment the
   existing project is `aws-1-eu-west-1`; use the same region if possible.
6. **Plan**: choose the plan that covers your expected database size, backup
   retention and log retention.
7. Create the project and wait until provisioning finishes.

After creation, note the **project reference** (the subdomain in
`https://<ref>.supabase.co`).

### 1.2 Get the two database connection strings

Open **Connect** at the top of the project. Do not build the pooler hostname by
hand: Supabase chooses a pooler host that cannot be derived from the region.

Copy these two strings:

| Purpose | Supabase option | Port | Env var |
| --- | --- | --- | --- |
| Prisma migrations | **Session pooler** | `5432` | `DIRECT_URL` |
| Running app / Vercel | **Transaction pooler** | `6543` | `DATABASE_URL` |

Replace `[YOUR-PASSWORD]` with the database password, percent-encoding reserved
characters (`&`, `#`, `?`, spaces, etc.). Keep the username exactly as Supabase
shows it (`postgres.<project-ref>` for the shared pooler).

Append the verified-TLS settings to both URLs:

```text
&sslmode=verify-full&sslrootcert=certs/supabase-prod-ca-2021.crt
```

For the transaction-pooler URL, also add `pgbouncer=true` before `sslmode`:

```text
postgresql://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:6543/postgres?pgbouncer=true&sslmode=verify-full&sslrootcert=certs/supabase-prod-ca-2021.crt
```

Final production values look like this (replace every placeholder):

```dotenv
DIRECT_URL="postgresql://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:5432/postgres?sslmode=verify-full&sslrootcert=certs/supabase-prod-ca-2021.crt"
DATABASE_URL="postgresql://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:6543/postgres?pgbouncer=true&sslmode=verify-full&sslrootcert=certs/supabase-prod-ca-2021.crt"
```

The app validates remote production URLs and refuses to start without verified
TLS. Production accepts only `sslmode=verify-full`; `sslmode=require` encrypts but
does not verify the server certificate. Never use `sslmode=no-verify` or
`uselibpqcompat=true`. The Supabase root CA is already committed at
`certs/supabase-prod-ca-2021.crt`; its SHA-256 fingerprint is documented in
`.env.example`. `next.config.ts` includes that directory in the serverless trace.

A long-lived Node server may use the session URL for `DATABASE_URL` instead of
the transaction URL. Vercel/serverless should use the transaction URL.

### 1.3 Database SSL and network settings

In **Project Settings -> Database -> SSL Configuration** (labels vary slightly by
dashboard version):

- Enable **Enforce SSL** / reject non-SSL connections.
- Download the root certificate and compare it with
  `certs/supabase-prod-ca-2021.crt`. Do not commit a replacement without updating
  every environment.
- Keep SSL verification enabled in the app.

In **Database -> Network Restrictions**:

- The shared pooler is IPv4-reachable; this is why the app uses it from Vercel.
- If Network Restrictions are disabled, the database is reachable by anyone with
  valid credentials, but TLS verification and the password still protect it.
- If you enable restrictions, Vercel functions do not have a single stable egress
  IP on all plans. Either use Vercel Secure Compute/static egress (where
  available) or leave the restriction off. Do not add a random IP allowlist that
  will break deployments.

In **Database -> Settings**, leave the pooler **Pool Size** at its default
initially. The app sets its own Prisma pool to one connection per production
function instance. Increase the Supabase pool only after monitoring real
connection pressure; every Supabase service also consumes connections.

### 1.4 API URL and server key

Open **Project Settings -> API** (or **API Keys** in newer dashboards):

- Copy the **Project URL**, for example `https://abcdefgh.supabase.co`.
- Copy the **service_role key** or, in projects using the newer key system, a
  **secret key** (`sb_secret_...`). Store it as `SUPABASE_SERVICE_ROLE_KEY`.
- The publishable/anon key is **not** used by this app. Do not put it in Vercel
  and do not replace the secret with it.

The service/secret key bypasses Storage RLS and must remain server-only. Never
name it `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` or put it in client code. In
Vercel, mark it as a **Sensitive** environment variable.

### 1.5 Create the private Storage bucket

Open **Storage -> Buckets -> New Bucket**:

| Setting | Value |
| --- | --- |
| Bucket name | `ecard-assets` |
| Public bucket | **OFF** (must remain private) |
| File size limit | `5 MB` (the app enforces a 4 MB decoded-image limit) |
| Allowed MIME types | `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/avif` |

Create the bucket, then confirm it is marked private. The app uploads through
`SUPABASE_SERVICE_ROLE_KEY`; no browser ever talks to Storage directly.

Do **not** add public read policies. The only client-facing image endpoint is:

```text
/api/templates/[id]/image
```

That endpoint authenticates the session and reads the private object on the
server. Because the browser does not call Storage directly, no Storage CORS rule
is needed.

Deleting a design in the admin UI deletes its Storage object on a best-effort
basis. If you delete a template row manually in the Supabase Table Editor, delete
the matching object from the bucket manually or use a Storage lifecycle policy.

### 1.6 Data API, RLS and auth settings

The app does **not** use Supabase Auth or the Supabase Data API (PostgREST). It
uses Prisma directly over the database connection and has its own `users` table,
password hashes and JWT session cookie.

The migration `20261028120000_enable_rls_public_tables` does the following for
every existing `public` table:

- Enables row-level security.
- Revokes all table and sequence privileges from `anon` and `authenticated`.
- Revokes the same privileges by default for tables/sequences created by future
  migrations.

The Prisma connection uses the table-owner role and bypasses RLS, so application
queries continue to work. There are intentionally no public policies: any request
made with the Supabase anon/authenticated key is denied.

Verify it from the Supabase SQL Editor:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
-- Expected: rowsecurity = true for the application tables.

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated');
-- Expected: no rows.
```

In the dashboard:

- Confirm **Table Editor** shows RLS enabled for the application tables.
- Do not add `anon`/`authenticated` policies unless you deliberately start using
  the Data API.
- Optionally disable the Data API entirely under **Project Settings -> API** /
  **Data API** if your plan exposes that toggle. It is extra defense, not a
  substitute for the RLS migration.
- Do not configure Supabase Auth providers for this app. The app’s JWT secret is
  `JWT_SECRET`; Supabase Auth signing keys are unrelated.

Every new public table added later must also have RLS enabled. The default
privilege revocation protects new tables from the Data API, but a future migration
should still include `ENABLE ROW LEVEL SECURITY` to keep the database consistent.

### 1.7 Backups and observability

In **Database -> Backups**:

- Enable the backup schedule available on your plan.
- On a plan with point-in-time recovery, enable PITR before the first production
  migration and keep the retention period long enough for rollback.
- Test a restore into a separate project; a backup you have never restored is not
  a verified backup.

In **Observability**:

- Watch **Database Connections** during the first days after launch.
- Check slow queries and storage usage if card rendering or imports become slow.
- Supabase logs are for the database/Storage; application request and error logs
  are in Vercel.

## 2. Database migration and first admin

Run these commands from the repository root on a trusted machine, with the
production `DIRECT_URL` and `DATABASE_URL` in `.env` (or exported in the shell).
Do not run migrations from the Vercel build command: concurrent deployments can
race, and the build environment is not an appropriate migration runner.

```bash
npm ci

# Optional but recommended: take a Supabase backup/snapshot first.
npm run db:migrate:status
npm run db:migrate:deploy
npm run db:migrate:status

# First production bootstrap only:
# PowerShell: $env:SEED_ADMIN_PASSWORD="..."
# Bash:      SEED_ADMIN_PASSWORD='...' npm run db:seed
npm run db:seed

npm run db:test
```

`prisma7.config.ts` deliberately uses `DIRECT_URL` for migrations, so the
transaction pooler is not asked to run schema commands. The seed script uses
`DATABASE_URL`; either pooler works for the seed, but the session URL is also
fine.

The seed:

- Creates or updates the admin account identified by `SEED_ADMIN_EMAIL` and
  `SEED_ADMIN_USERNAME`.
- Resets that admin’s password to `SEED_ADMIN_PASSWORD`.
- Ensures the two pricing tiers exist and are active.
- Writes a `seed.completed` audit record.

`SEED_ADMIN_PASSWORD` must be at least 12 characters, unique, and not a
placeholder. Do not store it in Vercel if you only run the seed locally/CI. Run
the seed only when you intend to create/update the admin; rerunning it resets the
admin password.

### Creating a migration (development workflow)

1. Start from a database you are allowed to change (a development/staging
   Supabase project, not production).
2. Edit `prisma/schema.prisma`.
3. Create and apply the migration:

   ```bash
   npm run db:migrate -- --name describe_the_change
   ```

4. Read the generated SQL under `prisma/migrations/<timestamp>_.../migration.sql`
   before committing it. For security-sensitive changes, add explicit SQL for
   RLS, grants or indexes.
5. Run `npm run db:generate`, `npx tsc --noEmit` and `npm run build`.
6. Commit the schema and migration folder together, push, then run
   `npm run db:migrate:deploy` against production **before** the deployment that
   depends on the new schema.

Never use `prisma db push` for production: it bypasses the migration history.

### Migration rules

- **Fresh database**: `db:migrate:deploy` then `db:seed`.
- **Existing database**: `db:migrate:status`, then `db:migrate:deploy`; do not
  seed unless you need to create/reset the bootstrap admin.
- **Never** edit the `_prisma_migrations` table or hand-edit migration files that
  have already been applied.
- **Rollback**: Prisma Migrate has no automatic down migrations. Restore the
  Supabase backup/PITR snapshot or write a new forward migration. Do not use
  `migrate resolve` unless you are repairing a known failed migration and have
  verified the schema state.
- Keep migrations additive for zero-downtime deploys (add nullable columns/tables
  first, backfill, then tighten constraints in a later deploy).

## 3. Vercel project configuration

### 3.1 Import the repository

1. In Vercel, **Add New -> Project**.
2. Import the GitHub repository containing this app.
3. **Framework Preset**: Next.js.
4. **Root Directory**: `./` (the repository root).
5. Leave **Build and Output Settings** on the repository defaults; `vercel.json`
   supplies:
   - Install Command: `npm ci`
   - Build Command: `npm run build`
   - Framework: `nextjs`
   - Region: `dub1`
6. **Node.js Version**: Node 22.x (or Node 20.x, at least 20.9.0). The
   `engines` field in `package.json` records the minimum.
7. **Production Branch**: `main`.
8. Deploy after adding the environment variables below.

`npm ci` runs the `postinstall` script (`prisma generate`). That command loads
`prisma7.config.ts`, which reads `DIRECT_URL` (or `DATABASE_URL`). Add the
database variables **before the first build**, or the install/build step will
fail with a missing-database-URL error.

### 3.2 Environment variables

Add these in **Project Settings -> Environment Variables** for the **Production**
environment. Use the exact names; do not add `NEXT_PUBLIC_` to server secrets.

| Name | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Transaction pooler URL, port `6543` | Mark Sensitive; include `pgbouncer=true`, `sslmode=verify-full`, `sslrootcert=...` |
| `DIRECT_URL` | Session pooler URL, port `5432` | Mark Sensitive; used by Prisma Migrate and the build-time Prisma config |
| `JWT_SECRET` | 48+ random bytes, base64url/hex | Mark Sensitive; unique to production, rotating logs out all users |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` | Project URL, no trailing slash required |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role or secret key | Mark Sensitive; never expose to the browser |
| `SUPABASE_STORAGE_BUCKET` | `ecard-assets` | Must match the bucket name exactly |

Generate `JWT_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Optional, only if WhatsApp delivery is being enabled:

| Name | Value |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Meta Cloud API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone-number ID |
| `WHATSAPP_API_VERSION` | Optional Graph API version, default `v23.0` |
| `WHATSAPP_TEMPLATE_NAME` | Approved template with an image header |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Template language, for example `en_US` |
| `WHATSAPP_TEMPLATE_BODY_FIELDS` | Optional comma-separated `guestName,eventTitle` |
| `WHATSAPP_TEST_RECIPIENT` | Optional recipient for `npm run test:whatsapp` |

Mark `WHATSAPP_ACCESS_TOKEN` as Sensitive when set.

Seed-only variables belong in the local shell/CI environment, not Vercel:

```dotenv
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_USERNAME=Mwakki
SEED_ADMIN_PASSWORD=<unique 12+ character password>
```

Do not set `NODE_ENV` or `PORT`; Vercel supplies them.

Use separate Supabase projects for Production and Preview. The app has no tenant
isolation that would make a shared production database safe for arbitrary preview
writes. If you must use one project for previews, restrict writes and do not use
production data. Add the same required variable names to the Preview scope when
you create its project; otherwise preview builds fail when `prisma generate` runs.

After adding or changing an environment variable, trigger a new deployment.
Existing deployments do not pick up variable changes automatically.

### 3.3 Function settings

In **Project Settings -> Functions** (or **Functions -> Settings**):

- **Region**: `dub1`, matching `vercel.json` and the Supabase region.
- **Function Max Duration**: `60 seconds`. The heavy OCR/card/report routes
  export `maxDuration = 60`. Vercel Hobby caps functions at 60 seconds; on Pro
  you can raise both the route exports and this setting if needed.
- **Memory**: `1024 MB` is a good starting point for Sharp, Tesseract OCR and
  PDFKit. Increase only if logs show memory pressure.
- Leave Fluid compute at the plan default (enabled where available). `sharp` and
  `tesseract.js` are Node-native/external packages, so do not switch the app
  routes to the Edge runtime.

Large CSV imports can still exceed 60 seconds. Keep imports comfortably below
the 2,000-row route limit or split them into batches.

### 3.4 Domains and HTTPS

1. **Project Settings -> Domains -> Add Domain**.
2. Add the production hostname, for example `cards.example.com`.
3. Add the apex/`www` variants only if you want them. Choose one primary host and
   redirect the other to it; auth cookies are host-only.
4. Follow Vercel’s DNS instructions (nameservers or the A/CNAME records shown).
5. Leave Vercel’s automatic TLS/SSL enabled and wait for the certificate to
   become active.
6. Visit the domain over `https://`; Vercel serves HTTPS automatically. The app
   also emits HSTS in production.

Camera access for the QR scanner requires a secure context. `https://` works;
`http://localhost` is treated as secure by browsers for local development. A
production build served over plain HTTP will set a `Secure` auth cookie and login
will not persist, so test production-build auth through HTTPS (Vercel) or use
`npm run dev` locally.

### 3.5 Deployment protection and previews

- Use **Standard Protection** for preview deployments if you need to keep them
  private.
- Do **not** enable Vercel Authentication or password protection on the production
  domain unless you configure bypasses for the app’s own browser requests.
  Protecting production would prevent ordinary users from reaching the app.
- Keep preview deployments on separate preview environment variables/Supabase
  projects.
- Enable automatic deployments from `main` only after the production environment
  variables and database migrations are ready.

### 3.6 Vercel Firewall (recommended on plans that support it)

The app’s rate limiter is per process, so it is not a complete defense across
many serverless instances. Add Vercel Firewall rate-limit rules where available:

| Rule | Match | Suggested limit |
| --- | --- | --- |
| Login protection | `POST /api/auth/login` | 60 requests / 15 minutes per IP |
| Signup protection | `POST /api/auth/signup` | 30 requests / 1 hour per IP |
| Broad API protection | `/api/*` | Tune from real traffic; start at 600 requests / minute per IP |
| Import/OCR protection | `POST /api/events/*/guests/import`, `POST /api/admin/templates` | Tune separately; these are expensive routes |

The application still enforces its own login limit (50 IP attempts and 10
identifier attempts per 15 minutes) and signup limit (20 IP attempts per hour).
Do not make the edge rule tighter than legitimate users can tolerate without
testing.

### 3.7 Logs, alerts and log drains

- Open **Project -> Logs** and select **Production**. The app writes structured
  JSON from `instrumentation.ts` and route-level `console.error` messages; search
  for `"level":"error"` or the route path.
- `instrumentation.ts` logs unhandled route/server-component/action errors with
  method, path (query string removed), route type and route path. It never logs
  cookies, request bodies or secrets.
- On plans with **Log Drains**, configure **Settings -> Log Drains** to forward
  production logs to your observability provider. Test the drain with a harmless
  request before relying on it.
- Configure Vercel **Alerts** or an external uptime monitor for:
  - `GET /health` returning `503` or failing to connect.
  - A sustained increase in 5xx responses.
  - Storage upload failures (`Template image storage upload failed`).
- Supabase’s own logs cover database connections and Storage 4xx/5xx errors; use
  them when the app logs a Storage failure.

## 4. Deploy sequence

Use this order to avoid schema/runtime mismatch:

1. Create the Supabase project, bucket and API key.
2. Put the production URLs and secrets in your local `.env` (never commit it).
3. Take a backup/snapshot.
4. Run `npm run db:migrate:deploy` and confirm `npm run db:migrate:status`.
5. Run the seed once, then `npm run db:test`.
6. Add the Vercel environment variables and function settings.
7. Push `main` / trigger the production deployment.
8. Add and verify the custom domain.
9. Run the verification checks below.
10. Configure backups, firewall, log drains and alerts.

### What gets stored where

- **Supabase Storage (`ecard-assets`)**: newly uploaded template/design images,
  referenced as `supabase://ecard-assets/templates/YYYY-MM-DD/<uuid>.<ext>`.
- **Postgres `Guest.cardPng`**: generated personalized PNG cache. This is
  intentionally private and not exposed as a public Storage URL. It is
  regenerated when the design, event title or guest details change.
- **Legacy `CardTemplate.imageUrl` data URLs**: still readable and served through
  the authenticated image endpoint. No bulk conversion is required.

## 5. Verification checklist

Run these from a machine with the production env, and/or against the deployed
domain.

### Local / database checks

```bash
npx tsc --noEmit
npm run lint
npm run build
npm run db:migrate:status
npm run db:test
```

Expected: no TypeScript errors, no lint errors (the existing `<img>` warnings are
non-blocking), a successful production build, `Database schema is up to date!`,
and the expected row counts.

### Health and headers

```bash
curl -i https://YOUR_DOMAIN/health
curl -I https://YOUR_DOMAIN/login
```

Expected from `/health`: HTTP 200 and `database: "up"`. From the headers:

- `Permissions-Policy: camera=(self), microphone=(), geolocation=()`
- `Strict-Transport-Security` (production only)
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy` containing `frame-ancestors 'none'`

### Authentication

1. Open the production domain over HTTPS.
2. Log in with the seeded admin account.
3. In browser DevTools -> Application/Storage -> Cookies, confirm `auth_token`:
   - `HttpOnly` is set.
   - `Secure` is set in production.
   - `SameSite` is `Lax`.
   - Domain is host-only (no explicit parent-domain cookie).
4. Refresh a protected page and confirm the session persists.
5. Log out and confirm the cookie is cleared.

### Storage upload and image serving

1. Sign in as an admin.
2. Go to the admin design upload area and upload a small PNG/JPEG.
3. Confirm the response is successful and the design appears in the admin list.
4. Open the design preview; it must load through
   `/api/templates/<id>/image`, not a public Storage URL.
5. In Supabase Storage, confirm an object exists under
   `ecard-assets/templates/...`. The bucket must remain private.
6. Delete the test design from the admin UI and confirm the Storage object is
   removed.
7. Existing legacy designs (data URLs) must still preview and render.

If `SUPABASE_*` is missing in production, a new upload must fail with HTTP 503
rather than store a base64 image. This is intentional: production should not
silently fall back to database blobs. In local development, the app falls back to
a data URL so the upload flow still works without Storage.

### Camera / QR scanner

1. Open a page that uses the QR scanner on the production HTTPS domain.
2. Grant camera permission when prompted.
3. Scan a test guest QR code and confirm check-in succeeds.
4. If the browser denies access, confirm:
   - The page is HTTPS (not plain HTTP).
   - The `Permissions-Policy` header allows `camera=(self)`.
   - The browser/site permissions have not blocked the camera globally.
   - No extension or iframe is blocking `getUserMedia`.

### Logs

1. Generate a harmless request to `/health`.
2. In Vercel Logs, confirm the request appears.
3. Confirm an application error is logged as structured JSON from
   `instrumentation.ts` or as a route-specific error. Do not send secrets or
   request bodies in test payloads.
4. If a log drain is configured, confirm the event arrives at the provider.

## 6. Secret rotation and incident checklist

- **JWT_SECRET leaked**: rotate it in Vercel, redeploy and accept that all users
  must sign in again.
- **Database password leaked**: reset it in Supabase Database Settings, update
  `DATABASE_URL`/`DIRECT_URL` in Vercel and in your migration environment, then
  redeploy. Revoke old sessions if applicable.
- **Supabase service/secret key leaked**: rotate it in the API Keys settings,
  update Vercel, redeploy, and review Storage/database access logs.
- **WhatsApp token leaked**: revoke/rotate it in Meta Business settings and update
  Vercel.
- **Suspected data exposure**: use Supabase logs, Vercel logs and audit logs to
  determine scope; restore from backup/PITR if data was modified. Do not delete
  logs before capturing evidence.
- Never commit `.env`, service keys or database URLs. `.env` is ignored; only
  `.env.example` is tracked. `.vercelignore` also excludes local `.env*` files
  from CLI deployments.

## 7. Troubleshooting

| Symptom | Check |
| --- | --- |
| Build fails with missing database URL | Add `DIRECT_URL`/`DATABASE_URL` to Vercel before build; `postinstall` runs `prisma generate` and loads `prisma7.config.ts` |
| `PrismaClientInitializationError` / connection timeout | Use the shared pooler, verify the exact host/username from **Connect**, URL-encode the password, and confirm `sslmode=verify-full` |
| `self-signed certificate in certificate chain` | Keep `sslrootcert=certs/supabase-prod-ca-2021.crt`; confirm the cert file is included in the build |
| `too many connections` | Keep the app pool at one; monitor Supabase connections; do not raise the pooler limit blindly |
| `prepared statement already exists` | Keep `pgbouncer=true` on the transaction-pooler URL, or use the session pooler |
| Login works but immediately returns to login | Check you are on HTTPS; production cookies are `Secure`. Check proxy redirects are same-origin |
| Camera prompt never appears | Use HTTPS, check site permissions and the `Permissions-Policy` response header |
| Design upload returns 503 | Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET` in the correct Vercel environment |
| Design upload returns 403 from Storage | Confirm the key is the service/secret key, the bucket is `ecard-assets`, and the bucket name matches the env var |
| Design preview returns 401/404 | Sign in; the image endpoint requires a session. Organizers can only see ACTIVE designs; admins can preview all |
| Data API returns permission denied | Expected: RLS is enabled and anon/authenticated grants are revoked. The app uses Prisma, not the Data API |
| Migration is not applying | Confirm `DIRECT_URL` is the session pooler on port `5432`, not the transaction pooler; run `npm run db:migrate:status` |

## 8. Production dashboard settings summary

Use this as the final audit:

### Supabase

- [ ] Project region matches the Vercel function region as closely as possible.
- [ ] Database password stored in a password manager, not Git.
- [ ] `DIRECT_URL` uses the session pooler, port `5432`.
- [ ] `DATABASE_URL` uses the transaction pooler, port `6543`, with
      `pgbouncer=true`.
- [ ] Both URLs use `sslmode=verify-full` and the committed CA.
- [ ] Database SSL enforcement is on.
- [ ] Network restrictions are understood; Vercel egress is allowed if enabled.
- [ ] Project URL and service/secret key copied to Vercel.
- [ ] Storage bucket `ecard-assets` is **private**.
- [ ] Bucket size/MIME limits are set.
- [ ] No public Storage read policies exist.
- [ ] Data API is not used by the app; RLS and grant revocation are applied.
- [ ] Supabase Auth is not configured for this app.
- [ ] Backups/PITR are enabled and a restore has been tested.
- [ ] Database connection/storage observability is enabled.

### Vercel

- [ ] Framework preset: Next.js.
- [ ] Root directory: repository root.
- [ ] Install command: `npm ci`.
- [ ] Build command: `npm run build`.
- [ ] Node.js 22.x (or 20.9+).
- [ ] Functions region `dub1` (or the region matching Supabase).
- [ ] Function memory/duration appropriate for OCR/card rendering (`1024 MB`,
      `60s` starting point).
- [ ] All production environment variables set before first build.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` marked Sensitive.
- [ ] No `NEXT_PUBLIC_*` server secrets.
- [ ] Preview uses a separate Supabase project or is not used for writes.
- [ ] Production branch `main`.
- [ ] Custom domain added; HTTPS certificate active.
- [ ] Production deployment not blocked by Vercel Authentication/password
      protection.
- [ ] Firewall rate limits configured where available.
- [ ] Logs and optional log drain/alerts configured.
- [ ] `/health`, login, storage upload, image preview and camera flow verified
      after the first deploy.
