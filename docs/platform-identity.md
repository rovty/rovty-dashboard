# Rovty identity and deployment

Rovty uses one central account identity and separate product databases. This
release does not move wedding or support data. The three applications remain
independently deployed Cloudflare Workers.

| Purpose | Supabase project | Apply here |
| --- | --- | --- |
| Rovty accounts, product access, support conversations | `https://ndhdczyqjrbxnglduukc.supabase.co` | `supabase/migrations/0004_platform_identity.sql` in this repository |
| Weddings, guests, seating, media, staff management | `https://bewmgfluzrypdcgnlxvg.supabase.co` | `rovty-wed/supabase/migrations/20260923000000_platform_identity.sql` |
| Marketing website | No additional database | Uses the platform's restricted support API |

These are two Supabase projects, each with its own PostgreSQL database and
Auth instance. Local configuration cannot establish which Supabase organization
or billing account owns them. Keep company projects under a company-controlled
organization with named team members and MFA. Organization transfers, billing,
backups/PITR configuration and new staging projects require Supabase console
setup; this release does not perform those operations.

## Identity and authorization

The dashboard Auth user UUID is the permanent Rovty identity. A one-use SSO
handoff includes this UUID and the originating dashboard Auth session UUID.
Wed links its existing local user to that central identity once. Verified email
is only a bootstrap lookup. Later email changes resolve by UUID and preserve
wedding ownership, invitations, roles and the couple's locked identity. Email
collisions fail for team review rather than merging accounts. Existing accounts
link on their next successful handoff. If an unlinked account has already changed
email between projects, reconcile it with the team before its first handoff.
An email change during a linked session prompts a fresh handoff to synchronize
the local email before further private access, including email-based staff checks.

Every product session has a server-only binding to the central login. Private
Wed table requests use `/api/data`, which validates the local JWT and session
binding and checks central session validity and current `product_access` before
forwarding the request. PostgREST retains the user's JWT, so the original
wedding owner/member RLS still applies. Restrictive policies reject direct
authenticated requests that lack the Worker's private gateway header.

Authenticated media operations are also gated. Direct authenticated Storage
requests are denied. The Worker validates the requested wedding folder and
owner/member role using `rovty_media_access`, then forwards only supported
`wedding-media` operations with its service credential. Public media remains
public. Guest invitation/RSVP RPCs retain their invitation-code checks and do
not depend on the central account service.

`/api/team` and `/api/manage` check the same central session before their own
authorization. Staff access still requires the existing confirmed-email
allowlist (`ireshek@gmail.com`), and staff changes retain mandatory reasons,
optimistic conflict checks and audit records. Staff also need active Wed access.
The couple name/username lock is unchanged.

## Logout and access removal

Signing out from dashboard or Wed commits a central revocation cutoff before
clearing local credentials and navigating to `rovty.com`. All existing Rovty
sessions for that account then fail platform authorization, including other
devices. New logins created after the cutoff work normally. Replaying an old
logout cannot revoke a subsequent login. Refreshing an old JWT cannot bypass
the cutoff because validation uses the Auth session's creation time.

Removing or inactivating a `product_access` row takes effect on the next private
request, including already open Wed sessions. Browser gates recheck every
15 seconds while visible and on return to the page. A rejected data request
clears private UI and query caches immediately. Work already authorized and
in flight can finish. Previously downloaded data cannot be recalled.

This is platform authorization revocation. It does not delete all refresh-token
records from the managed Supabase Auth service. A raw Auth token may remain
valid for Auth-only operations until Supabase expires/revokes it, but cannot
regain Rovty app data access. Incident response should additionally revoke
sessions or ban the account through supported Supabase Auth administration.
Do not directly edit managed Auth tables.

Central authorization is checked on every private request, without an access
cache. This adds service latency and makes private product operations depend
on dashboard availability. A connection failure returns a recoverable error;
the editor keeps already typed form values. Failed logout does not claim
success. Monitor latency and failures before adding more products. Deploy the
databases in compatible regions. Public invitations remain independent.

## Worker credentials

Generate independent random secrets (at least 32 random bytes). Store them as
Cloudflare Worker secrets, never `VITE_*` values, browser code or Git files.

| Credential | Workers that hold it | Scope |
| --- | --- | --- |
| Platform `SUPABASE_SERVICE_ROLE_KEY` | Dashboard only after rollout | Central Auth and platform database |
| Wed `SUPABASE_SERVICE_ROLE_KEY` | Wed only | Wedding Auth and database |
| `SSO_SHARED_SECRET` | Dashboard only | Signs handoff tokens |
| `WED_WORKER_SECRET` | Dashboard and Wed | Resolve Wed handoffs, inspect/revoke bound sessions, grant Wed access |
| `ASSIST_DATA_SECRET` | Dashboard and marketing | Restricted `assist_sessions` / `assist_messages` operations only |

The fixed product scope is server-owned. A request body cannot turn the Wed
credential into another product's access. Add a separate registry entry and
credential for each future product. The support credential cannot reach Auth,
product access, RPCs or other tables.

For rotation, dashboard can accept `WED_WORKER_SECRET_PREVIOUS` and
`ASSIST_DATA_SECRET_PREVIOUS` alongside each new current key. Set both versions
on dashboard, switch the calling Worker, verify, then remove the previous key.
If `WED_WORKER_SECRET` is absent, the existing `TEAM_GRANT_SHARED_SECRET` is
temporarily accepted for Wed only. Once the new key is set, that alias is
ignored. Marketing only uses its legacy direct database connection while
`ASSIST_DATA_SECRET` is absent. Failure of a configured scoped connection never
falls back to the broader credential.

## Coordinated release order

1. Back up both projects and rehearse on isolated staging projects. Verify the
   project URLs above in the SQL editor. Apply earlier migrations in order;
   the Wed identity migration assumes the studio, identity-lock and management
   migrations already exist. Do not rerun migrations recorded as applied.
2. Apply dashboard `0004_platform_identity.sql`, then deploy the new dashboard
   Worker. Keep the old Wed credential initially for compatibility during the
   short rollout window. Set a fresh `ASSIST_DATA_SECRET` on dashboard.
3. Set the new `WED_WORKER_SECRET` on Wed, and set the matching dashboard key
   with the old key temporarily in `WED_WORKER_SECRET_PREVIOUS`. Both Workers
   must agree. Set Wed's `ROVTY_DASHBOARD_ORIGIN=https://dash.rovty.com` and
   remove conflicting legacy URL overrides.
4. Schedule a brief private-portal maintenance window. Apply Wed
   `20260923000000_platform_identity.sql` and immediately deploy its new
   Worker. The restrictive policies take effect immediately, so the old Wed
   frontend cannot keep editing during this cutover. Existing open clients
   must reload and use **Continue with Rovty** once to establish a binding.
   Public invitations keep working throughout.
5. Deploy marketing with the matching `ASSIST_DATA_SECRET` and
   `ASSIST_DATA_ORIGIN=https://dash.rovty.com`. Verify support with a deliberate
   authorized test conversation. No test messages are sent by local tests.
6. Verify login, handoff, wedding reads/saves/uploads, staff edits, revocation,
   both logout directions, and anonymous invitations. Then remove legacy
   `TEAM_GRANT_SHARED_SECRET`, temporary previous keys, and marketing's
   `ASSIST_SUPABASE_SERVICE_ROLE_KEY`. Rotate the platform service key if it
   was previously distributed more widely, updating dashboard first.

Use `npm run check:deploy` and `npm run deploy` in each repository. For Wed,
secrets target Worker `rovty-wed`; its deployable config is generated at
`.output/server/wrangler.json`. CLI `project_id` is corrected, but an existing
Supabase CLI link may still point elsewhere: inspect `.temp/project-ref` and
explicitly link the intended project before any `supabase db push`. Prefer
reviewing pending SQL and the target in the console for this coordinated release.

Rollback must preserve the authorization boundary. Do not roll Wed back to an
old client while the new restrictive policies remain, or remove those policies
just to restore availability. Keep the private portal in maintenance and deploy
a corrected gateway-compatible build. Preserve link and revocation tables.
Database restore requires a separate reviewed recovery plan because new writes
may exist. Marketing can temporarily use its old code only while its legacy
credential still exists; this restores broader access and should be short lived.

## Isolated staging

Provision two additional Supabase projects for staging, preferably in a
company-controlled organization. Apply all migrations to the corresponding
empty databases. Use synthetic wedding/guest data and dedicated test accounts.
Do not copy production guests or reuse production credentials.

In every repository, copy `.env.staging.example` to `.env.staging` and
`wrangler.staging.example.jsonc` to `wrangler.staging.jsonc`. Replace project/key
placeholders and set separately provisioned domains. The proposed defaults are
`staging.rovty.com`, `dash-staging.rovty.com`, and `wed-staging.rovty.com`; the
files do not create these domains. Configure staging Auth callbacks for the
staging dashboard only, plus any explicitly needed local callbacks.

`npm run check:staging` rejects production project references, production app
origins, unsafe route patterns, missing staging identifiers and mismatched
browser/server configuration. `npm run build:staging` uses Vite staging mode.
Wed replaces deployment fields in Nitro's generated config with the validated
staging config. `ROVTY_ENV=staging` adds noindex headers for staging pages.
Set all secrets against the distinct staging Worker names/configs, then use
`npm run deploy:staging`. Deploy each environment from its own CI job/worktree
to avoid mixing generated artifacts. Never deploy an old staging artifact
using a production command directly.

Staging support must use a separate test bot/chat and test email recipient.
The examples leave these blank so it stays unavailable until configured.
No staging resources, custom domains, live secrets or organization settings
are provisioned by this code change.

## Validation

- Each repo: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`.
- Wed: `python3 tests/platform_database.py` uses two disposable Docker
  PostgreSQL databases to apply real migrations and verify session/identity/RLS
  behavior. `python3 tests/management_database.py` covers existing staff edits.
- Dashboard: `python3 tests/platform_browser.py`, using the three local servers
  documented in [platform-navigation.md](platform-navigation.md). Account,
  gateway and handoff responses are mocked; real browser routing, SDK state,
  editor forms, logout, reconnect and cache clearing are exercised.
- Wed: `python3 tests/management_browser.py` and `python3 tests/identity_browser.py`
  verify desktop/mobile staff and identity-lock/support flows with mocked APIs.

Local tests do not prove live Supabase Auth configuration or Cloudflare routing.
Run the staged release smoke checks before the production cutover.
