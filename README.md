# Rovty Dashboard

The authenticated app at `dash.rovty.com`. The marketing site's **Apps**
button opens the launcher; a signed-in session is required for
everything else — see `src/components/ProtectedRoute.tsx`.

Same stack, same "Modernist" design tokens (`ink`/`paper`/`line-*`, Archivo)
as `rovty.com` — see that repo's `tailwind.config.js` for where the palette
originates.

See [platform navigation](docs/platform-navigation.md) for the separate Worker
origins, direct app sign-in, Back/Forward behavior, required Supabase callback
URLs, and the integration test across all three apps.

## Workspace UI

The dashboard is an app launcher using the marketing site's ink-and-paper
palette and Archivo typography. Subtle glass is limited to the header and
navigation, with opaque fallbacks and reduced-transparency support. Apps are
solid and readable. The mobile navigation exposes Apps and Get help directly.
The signed-in name (or email when no profile name exists) and Sign out are
visible in the header. There is no account submenu or redundant account page.
Get help opens the existing `https://rovty.com/contact` form in a new tab.

- `src/components/AppShell.tsx`: glass navigation, signed-in identity, support,
  and direct sign-out.
- `src/pages/DashboardPage.tsx`: accessible apps first, direct app launch, and
  released apps available to add. No development listings or catalog filters.
- `src/lib/account.ts`: profile-name resolution across sign-in providers.
- `src/lib/products.ts`: released-app selection for all dashboard content.
- `src/hooks/useProductAccess.ts`: cancellable, user-scoped access loading and
  retry. Failed requests never appear as missing entitlements.
- `src/components/ProductArtwork.tsx`: lightweight local product illustrations.
- `src/workspace.css`: responsive workspace styles, scoped to `.workspace`.
- `shared/products.ts`: the shared product catalog. `available` entries include
  pricing and an SSO origin binding; `planned` entries only have a public preview.
  `findProduct` only returns available products. Planned entries are hidden
  from the dashboard and cannot receive minting, redemption, or access grants.

Rovty Wed is available; Rovty Assist remains in the registry as planned and
does not appear in the dashboard. Add confirmed future products to the
registry as planned entries. Promoting a product requires its
SSO integration and origin binding as well as the catalog change. Access still
comes from `product_access`, enforced by the existing Worker and Supabase RLS.
The workspace redesign requires no database migration.

## Checks

`npm test` runs catalog/Worker regressions with stubbed Supabase requests.
`npm run build` checks browser and Worker types; `npm run lint` checks source.

For local browser checks, start a separate Vite process with test credentials:

```bash
VITE_SUPABASE_URL=https://rovty-dashboard-test.supabase.co VITE_SUPABASE_ANON_KEY=local-test-anon npm run dev -- --host 127.0.0.1 --port 5176
python3 tests/dashboard_browser.py
```

The browser script requires Python Playwright and installed Chrome. It uses
only a local test session, stubs all auth/access/SSO calls, and checks active,
inactive, empty, loading, and failed access; hidden development apps; profile
names; mobile layout; direct sign-out; and the product hand-off. It also opens
the live Rovty contact form without submitting it. Screenshots go to `/tmp`.

## Setup

```bash
npm install
cp .env.example .env            # Supabase URL + anon key for the browser app
cp .dev.vars.example .dev.vars  # Worker secrets for local wrangler dev
npm run dev                     # SPA on :5173, proxies /api/* → :8787
npm run dev:worker              # Worker on :8787 (in a second terminal)
```

`npm run build` runs `tsc -b` (app + worker + shared) before Vite, so type
errors fail the build. `npm run preview` builds and serves the whole thing
through `wrangler dev`.

## Worker API (`worker/index.ts`)

All endpoints are `POST`, return `Cache-Control: no-store`, and are rate
limited per client IP when the `SSO_RATE_LIMITER` binding is present.

| Endpoint | Caller | Auth |
|---|---|---|
| `/api/sso/mint` | browser (this app) | Supabase session bearer; same-origin only |
| `/api/sso/resolve` | a product Worker (e.g. rovty-wed `/sso`) | `Bearer TEAM_GRANT_SHARED_SECRET` |
| `/api/product-access/grant` | a product Worker (e.g. rovty-wed `/api/team`) | `Bearer TEAM_GRANT_SHARED_SECRET` |

Tokens are HMAC-signed, 3-minute, single-use (nonce claimed in `sso_nonces`,
pruned after 24 h). Products are declared once in `shared/products.ts` and
used by both the browser and the Worker.

## Auth

Sign-in is Supabase Auth, three ways: email/password, Google, and Microsoft
(Azure AD). All three need to be turned on in the Supabase dashboard before
they'll work — this repo only has the client-side code.

### 1. Supabase project

Project Settings → API gives you the two values for `.env`.

Authentication → URL Configuration needs:

- **Site URL**: `https://dash.rovty.com` (and `http://localhost:5173` added
  under **Redirect URLs** for local dev)

### 2. Google

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an OAuth 2.0 Client ID (Web application).
2. Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
   (Supabase dashboard shows this exact URL on the provider's config page).
3. Supabase dashboard → Authentication → Providers → **Google** → paste the
   Client ID and Client Secret, enable it.

### 3. Microsoft (Azure AD)

1. In [Azure Portal](https://portal.azure.com) → App registrations → New
   registration.
2. Redirect URI (type: Web): `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. Certificates & secrets → new client secret → copy its value (shown once).
4. Supabase dashboard → Authentication → Providers → **Azure** → paste the
   Application (client) ID and the secret, enable it. If you want to restrict
   sign-in to a specific Azure tenant rather than any Microsoft account, set
   the Azure Tenant URL field there too.

### 4. Signup vs. product access

These are deliberately two different things, the same split Cloudflare
uses between "have an account" and "have a paid plan for a given service":

- **Signup** is open. `LoginPage` supports email/password sign-up plus
  Google/Microsoft (a provider's first-ever login auto-creates the account —
  no separate signup flow needed for those two). Anyone who signs up gets
  into the dashboard shell.
- **Product access** is a separate `product_access` table
  (`supabase/migrations/0001_product_access.sql` — run it once in the
  Supabase SQL Editor) keyed by user + product slug (e.g. `wed`, matching
  `src/lib/products.ts`). `DashboardPage` reads this per product and shows
  access or a link to get the product. Row Level Security lets a user read their own
  rows but never write them — nobody can grant themselves access from the
  client.
- **Granting access is manual for now** — no payment gateway is wired up
  yet. Once you've confirmed a payment out-of-band, either add a row via
  Table Editor → `product_access`, or run the `insert ... on conflict ...`
  snippet at the bottom of the migration file with that user's id (find it
  in Authentication → Users) and the product slug.
- **When you do wire a payment gateway** (Stripe, PayHere, etc.), its
  webhook should run the same insert/update against `product_access` — using
  the `service_role` key server-side (a Cloudflare Worker function, not this
  frontend), which is exempt from the RLS policy above. Ask for this when
  you've picked a gateway; it's a webhook endpoint this repo doesn't have
  yet.
- Email/password sign-up may or may not require confirming the email first
  (Authentication → Providers → Email → **Confirm email** toggle in the
  Supabase dashboard) — `LoginPage` handles both cases, but check that
  setting matches what you want.

## Deploy

Same as `rovty.com`: `npm run deploy` builds and pushes via `wrangler` to
Cloudflare Workers (see `wrangler.jsonc`, name `rovty-dashboard`) — point
`dash.rovty.com`'s route at that Worker.
