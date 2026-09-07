#!/usr/bin/env node
// One-time backfill: grants dashboard product_access('wed') to everyone who
// already has an accepted wedding_members row, for weddings whose owner
// currently has active access to 'wed'. Needed because the invite-acceptance
// -> product_access wiring (rovty-wed's /api/team calling this dashboard's
// /api/product-access/grant) didn't exist until now — anyone invited before
// this fix shipped has a wedding_members row but no product_access row, so
// they'd stay locked out forever without this being run once.
//
// Safe to re-run: every write here is an upsert.
//
// Usage (run from rovty-dashboard/):
//   node scripts/backfill-wed-team-product-access.mjs            # dry run
//   node scripts/backfill-wed-team-product-access.mjs --apply    # do it for real
//
// Reads both projects' credentials from this repo's own .dev.vars and the
// sibling rovty-wed repo's .env — no separate config needed as long as the
// two repos sit side by side (../rovty-wed relative to this one), which is
// this workspace's actual layout.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

function loadEnvFile(path) {
  const out = {};
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const dashEnv = loadEnvFile(join(__dirname, "..", ".dev.vars"));
const wedEnv = loadEnvFile(join(__dirname, "..", "..", "rovty-wed", ".env"));

const DASH_URL = dashEnv.SUPABASE_URL ?? "https://ndhdczyqjrbxnglduukc.supabase.co";
const DASH_SERVICE_KEY = dashEnv.SUPABASE_SERVICE_ROLE_KEY;
const WED_URL = wedEnv.SUPABASE_URL ?? wedEnv.VITE_SUPABASE_URL;
const WED_SERVICE_KEY = wedEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!DASH_SERVICE_KEY || !WED_URL || !WED_SERVICE_KEY) {
  console.error(
    "Missing credentials — expected rovty-dashboard/.dev.vars (SUPABASE_SERVICE_ROLE_KEY) " +
      "and ../rovty-wed/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).",
  );
  process.exit(1);
}

async function fetchAllWeddingMembers() {
  const res = await fetch(`${WED_URL}/rest/v1/wedding_members?select=email,wedding_id`, {
    headers: { Authorization: `Bearer ${WED_SERVICE_KEY}`, apikey: WED_SERVICE_KEY },
  });
  if (!res.ok) throw new Error(`Failed to list wedding_members: ${res.status} ${await res.text()}`);
  return res.json();
}

// Deliberately no "does the wedding's owner currently have active access"
// gate here — weddings.owner_id lives in rovty-wed's own project and is
// NOT comparable to dashboard product_access.user_id (different Supabase
// projects, disjoint id spaces; only email ties the two together). An
// earlier version of this script tried to compare them directly and always
// skipped as a result. Matching the live runtime behavior in
// worker/index.ts's handleGrantProductAccess (called from rovty-wed's
// /api/team on every accepted invite, unconditionally) is simpler and
// correct: being on a wedding's team is its own justification for
// unlocking the product tile, independent of the owner's own status.

async function findOrCreateDashboardUserId(email) {
  const res = await fetch(`${DASH_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DASH_SERVICE_KEY}`,
      apikey: DASH_SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (!res.ok) throw new Error(`generate_link failed for ${email}: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const id = body.id ?? body.user?.id;
  if (!id) throw new Error(`generate_link returned no id for ${email}`);
  return id;
}

async function grantProductAccess(userId, email) {
  const res = await fetch(`${DASH_URL}/rest/v1/product_access?on_conflict=user_id,product`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DASH_SERVICE_KEY}`,
      apikey: DASH_SERVICE_KEY,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ user_id: userId, product: "wed", status: "active", granted_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`grant failed for ${email}: ${res.status} ${await res.text()}`);
}

async function main() {
  const members = await fetchAllWeddingMembers();
  if (members.length === 0) {
    console.log("No wedding_members rows found — nothing to backfill.");
    return;
  }

  const weddingCount = new Set(members.map((m) => m.wedding_id)).size;
  console.log(`${APPLY ? "Applying" : "Dry run"} — ${members.length} member row(s) across ${weddingCount} wedding(s).\n`);

  for (const member of members) {
    if (!APPLY) {
      console.log(`WOULD GRANT  ${member.email}  (wedding ${member.wedding_id})`);
      continue;
    }
    try {
      const userId = await findOrCreateDashboardUserId(member.email);
      await grantProductAccess(userId, member.email);
      console.log(`GRANTED  ${member.email}  -> user_id ${userId}`);
    } catch (err) {
      console.error(`FAILED  ${member.email} —`, err.message);
    }
  }

  if (!APPLY) console.log("\nDry run only — re-run with --apply to actually grant access.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
