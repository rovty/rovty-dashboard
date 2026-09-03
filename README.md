# Rovty Dashboard

The authenticated app at `dash.rovty.com`. Marketing site (`rovty.com`)'s
"Login" button links to `/login` here; a signed-in session is required for
everything else — see `src/components/ProtectedRoute.tsx`.

Same stack, same "Modernist" design tokens (`ink`/`paper`/`line-*`, Archivo)
as `rovty.com` — see that repo's `tailwind.config.js` for where the palette
originates.

## Setup

```bash
npm install
cp .env.example .env   # then fill in your Supabase project's URL + anon key
npm run dev
```

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
  Active/Locked accordingly. Row Level Security lets a user read their own
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
