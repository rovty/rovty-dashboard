# Shared Rovty billing

Rovty Dashboard owns the plan catalog, promotions, orders, payment events and product entitlements. The marketing and Wed Workers read its public catalog; only the Dashboard Worker holds Payments.lk credentials. Cloudflare-native fetch and Web Crypto implement the provider's REST and SDK 0.2.0 signature contract, without a Node runtime dependency.

## Database targets and rollout

Apply these **in order**, after the existing migrations. No hosted migration is applied by the implementation.

1. **Central Rovty accounts:** `https://ndhdczyqjrbxnglduukc.supabase.co`
   - `supabase/migrations/0005_billing.sql` in `rovty-dashboard`.
   - SQL editor: https://supabase.com/dashboard/project/ndhdczyqjrbxnglduukc/sql/new
2. Deploy Dashboard with billing in test mode, then apply the Wed migration and deploy Wed in the same maintenance window. The new Wed gateway requires plan headers from the new Worker. Old Wed code cannot save through the new plan policies.
3. **Rovty Wed data:** `https://bewmgfluzrypdcgnlxvg.supabase.co`
   - `supabase/migrations/20260924000000_billing_features.sql` in `rovty-wed`.
   - SQL editor: https://supabase.com/dashboard/project/bewmgfluzrypdcgnlxvg/sql/new
4. Deploy the updated marketing site. New catalog prices appear within 30 seconds on a fresh page load. Never cache private billing endpoints.

Existing Wed entitlements receive the Studio feature set with their original status and no new expiry. Existing weddings without a central account link retain public availability until their owner is linked. No wedding identity, guest, RSVP, or media data is moved. Existing paid subscriptions from another system are not inferred or charged.

## Payments.lk configuration

On **rovty-dashboard only**, store Worker secrets with Wrangler:

```sh
npx wrangler secret put PAYMENTS_LK_SECRET_KEY
npx wrangler secret put PAYMENTS_LK_WEBHOOK_SECRET
```

Start with `sk_test_…`. In Payments.lk Developers, register:

`https://dash.rovty.com/api/billing/webhook`

Subscribe to `payment.succeeded`, `checkout.expired`, and `refund.succeeded`. Other signed event types are safely acknowledged. Copy this endpoint's `whsec_…` signing secret into the Worker secret. A dashboard test ping is supported. Staging needs its own endpoint, signing secret, database projects and Worker configuration.

`wrangler.jsonc` initially sets `BILLING_MODE=test` and `BILLING_ORIGIN=https://dash.rovty.com`. Browser and database test receipts cannot grant live access. When the merchant is approved and the staging checklist passes, set the secret to a live key and change `BILLING_MODE` to `live` in the same rollout. Key/mode mismatch disables checkout. Never put either secret in a `VITE_` variable, source file, browser, or Wed Worker.

Keep `PAYMENTS_LK_WEBHOOK_SECRET_PREVIOUS` temporarily when rotating endpoint secrets. Remove it after the provider switches signing. Existing `WED_WORKER_SECRET` connects Wed to the product-scoped entitlement endpoint; it is unrelated to Payments.lk's credentials.

## Customer and staff routes

- `/billing/wed`: current plans, promotion code, server-calculated quote, order creation.
- `/billing/orders/:id`: order total, hosted payment, confirmation status and recovery after cancellation/timeout.
- `/billing/history`: the signed-in account's 50 most recent orders.
- `/billing/manage/wed`: staff account search, manual plan assignments, price/hosting edits, promotions, paginated orders and audit history.
- Wed `/admin/manage` links to this shared billing console. The account stays signed in when moving between the separate Workers.

`ireshek@gmail.com` is initially authorized as a billing administrator. Only confirmed, non-banned accounts on `billing_staff` may administer their assigned product. `viewer` staff cannot write. Wedding `admin`/`view` team roles do not grant billing authority. Writes require a reason, use record versions and produce an audit entry. Staff can assign Essential, Complete or Studio, select active/inactive, and set an expiry. Manual access is not presented as a payment.

## Plans and rules

| Plan | Initial price | Hosting | Enforced features |
|---|---:|---:|---|
| Essential | LKR 4,900 | 6 months | Website, templates, RSVP, guests, standard design customization |
| Complete | LKR 7,900 | 12 months | Essential plus seating and wedding team access |
| Studio | LKR 9,900 | 24 months | Complete plus custom design canvases |

These are one-time purchases for one wedding, with **no recurring card charges**. Paid upgrades charge the full selected plan price and start a new hosting period from confirmed payment. Buying the same or lower active tier is blocked; staff handle exceptions. The original wedding identity lock prevents reuse for a different couple. Custom domains and bespoke design/support promises in product copy remain team-delivered services; this integration does not provision domains.

Private requests check central access, then enforce the wedding owner's features through trusted gateway headers and SQL policies/triggers. Team members inherit that wedding's features, and do not receive a personal paid plan. Their invitations cannot overwrite purchased or revoked entitlements. Public invitation loaders check hosting availability with a maximum 30-second cache. Expiry removes hosted website availability and private product access without deleting stored wedding data. Existing public Supabase data/RPC permissions remain unchanged; expiry is not a data-erasure mechanism.

New products use the same `billing_plans`, `billing_staff`, `billing_promotions` and order system. Register a released product and its scoped Worker credential before enabling checkout; add that product's plan rows and server-side feature rules. Unreleased Rovty Assist remains hidden and cannot be purchased. New plan feature sets are version-controlled by developers rather than free-form admin feature strings.

## Transaction and recovery behavior

- Prices are read in SQL, never accepted from the browser. The browser's expected total is only a comparison; a changed price requires another review.
- Orders snapshot price, discount, plan, features, hosting months, mode and return URLs. Subsequent catalog edits do not rewrite them.
- An order that has not started checkout can be canceled with **Change plan**, and expires after 30 minutes. Its promotion reservation is released. Starting checkout and canceling it are serialized so cancellation cannot race a provider request.
- A user can have one pending checkout per product and mode. Concurrent clicks reuse it. Its stored provider request and `rovty-order-<UUID>` key are reused byte-for-byte on retries.
- A canceled browser return does not cancel the order or grant access. Resume retrieves the existing checkout, or repeats its original creation request. Provider-confirmed expiration/cancellation closes it and allows a new order. A timeout remains recoverable using the same order.
- If an unknown checkout is older than 23 hours, automated creation stops before Payments.lk's 24-hour deduplication window. Staff must locate it by reference in Payments.lk and replay its terminal webhook. Never blindly create another payment after that limit.
- Transient 429/500/503 and `idempotency_key_in_progress` errors get bounded retries with the same body/key. Permanent errors retain their stable code/reason/trace ID in the API response. Longer retry-after values return control to the user.
- Signed raw-body HMAC-SHA256 webhooks require a timestamp within five minutes. Fulfillment checks mode, order reference, currency, amount, checkout and payment IDs in one database transaction. Duplicate delivery never extends hosting or grants twice. Database failures return 503 so the provider retries.
- Test events update test orders only. A live event sent to a test environment is rejected. Use separate endpoints when both modes need concurrent delivery.
- If staff changed access while checkout was open, the payment becomes `review` and leaves that newer assignment intact. Staff can inspect the order and assign the intended plan with a reason.
- Full refund events revoke only the access still owned by that order. Partial refunds become `review`. Refunds are initiated in Payments.lk; this implementation does not automatically issue them. Replayed or late success events cannot restore refunded access. Disputes need staff review because the supplied provider webhook contract does not define a dispute event.
- Promotion codes support percentage or fixed LKR discounts, product/plan scope, validity dates, total limits and per-account limits. Pending orders reserve uses under row locks. Test/live counters are separate. Refunded/reviewed orders keep their use to prevent abuse. A discount must leave at least LKR 10. Existing codes' economic terms are immutable; pause and replace a code to change those terms.

For a stuck order: search by account/order ID, inspect the provider's payment using the stored payment/checkout ID or order reference, and replay the signed event from Payments.lk. A success redirect, screenshot or browser claim is never proof of payment. Do not edit a paid amount or invent a webhook.

## Local validation

```sh
# Dashboard
npm test
npm run typecheck
npm run lint
npm run build
python3 tests/billing_database.py
/opt/homebrew/opt/python@3.11/bin/python3.11 tests/billing_browser.py
# Wed
npm test
npm run typecheck
npm run lint
npm run build
python3 tests/platform_database.py
python3 tests/management_database.py
/opt/homebrew/opt/python@3.11/bin/python3.11 tests/billing_browser.py
```

Database tests create disposable network-isolated Postgres containers. Browser tests use fake Auth, catalog, orders and a mocked hosted checkout. They never submit a real charge. Before live release, complete provider sandbox checkout, webhook replay, expiry, refund, cross-account denial and staging-to-production isolation checks with the real test credentials. Actual provider sandbox/live verification requires merchant credentials and has not been performed locally.
