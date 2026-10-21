# E-Card Platform Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           E-CARD PLATFORM                                    │
│                          (Next.js 16 + PostgreSQL)                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## High-Level Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   CLIENT SIDE   │         │   SERVER SIDE   │         │   DATABASE      │
│   (Next.js)     │         │   (Next.js)     │         │  (PostgreSQL)   │
└────────┬────────┘         └────────┬────────┘         └────────┬────────┘
         │                           │                           │
         │ HTTP Requests             │ SQL Queries               │
         ├──────────────────────────►├──────────────────────────►│
         │                           │                           │
         │   JSON Responses          │   Query Results           │
         │◄──────────────────────────┤◄──────────────────────────┤
         │                           │                           │
```

## Technology Stack

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Next.js 16.3.5 (App Router)                                               │
│  • React 19.2.8                                                              │
│  • TypeScript 5                                                              │
│  • Tailwind CSS 4                                                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Next.js API Routes                                                        │
│  • Prisma ORM 7.10.0                                                         │
│  • JWT Authentication (lib/jwt.ts on jsonwebtoken)                           │
│  • bcrypt for password hashing                                               │
│  • qrcode (server-side QR token PNG rendering)                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATABASE                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  • PostgreSQL 16                                                             │
│  • Prisma Client (custom output: app/generated/prisma)                      │
│  • Connection via @prisma/adapter-pg                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Database Schema

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATABASE MODELS                                    │
└─────────────────────────────────────────────────────────────────────────────┘

User (users)
├── id: UUID (PK)
├── email: String (unique)
├── username: String? (unique)
├── phone: String? (unique)
├── name: String
├── passwordHash: String
├── role: Role (ADMIN, ORGANIZER, STAFF)
├── authorizationStatus: AuthorizationStatus (PENDING, APPROVED, REJECTED, SUSPENDED)
├── createdAt: DateTime
├── updatedAt: DateTime
└── Relations:
    ├── events: Event[]
    ├── cardTemplates: CardTemplate[]
    ├── payments: Payment[]
    ├── reviewedPayments: Payment[] (reviewedBy)
    ├── checkIns: Attendance[] (checkedInBy)
    └── auditLogs: AuditLog[]

PricingTier ("PricingTier" — model has no @@map)
├── id: UUID (PK)
├── minGuests: Int
├── maxGuests: Int
├── price: Float
├── active: Boolean
└── Relations:
    ├── events: Event[]
    └── payments: Payment[]

CardTemplate (card_templates)
├── id: UUID (PK)
├── title: String
├── description: String?
├── imageUrl: String
├── price: Float
├── status: TemplateStatus (DRAFT, ACTIVE, ARCHIVED)
├── createdById: UUID (FK)
├── createdAt: DateTime
├── updatedAt: DateTime
└── Relations:
    ├── createdBy: User
    └── events: Event[]

Event (events)
├── id: UUID (PK)
├── ownerId: UUID (FK → User)
├── pricingTierId: UUID (FK → PricingTier)
├── cardTemplateId: UUID? (FK → CardTemplate)
├── type: EventType (WEDDING, CORPORATE, OTHER)
├── title: String
├── slug: String (unique)
├── coupleNames: String?          (Wedding events)
├── description: String?
├── location: String?
├── startsAt: DateTime
├── endsAt: DateTime?
├── quotedAmount: Decimal
├── paymentInstructions: String?
├── guestCount: Int
├── status: EventStatus (DRAFT, AUTHORIZED, SUSPENDED, PUBLISHED, CANCELLED, COMPLETED)
├── createdAt: DateTime
├── updatedAt: DateTime
└── Relations:
    ├── owner: User
    ├── pricingTier: PricingTier
    ├── cardTemplate: CardTemplate?
    ├── invitation: Invitation?
    ├── guests: Guest[]
    ├── attendances: Attendance[]
    └── payments: Payment[]

Invitation ("Invitation" — model has no @@map)
├── id: UUID (PK)
├── eventId: UUID (FK → Event, unique)
├── templateTheme: String
├── customMessage: String?
├── accentColor: String
├── createdAt: DateTime
├── updatedAt: DateTime
└── Relations:
    └── event: Event

Guest (guests)
├── id: UUID (PK)
├── eventId: UUID (FK → Event)
├── fullName: String
├── email: String? (optional)
├── phone: String?
├── whatsapp: String?
├── cardType: CardType (STANDARD, PREMIUM)
├── cardStatus: CardStatus (PENDING, GENERATED, SENT)
├── qrToken: String (unique — opaque, server-issued, never in list responses)
├── plusOnes: Int
├── createdAt: DateTime
├── updatedAt: DateTime
└── Relations:
    ├── event: Event
    └── attendances: Attendance[]

Attendance (attendances)
├── id: UUID (PK)
├── eventId: UUID (FK → Event)
├── guestId: UUID (FK → Guest)
├── checkedInById: UUID? (FK → User)
├── status: AttendanceStatus (REGISTERED, CHECKED_IN, NO_SHOW, LEFT)
├── checkedInAt: DateTime?
├── notes: String?
├── createdAt: DateTime
├── updatedAt: DateTime
└── Relations:
    ├── event: Event
    ├── guest: Guest
    └── checkedInBy: User?

Payment (payments)
├── id: UUID (PK)
├── userId: UUID (FK → User)
├── eventId: UUID? (FK → Event)
├── pricingTierId: UUID (FK → PricingTier)
├── amount: Decimal
├── currency: String (default: "TSH")
├── status: PaymentStatus (PENDING, SUBMITTED, VERIFIED, REJECTED)
├── paymentMethod: String?
├── paymentReference: String?
├── submittedAt: DateTime?
├── reviewedAt: DateTime?
├── reviewedById: UUID? (FK → User)
├── rejectionReason: String?
├── createdAt: DateTime
├── updatedAt: DateTime
└── Relations:
    ├── user: User
    ├── event: Event?
    ├── pricingTier: PricingTier
    └── reviewedBy: User? (PaymentReviewedBy)

AuditLog (audit_logs)
├── id: UUID (PK)
├── actorId: UUID? (FK → User)
├── action: String
├── entityType: String
├── entityId: String
├── metadata: Json?
├── ipAddress: String?
├── createdAt: DateTime
└── Relations:
    └── actor: User?
```

## Application Flow

### Authentication Flow

```
┌──────────┐
│   User   │
└────┬─────┘
     │
     │ 1. POST /api/auth/signup
     │    {email, password, name}
     ├──────────────────────────────────────┐
     │                                      │
     │                                      ▼
     │                              ┌──────────────┐
     │                              │  Signup API  │
     │                              └──────┬───────┘
     │                                     │
     │ 2. Hash password (bcrypt)           │
     │ 3. Create user in DB               │
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │  PostgreSQL  │
     │                              └──────┬───────┘
     │                                     │
     │                                     │ User created
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │  Signup API  │
     │                              └──────┬───────┘
     │                                     │
     │ 4. Return success                   │
     │                                     │
     │◄────────────────────────────────────┘
     │
     │ 5. POST /api/auth/login
     │    {identifier, password}
     ├──────────────────────────────────────┐
     │                                      │
     │                                      ▼
     │                              ┌──────────────┐
     │                              │  Login API   │
     │                              └──────┬───────┘
     │                                     │
     │ 6. Find user by email/username/phone
     │ 7. Verify password (bcrypt.compare)
     │ 8. Generate JWT token              │
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │  PostgreSQL  │
     │                              └──────┬───────┘
     │                                     │
     │                                     │ User data
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │  Login API   │
     │                              └──────┬───────┘
     │                                     │
     │ 9. Set HTTP-only cookies            │
     │    - auth_token (JWT)               │
     │    - role comes from the JWT         │
     │                                     │
     │◄────────────────────────────────────┘
     │
     │ 10. Redirect based on role
     │     - ADMIN → /admin
     │     - ORGANIZER → /dashboard
     │
     ▼
```

### Event Creation & Payment Workflow

```
┌──────────┐
│ Organizer│
└────┬─────┘
     │
     │ 1. Navigate to /events/create
     │
     ├──────────────────────────────────────┐
     │                                      │
     │                                      ▼
     │                              ┌──────────────┐
     │                              │Create Event  │
     │                              │    Page      │
     │                              └──────┬───────┘
     │                                     │
     │ 2. Fetch pricing tiers             │
     │    GET /api/pricing (public)       │
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │ Pricing API  │
     │                              └──────┬───────┘
     │                                     │
     │ 3. Display pricing based on        │
     │    guest count                      │
     │                                     │
     │ 4. Submit event details            │
     │    POST /api/events                │
     │    {title, description, date,      │
     │     guestCount}                    │
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │ Events API   │
     │                              └──────┬───────┘
     │                                     │
     │ 5. Find matching pricing tier       │
     │ 6. Calculate quoted amount          │
     │ 7. Create event in DB              │
     │ 8. Create PENDING payment record   │
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │  PostgreSQL  │
     │                              └──────┬───────┘
     │                                     │
     │                                     │ Event + Payment created
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │ Events API   │
     │                              └──────┬───────┘
     │                                     │
     │◄────────────────────────────────────┘
     │
     │ 9. Redirect to /events
     │
     │ 10. Navigate to /events/[id]/pay
     │
     ├──────────────────────────────────────┐
     │                                      │
     │                                      ▼
     │                              ┌──────────────┐
     │                              │Payment Page  │
     │                              └──────┬───────┘
     │                                     │
     │ 11. Submit payment reference        │
     │     POST /api/events/[id]/pay       │
     │     {paymentReference,               │
     │      paymentMethod}                  │
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │ Payment API  │
     │                              └──────┬───────┘
     │                                     │
     │ 12. Update payment status to        │
     │     SUBMITTED                        │
     │ 13. Save payment reference          │
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │  PostgreSQL  │
     │                              └──────┬───────┘
     │                                     │
     │                                     │ Payment updated
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │ Payment API  │
     │                              └──────┬───────┘
     │                                     │
     │◄────────────────────────────────────┘
     │
     ▼
```

### Admin Payment Review & Event Authorization

```
┌──────────┐
│  Admin   │
└────┬─────┘
     │
     │ 1. Navigate to /admin
     │
     ├──────────────────────────────────────┐
     │                                      │
     │                                      ▼
     │                              ┌──────────────┐
     │                              │Admin Dashboard│
     │                              └──────┬───────┘
     │                                     │
     │ 2. Fetch all payments               │
     │    GET /api/admin/payments         │
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │Admin Payments │
     │                              │    API        │
     │                              └──────┬───────┘
     │                                     │
     │ 3. Query payments with user,       │
     │    event, and reviewer data        │
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │  PostgreSQL  │
     │                              └──────┬───────┘
     │                                     │
     │                                     │ Payment data
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │Admin Payments │
     │                              │    API        │
     │                              └──────┬───────┘
     │                                     │
     │◄────────────────────────────────────┘
     │
     │ 4. Display SUBMITTED payments
     │
     │ 5. Verify payment
     │    PATCH /api/admin/payments
     │    {paymentId, status: "VERIFIED"}
     │
     ├──────────────────────────────────────┐
     │                                      │
     │                                      ▼
     │                              ┌──────────────┐
     │                              │Admin Payments │
     │                              │    API        │
     │                              └──────┬───────┘
     │                                     │
     │ 6. Update payment status to VERIFIED │
     │ 7. Record reviewer and timestamp    │
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │  PostgreSQL  │
     │                              └──────┬───────┘
     │                                     │
     │                                     │ Payment updated
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │Admin Payments │
     │                              │    API        │
     │                              └──────┬───────┘
     │                                     │
     │◄────────────────────────────────────┘
     │
     │ 8. Authorize event
     │    PATCH /api/admin/payments
     │    {paymentId, eventAction: "AUTHORIZED"}
     │
     ├──────────────────────────────────────┐
     │                                      │
     │                                      ▼
     │                              ┌──────────────┐
     │                              │Admin Payments │
     │                              │    API        │
     │                              └──────┬───────┘
     │                                     │
     │ 9. Verify payment is VERIFIED        │
     │ 10. Update event status to AUTHORIZED│
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │  PostgreSQL  │
     │                              └──────┬───────┘
     │                                     │
     │                                     │ Event authorized
     │                                     │
     │                                     ▼
     │                              ┌──────────────┐
     │                              │Admin Payments │
     │                              │    API        │
     │                              └──────┬───────┘
     │                                     │
     │◄────────────────────────────────────┘
     │
     ▼
```

## API Routes Structure

```
app/api/
├── auth/
│   ├── login/
│   │   └── route.ts          (POST - Authenticate user, set JWT cookie)
│   ├── logout/
│   │   └── route.ts          (POST - Clear auth cookie)
│   └── signup/
│       └── route.ts          (POST - Create new user account)
│
├── pricing/
│   └── route.ts              (GET - Public active pricing tiers)
│
├── admin/
│   ├── payments/
│   │   └── route.ts          (GET - List payments; PATCH - verify/reject payment, authorize/suspend event)
│   ├── pricing/
│   │   └── route.ts          (GET/POST/PATCH - Tier CRUD, overlap validation, active toggle; admin only)
│   └── templates/
│       └── route.ts          (GET - List templates, POST - Create template)
│
├── events/
│   ├── route.ts              (GET - List user events, POST - Create event with server-side quote)
│   └── [id]/
│       ├── route.ts          (GET - Event details, PATCH - Update event (owner only))
│       ├── card/
│       │   └── route.ts      (GET - Card details, POST - Configure card)
│       ├── pay/
│       │   └── route.ts      (POST - Submit event payment)
│       └── guests/
│           ├── route.ts      (GET - List guests (qrToken excluded), POST - Add guest)
│           ├── import/
│           │   └── route.ts  (POST - Bulk CSV import)
│           └── [guestId]/
│               ├── route.ts  (PATCH - Update guest, DELETE - Remove guest)
│               └── qr/
│                   └── route.ts (GET - QR token PNG, authorized event owner only)
│
└── user/
    └── profile/
        └── route.ts          (GET - Current user profile)
```

Additional route handlers:

```
app/
├── health/
│   └── route.ts              (GET - Database health probe, 503 when unreachable)
```

## Page Routes Structure

```
app/
├── page.tsx                   (Landing page)
├── layout.tsx                 (Root layout)
├── proxy.ts                   (Root proxy: route protection & auth redirects — Next 16
│                               replacement for middleware.ts, which is deprecated;
│                               app/middleware.ts was never loaded by Next)
├── health/
│   └── route.ts               (GET - Database health probe)
│
├── login/
│   └── page.tsx               (Login form)
│
├── signup/
│   └── page.tsx               (Signup form)
│
├── dashboard/
│   ├── page.tsx               (Organizer dashboard)
│   └── profile/
│       └── page.tsx           (User profile settings)
│
├── events/
│   ├── page.tsx               (List user events)
│   ├── create/
│   │   └── page.tsx           (Create event form: type, date, venue, guest count)
│   └── [id]/
│       ├── pay/
│       │   └── page.tsx       (Payment submission page)
│       └── guests/
│           └── page.tsx       (Guest management: search, filters, add, CSV import, QR links)
│
├── admin/
│   ├── page.tsx               (Admin dashboard)
│   └── pricing/
│       └── page.tsx           (Pricing tier management)
│
└── dev/
    └── db/
        └── page.tsx           (Database testing/dev tools)
```

## Route Protection (proxy.ts)

```text
+-----------------------------------------------------------------------------+
|                         PROXY (MIDDLEWARE) LOGIC                            |
+-----------------------------------------------------------------------------+

Next.js 16 deprecates the `middleware` file convention in favour of `proxy`.
The file lives at the project ROOT (proxy.ts) - Next never loads a file placed
inside app/, so the previous app/middleware.ts was never executed and route
protection silently did nothing.

Path Pattern     | Auth Required | Role Required | Redirect Target
-----------------|---------------|---------------|------------------
/admin/:path*    | Yes           | ADMIN         | /login or /dashboard
/dev/:path*      | Yes           | ADMIN         | /login or /dashboard
/dashboard/*     | Yes           | Any           | /login
/events/:path*   | Yes           | Any           | /login

Proxy Flow:
1. Read JWT from the "auth_token" cookie
2. Verify token and extract role (lib/jwt.ts)
3. Redirect unauthenticated users to /login?next=<path>
4. Redirect non-admins away from /admin and /dev
5. API routes are NOT covered here - each route performs its own
   server-side authorization via getSession()/getOwnedEvent()
   (defense in depth alongside the proxy)
```
## Core Libraries

```text
lib/
├── jwt.ts                  (JWT signing/verification; development fallback
│                            secret, throws in production without JWT_SECRET)
├── session.ts              (Session management)
│   └── getSession()        (Reads auth_token cookie, verifies JWT,
│                            loads fresh user row with role)
├── auth.ts                 (Password hashing & verification)
│   ├── hashPassword()      (bcrypt hash)
│   └── verifyPassword()    (bcrypt compare)
├── audit.ts                (recordAudit() - audit trail with actor, action,
│                            entity, metadata and client IP)
├── qr.ts                   (generateQrToken() - 32-char base64url from 192
│                            random bits; renderQrPng() - server-side PNG)
├── guests.ts               (Step 8 guest validation, duplicate detection and
│                            batch creation; tokens issued exactly once)
├── events.ts               (Server-side price quoting from active tiers,
│                            event ownership/status helpers)
└── prisma.ts               (Prisma client singleton)
    └── createPrismaClient() (Using @prisma/adapter-pg)
```

## Environment Configuration

```text
.env (gitignored) / .env.example:
├── DATABASE_URL            (Supabase Postgres connection string)
├── DIRECT_URL              (Supabase direct connection - used by migrations)
├── JWT_SECRET              (>= 32 chars; required in production)
├── SEED_ADMIN_EMAIL        (Seed script admin account)
└── SEED_ADMIN_PASSWORD     (Seed script admin password; seed warns if unset)

prisma7.config.ts:
├── Reads DATABASE_URL / DIRECT_URL from .env
└── Credentials are kept out of schema.prisma
```

## Database Migrations

```text
prisma/migrations/
├── 20260919180000_init
├── 20260924190000_align_card_templates
├── 20260924190500_add_card_template_price
├── 20260924191500_reconcile_legacy_baseline      (reconciliation - see note)
├── 20260924192000_payment_business_workflow
├── 20260924200000_set_currency_tsh
└── 20261021100000_step_8_9_guest_qr_event_types  (Steps 8/9)
```

Notes:
- `reconcile_legacy_baseline` repairs long-standing chain gaps that were only
  ever applied via `prisma db push`: the "PricingTier" table name/columns
  (with FK re-pointing and data copy from the legacy pricing_tiers table),
  users.username/phone, events.guestCount, events.endsAt nullability, the
  Invitation table, and the PaymentStatus enum conversion
  (old PENDING/AUTHORIZED/PAID/FAILED/REFUNDED/CANCELLED values to
  PENDING/SUBMITTED/VERIFIED/REJECTED). Every statement is guarded with
  IF [NOT] EXISTS, so it is safe on databases that already have the objects.
- `step_8_9_guest_qr_event_types` renames enum CardStatus to TemplateStatus
  (preserving card_templates data and its index), creates EventType, CardType
  and the new guest CardStatus enum, swaps guests.inviteToken for a backfilled
  unique qrToken, adds guest whatsapp/cardType/cardStatus, makes guest email
  optional, and adds event type/coupleNames.
- Apply with `npx prisma migrate deploy` once the Supabase credentials in
  .env are valid. Run `npx prisma migrate status` first: databases previously
  shaped by `prisma db push` will show a different history, and
  `reconcile_legacy_baseline` may apply out of chronological order there
  (its guards make that safe).
## Key Features

1. **Multi-Role System**
   - ADMIN: Full access to admin dashboard, payment review, pricing management
   - ORGANIZER: Event creation, payment submission, guest management
   - STAFF: (defined in schema, not fully implemented yet)

2. **Offline Payment Workflow**
   - Events are created with a quoted amount based on pricing tiers
   - Users submit payment references (VodaLipa, AirtelLipa, Mpesa)
   - Admins verify payments manually
   - Events are authorized only after payment verification

3. **Pricing Tiers**
   - Configurable guest count ranges with per-guest pricing
   - Dynamic pricing calculation during event creation
   - Admin-managed pricing structure

4. **Card Templates**
   - Reusable invitation designs
   - Image-based templates with pricing
   - Admin-controlled template library

5. **Audit Trail**
   - AuditLog model tracks all system actions
   - Records actor, action, entity type, and metadata
   - IP address tracking for security

6. **Guest Management & QR Tickets (Steps 8–9)**
   - Per-event guest list with search, filters and CSV import
   - Server-issued opaque QR tokens, excluded from all list responses
   - Owner-only QR PNG rendering; audited guest add/update/delete/import
   - Guest creation gated on event being AUTHORIZED, capacity checked
     against the matching pricing tier

## Data Flow Summary

```
User Action → Frontend Component → API Route → Business Logic → Prisma → PostgreSQL
     ↓                                                                              ↓
Response ← JSON Data ← Query Result ← Database ← Prisma Client ← API Route
```

## Security Features

1. **Password Security**
   - bcrypt hashing with 10 salt rounds
   - Password verification on login

2. **Session Security**
   - HTTP-only cookies for JWT tokens
   - JWT expiration (7 days)
   - Role-based access control via proxy and per-route checks

3. **Route Protection**
   - Root proxy.ts page redirects (Next 16 replacement for middleware)
   - Every API route re-checks session and ownership server-side
   - Automatic redirect to login

4. **Database Security**
   - Parameterized queries via Prisma
   - No raw SQL injection risk
   - Environment-based credentials
