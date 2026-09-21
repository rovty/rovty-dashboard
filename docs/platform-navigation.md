# One platform, independently deployed Workers

| Public origin | Worker | Responsibility |
| --- | --- | --- |
| `https://rovty.com` | `rovty` | Marketing and the contact form |
| `https://dash.rovty.com` | `rovty-dashboard` | Account sign-in, app access, SSO |
| `https://wed.rovty.com` | `rovty-wed` | Wedding administration and public invitations |

Each repository still builds and deploys on its own. Assign each hostname to
its corresponding Worker using Cloudflare Custom Domains/routes. There is no
shared deployment, shared browser token, iframe shell, or database migration
required for these navigation changes.

## Navigation contract

- The marketing header's **Apps** link opens the dashboard root in the same
  tab. An existing dashboard session goes straight to the launcher.
- Dashboard app launches mint an existing, short-lived SSO hand-off. The
  product Worker resolves it server-to-server, verifies that it is for Wed,
  and creates the product session. Sign-in redirects use `Cache-Control:
  no-store` and `Referrer-Policy: no-referrer`.
- Wed's public **Sign in** links open `/admin`, reusing a current Wed session.
  If sign-in is needed, **Continue with Rovty** opens
  `dash.rovty.com/open/wed`. That route checks access and opens Wed after
  sign-in, rather than asking the user to select the app again.
- Only known local destination shapes are accepted in `/login?next=...`.
  Product existence and access are still checked by the catalog and Worker.
  Password sign-in, OAuth callbacks, confirmation links, and login reloads
  retain the intended app.
- Temporary auth/open screens replace their browser-history entries. App
  launches from the normal dashboard keep the dashboard in history. Back and
  Forward therefore do not automatically remint a one-use token.
- Wed's main sections use `/admin?section=guests`, `seating`, `design`, or
  `more` (Team). Main-section selection survives reload and Back/Forward.
  Dialogs and nested list/editor views retain their existing local behavior.
- **All apps** is visible in Wed on desktop, mobile, and onboarding. It goes
  to the dashboard in the same tab. **Get help** opens the contact form in a
  new tab to keep the current work available.
- Auth/access state is rechecked on a back-forward-cache restore. Pending
  launch UI resets. Unsaved studio edits are guarded during router navigation
  as well as full-page navigation.

Changing origins still causes a normal browser document navigation; a SPA
transition cannot span unrelated origins. Shared branding, short loading
states, reusable sessions, and predictable history provide continuity.

Sign-out now revokes platform authorization across dashboard and linked product
sessions before returning to the marketing site. Existing sessions are checked
on return and before private requests. The coordinated database changes,
credentials and rollout are documented in [platform-identity.md](platform-identity.md).

## Deployment configuration

Production defaults work with the origins above. For staging/custom origins,
set the following **before building** the frontend:

| Repository | Optional frontend environment variables |
| --- | --- |
| Marketing | `VITE_ROVTY_DASHBOARD_ORIGIN`, `VITE_ROVTY_WED_ORIGIN` |
| Dashboard | `VITE_ROVTY_SITE_ORIGIN` |
| Wed | `VITE_ROVTY_DASHBOARD_ORIGIN`, `VITE_ROVTY_SITE_ORIGIN` |

The server-side SSO origins must match the deployed environment too:

- Dashboard Worker: `WED_ORIGIN` points to the Wed Worker.
- Wed Worker: `ROVTY_DASHBOARD_ORIGIN` points to the dashboard. Remove stale
  `DASHBOARD_SSO_RESOLVE_URL` / `DASHBOARD_PRODUCT_ACCESS_GRANT_URL` overrides.
- `WED_WORKER_SECRET` must match between those two Workers. Keep
  `SSO_SHARED_SECRET` in the dashboard Worker only. Product service-role keys
  remain server-side in their respective Workers.

Before deploying the new direct sign-in flow, allow these callback URLs in
Supabase Authentication → URL Configuration:

- Dashboard project: `https://dash.rovty.com/login**` for callbacks carrying a
  validated `next` query, alongside the existing site URL.
- Wed project: `https://wed.rovty.com/admin` for the existing magic-link
  hand-off.
- Add only the corresponding explicit staging/local origins when needed.
  The Google/Microsoft provider callback itself remains the Supabase callback.

These settings were not changed remotely. Real provider sign-in and production
SSO must be smoke-tested after configuring the callbacks/secrets and deploying.
Public wedding invitations retain their existing per-wedding URLs and access.

## Local integration check

Start these commands in separate terminals in the indicated repositories:

```sh
# rovty.com
VITE_ROVTY_DASHBOARD_ORIGIN=http://127.0.0.1:5176 VITE_ROVTY_WED_ORIGIN=http://127.0.0.1:5178 npm run dev -- --host 127.0.0.1 --port 5177

# rovty-dashboard
VITE_SUPABASE_URL=https://rovty-dashboard-test.supabase.co VITE_SUPABASE_ANON_KEY=local-test-anon VITE_ROVTY_SITE_ORIGIN=http://127.0.0.1:5177 npm run dev -- --host 127.0.0.1 --port 5176

# rovty-wed
VITE_SUPABASE_URL=https://rovty-wed-test.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=local-test-public VITE_ROVTY_DASHBOARD_ORIGIN=http://127.0.0.1:5176 VITE_ROVTY_SITE_ORIGIN=http://127.0.0.1:5177 npm run dev -- --host 127.0.0.1 --port 5178

# rovty-dashboard, with Python Playwright and Chrome installed
python3 tests/platform_browser.py
```

The browser test exercises real UI/router navigation on three local origins
with mocked account, entitlement, wedding, and SSO responses. It does not
contact a real identity provider or write to Supabase. `npm test` separately
checks the dashboard Worker/redirect allowlist and Wed's SSO failure handling.
