# E-Card

Event invitation and guest-card platform built with Next.js 16, Prisma 7,
PostgreSQL (Supabase), Sharp, Tesseract OCR and PDFKit.

## What is in the app

- Organizer accounts, event requests, pricing and payment records.
- Guest lists, CSV import, private QR tokens and QR check-in.
- Card-design templates with placeholder detection and server-side PNG rendering.
- Guest card delivery through the optional Meta WhatsApp Cloud API.
- Owner reports (CSV/PDF) and audited administrator overrides.
- Private Supabase Storage for uploaded design images. Generated guest PNGs
  remain a private, regenerable cache in Postgres.

## Local development

Requirements: Node.js **20.9+**, npm, and a Supabase project.

```bash
copy .env.example .env       # Windows; use cp on macOS/Linux
# Fill in DATABASE_URL, DIRECT_URL, JWT_SECRET and the SUPABASE_* values first:
# the postinstall step loads prisma7.config.ts.
npm ci
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Open <http://localhost:3000>. The app works over HTTP locally, but browser
camera access requires HTTPS (or `localhost`, which browsers treat as secure).

For local schema changes, use `npm run db:migrate`; for the production database,
use `npm run db:migrate:deploy` as described in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type-check |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | Create/apply a development migration |
| `npm run db:migrate:deploy` | Apply committed migrations to a database |
| `npm run db:migrate:status` | Show migration status |
| `npm run db:seed` | Seed pricing tiers and the admin account |
| `npm run db:test` | Verify the database connection and row counts |
| `npm run test:qr` | QR utility checks |
| `npm run test:whatsapp` | Optional WhatsApp delivery check |

## Production

The production target is **Vercel + Supabase Postgres + private Supabase
Storage**. The complete dashboard settings, environment variables, migration
order, domain/HTTPS setup, firewall/logging recommendations and verification
steps are in [DEPLOYMENT.md](./DEPLOYMENT.md).

Do not commit `.env` files or Supabase service/secret keys. Only
`.env.example` is tracked.

## Security notes

- Remote production database connections must use verified TLS
  (`sslmode=verify-full`); the app refuses to start otherwise.
- Supabase's Data API is not used. The RLS migration enables row-level security
  and revokes the `anon`/`authenticated` grants on every public table.
- Session tokens are HTTP-only cookies. In production they are `Secure` and
  `SameSite=Lax`.
- Uploaded design files are served only through the authenticated
  `/api/templates/[id]/image` route.
