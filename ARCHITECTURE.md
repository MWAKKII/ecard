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
│  • sharp (server-side PNG compositing: template + guest name + QR)           │
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
├── imageUrl: String                            (base64 data URL of the uploaded design image)
├── layout: Json?                               (OCR-detected placeholder boxes/colors; null = fallback layout)
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
├── cardPng: Bytes?                             (pre-generated personalized PNG cache)
├── cardFingerprint: String?                    (design/layout/event/guest fingerprint)
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

### Personalized E-Card Rendering (Step 8)

```
 Admin uploads a design         Event owner assigns it        Add guest / CSV import
 (Card designs page)  ───────► (Event details tab)   ───────► (guest API)
         │                            │                            │
         ▼                            ▼                            ▼
 card_templates.layout        events.cardTemplateId      generateCardsForGuests()
 (OCR boxes/colors;                                        guest.cardPng cache
 cached on guest row)                                              │
                                                                    ▼
                                                   sharp compositing, native template size:
                                                     event title + guest name + quality
                                                     + guest QR (opaque token)
                                                                    │
                                                                    ▼
                                                     cached PNG → Download / WhatsApp
```

Rules:

- The PNG contains the event title, guest name, card quality (`Standard` /
  `Premium`) and the guest's opaque `qrToken`; the token is 32 random
  base64url characters and never encodes personal data. The server resolves it
  back to the guest record.
- Each design is analyzed once with OCR (tesseract.js) at upload time. The
  literal words `TITLE EVENT`, `Guests name` and `card quality`, plus the white
  QR panel, are stored as normalized boxes/colors in `card_templates.layout`.
  Older designs are analyzed lazily on the first card render; a design with no
  detected placeholders is stored as an empty marker and uses the fallback.
- Text areas are erased by rebuilding each row from the template's own pixels
  just left and right of the placeholder (horizontal edge colors), so the
  design's gradients blend seamlessly. The QR is composited inside the detected
  white panel. If no placeholders were detected, the renderer falls back to the
  legacy bottom band + QR badge layout, so any uploaded design still works.
- New guests are prepared immediately: single add and CSV import call
  `generateCardsForGuests()` and store the PNG in `guest.cardPng` with a
  fingerprint. Concurrent renders are capped at 4; a failed render leaves that
  guest `PENDING` without failing the add/import.
- `GET .../card` serves the cached PNG when the fingerprint still matches, and
  re-renders when the design image, detected layout, event title, guest
  name/quality or QR token changes. A renderer code change is covered by the
  fingerprint's render version. The response is private (`Cache-Control:
  private, no-store`) and requires the event owner.
- Rendering requires the event owner, an `AUTHORIZED` event and an `ACTIVE`
  assigned design. Rendering moves the guest's card from `PENDING` to
  `GENERATED`; delivery moves it to `SENT` (never downgraded by a later render).
- `?download=1` returns `Content-Disposition: attachment`; without it the PNG is
  inline for the preview dialog.
- WhatsApp delivery uses the Web Share API with the actual PNG file when the
  browser supports file sharing. Otherwise the card is downloaded and a
  `wa.me/<guest phone>` chat opens with a pre-filled message so the organizer can
  attach the PNG. Both paths mark the guest's card as `SENT` (best-effort).
- Design images are never embedded in organizer API responses: the picker calls
  `GET /api/templates` (id + title) and renders thumbnails from
  `GET /api/templates/[id]/image` (binary, private cache).
- The compositor itself takes ~150–250 ms once warm. The very first render after
  a server start also pays a one-off ~7 s fontconfig cache build; database
  roundtrips dominate normal request time.

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
│   ├── templates/
│   │   ├── route.ts          (GET - List designs incl. event usage counts, admin
│   │   │                      only; POST - Upload design image, created ACTIVE)
│   │   └── [id]/
│   │       └── route.ts      (DELETE - Remove a design; event assignments SetNull,
│   │                          audited as template.deleted)
│   └── users/
│       └── route.ts          (GET - Users + owned-data counts; PATCH - role/authorization; DELETE - remove unused account)
│
├── events/
│   ├── route.ts              (GET - List user events, POST - Create event with server-side quote)
│   └── [id]/
│       ├── route.ts          (GET - Event details, PATCH - Update event incl.
│       │                      cardTemplateId assignment; owner only)
│       ├── card/
│       │   └── route.ts      (GET - Card details, POST - Configure card)
│       ├── pay/
│       │   └── route.ts      (POST - Submit event payment)
│       └── guests/
│           ├── route.ts      (GET - List guests (qrToken/cardPng excluded), POST - Add
│           │                  guest + immediately render their card, capped at the
│           │                  event's pricing-tier maxGuests)
│           ├── import/
│           │   └── route.ts  (POST - Bulk CSV import; renders each new card, tier capacity enforced)
│           └── [guestId]/
│               ├── route.ts  (PATCH - Update guest; name/quality re-render the card, DELETE - Remove guest)
│               ├── card/
│               │   └── route.ts (GET - Cached personalized PNG: detected layout + title
│               │                  + name + quality + QR; ?download=1; re-renders on
│               │                  fingerprint change; flips PENDING→GENERATED)
│               └── qr/
│                   └── route.ts (GET - QR token PNG, authorized event owner only)
│
├── templates/
│   ├── route.ts              (GET - ACTIVE designs for organizers: id + title only)
│   └── [id]/
│       └── image/
│           └── route.ts      (GET - Design image as binary, private cache)
│
│
└── user/
    └── profile/
        └── route.ts          (GET - Current user profile)
```

### API query & latency notes

Every Prisma query is a network roundtrip to the hosted database (~200–500 ms
from this environment), so route handlers are written to use as few as possible:

- `getSession()` re-checks the user row on every request (deliberate: deleted
  or role-changed accounts lose access immediately) — always one query.
- Data needed by a page is fetched in **one** query with `include`/`select`
  rather than several sequential lookups: e.g. `GET /api/events/[id]` returns
  the event, its pricing tier and the latest payment in a single call, and
  `GET /api/events/[id]/guests` returns the ownership/status gate together
  with the guest list.
- List endpoints never include relations the UI does not use. `GET /api/events`
  deliberately omits `cardTemplate` (it carries a base64 image and could add
  megabytes per event) and `pricingTier`.
- Client pages fire independent requests together (`Promise.all`), so the
  event workspace loads the event and guest list in parallel instead of
  waiting for one before starting the other.

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
│   ├── page.tsx               (List user events; cards link to the event workspace)
│   ├── create/
│   │   └── page.tsx           (Create event form: type, date, venue, guest count)
│   └── [id]/
│       ├── page.tsx           (Event workspace — tabbed client dashboard (spec
│       │                       section 10): Dashboard summary, Guest list,
│       │                       Event details, Scan E-Card [Step 11 placeholder],
│       │                       Reports [Step 12 placeholder]; capacity meter
│       │                       driven by the event's pricing tier)
│       ├── pay/
│       │   └── page.tsx       (Payment submission page)
│       └── guests/
│           └── page.tsx       (Thin wrapper around the shared GuestManager;
│                               kept so existing links keep working)
│
├── admin/
│   ├── layout.tsx             (Persistent admin shell: header, logout and the
│   │                           section tabs shown on every admin page)
│   ├── page.tsx               (Card designs — template upload & gallery)
│   ├── payments/
│   │   └── page.tsx           (Payment review: verify/reject, authorize/suspend event)
│   ├── pricing/
│   │   └── page.tsx           (Pricing tier management)
│   └── users/
│       └── page.tsx           (Account manager: role, authorization, guarded deletion)
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
├── card-render.ts          (renderGuestCard() - sharp compositor guided by
│                            the detected layout: rebuilds text backgrounds
│                            from template edge pixels, adds title/name/quality
│                            + QR; legacy fallback when no placeholders)
├── card-generation.ts      (resolveTemplateLayout(), buildCardFingerprint(),
│                            generateCardsForGuests() - cached PNG + concurrency)
├── template-layout.ts      (analyzeTemplateLayout() - tesseract.js OCR, white
│                            QR-panel flood fill, layout parsing/validation)
├── guests.ts               (Step 8 guest validation, duplicate detection and
│                            batch creation; tokens issued exactly once; public
│                            select excludes qrToken/cardPng)
├── events.ts               (Server-side price quoting from active tiers,
│                            event ownership/status helpers)
└── prisma.ts               (Prisma client singleton)
    └── createPrismaClient() (Using @prisma/adapter-pg)

Shared components:
components/
├── guest-manager.tsx        (Guest list UI used by the /events/[id] "Guest list"
│                             tab and the legacy /events/[id]/guests page: tier
│                             capacity meter, add form and CSV import disabled at
│                             capacity, search/filters, scan-time column, gate for
│                             non-AUTHORIZED events, Card action for delivery)
└── guest-card-dialog.tsx    (Personalized PNG preview + Download + WhatsApp
                              delivery; falls back to download + wa.me when the
                              browser cannot share files)
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
├── 20261021100000_step_8_9_guest_qr_event_types  (Steps 8/9)
└── 20261021110000_remove_card_template_price_description
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
- `remove_card_template_price_description` drops card_templates.price and
  card_templates.description — designs are now plain image uploads
  (drag & drop from the admin dashboard).
- `card_layout_and_generated_cards` adds `card_templates.layout` (JSONB) for
  OCR-detected placeholders and `guests.cardPng` / `guests.cardFingerprint` for
  the pre-generated card cache.
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
   - Image upload from the admin's PC (drag & drop or file picker), stored as
     a base64 data URL in `card_templates.imageUrl` — client-side downscaling
     keeps uploads small; the API validates type, magic bytes and a 4 MB cap
   - Uploads are created `ACTIVE` and immediately selectable by organizers
   - The admin gallery is selectable: choose a design to see how many events
     use it and delete it with an inline confirmation
   - Deletion is audited (`template.deleted`); event assignments are cleared by
     the `onDelete: SetNull` relation, so affected events must pick a new design
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
   - Event workspace at /events/[id] (spec section 10, "Client Dashboard"):
     tabbed dashboard with attendance summary (total / attended / not
     attended / %), guest list, event details, and placeholder tabs for
     scanning (Step 11) and reports (Step 12)
   - The pricing tier's maxGuests is the hard guest capacity: enforced
     server-side on add and CSV import (409 past the limit) and surfaced
     in the UI as a capacity meter that disables adding/importing when full

7. **Personalized E-Card PNG (Step 8)**
   - Event owner assigns an admin-published design from the Event details tab
     (`PATCH /api/events/[id]` → `cardTemplateId`, ACTIVE designs only)
   - The design is analyzed once with tesseract.js OCR: the literal
     `TITLE EVENT`, `Guests name` and `card quality` words plus the white QR
     panel become normalized boxes/colors in `card_templates.layout`; older
     designs are analyzed lazily on first use, and a no-placeholder design uses
     the fallback layout
   - Adding a guest (single or CSV import) immediately renders their card with
     the event title, guest name, `Standard`/`Premium` quality and opaque QR,
     then caches the PNG in `guest.cardPng` with a fingerprint
   - Erased text rows are rebuilt from the template's own left/right edge
     pixels, so the design's gradients blend seamlessly; the QR is placed
     inside the detected white panel. With no detected placeholders the
     renderer falls back to the legacy bottom band + QR badge
   - `GET .../card` serves the cached PNG when the fingerprint matches and
     re-renders when the design, layout, event title, guest details or quality
     change; owner-only and AUTHORIZED-event-only
   - Rendering flips the guest's card status `PENDING → GENERATED`; delivery
     marks it `SENT` (a later re-render never downgrades it)
   - Download as an attachment or send via WhatsApp (Web Share file where
     supported; otherwise PNG download + pre-filled `wa.me` chat)
   - QR content is only the random token — no editable personal data; the
     server resolves the token back to the guest record

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
