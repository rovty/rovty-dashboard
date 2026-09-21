import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { loadEnv } from "vite";
const mode = process.argv[2] || "production";
const fail = (message) => {
  throw new Error(message);
};
if (!["production", "staging"].includes(mode))
  fail("Choose production or staging.");
const root = process.cwd();
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const wed = pkg.name === "rovty-wed",
  site = pkg.name === "rovty-com";
const productionProject = wed ? "bewmgfluzrypdcgnlxvg" : "ndhdczyqjrbxnglduukc";
const productionName = wed ? "rovty-wed" : site ? "rovty" : "rovty-dashboard";
const configName =
  mode === "staging" ? "wrangler.staging.jsonc" : "wrangler.jsonc";
if (!fs.existsSync(configName))
  fail(`Create ${configName} from its example before staging deployment.`);
if (mode === "staging" && !fs.existsSync(".env.staging"))
  fail("Create .env.staging using a separate staging Supabase project.");
const parsed = ts.parseConfigFileTextToJson(
  configName,
  fs.readFileSync(configName, "utf8"),
);
if (parsed.error) fail("Invalid Worker configuration.");
const config = parsed.config,
  vars = config.vars || {};
const env = { ...loadEnv(mode, root, ""), ...process.env };
const origin = (value, label) => {
  if (!value) fail(`${label} is required.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} must be a URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password)
    fail(`${label} must use HTTPS without credentials.`);
  return url.origin;
};
const prodOrigins = new Set([
  "https://rovty.com",
  "https://dash.rovty.com",
  "https://wed.rovty.com",
]);
if (mode === "production" && config.name !== productionName)
  fail("Production Worker name does not match this application.");
if (
  mode === "staging" &&
  (config.name === productionName || !config.name?.includes("staging"))
)
  fail("Staging needs a distinct Worker name containing staging.");
if (!site) {
  const client = origin(env.VITE_SUPABASE_URL, "VITE_SUPABASE_URL");
  const server = origin(vars.SUPABASE_URL, "Worker SUPABASE_URL");
  if (client !== server)
    fail("Browser and Worker must point to the same Supabase project.");
  const key =
    env[wed ? "VITE_SUPABASE_PUBLISHABLE_KEY" : "VITE_SUPABASE_ANON_KEY"];
  if (
    !key ||
    key.startsWith("sb_secret_") ||
    /your-|placeholder|replace/i.test(key)
  )
    fail("A publishable Supabase browser key is required.");
  if (key.includes(".")) {
    try {
      if (
        JSON.parse(Buffer.from(key.split(".")[1], "base64url")).role !== "anon"
      )
        fail("Browser JWT must have the anon role.");
    } catch {
      fail("Browser key must be a publishable key or anon JWT.");
    }
  }
  if (
    wed &&
    vars.SUPABASE_PUBLISHABLE_KEY &&
    key !== vars.SUPABASE_PUBLISHABLE_KEY
  )
    fail("Browser and Worker publishable keys do not match.");
  if (!wed && key !== vars.SUPABASE_ANON_KEY)
    fail("Browser and Worker publishable keys do not match.");
  const prod = `https://${productionProject}.supabase.co`;
  if (mode === "production" && client !== prod)
    fail(
      "Production must use the documented project. Review any project move explicitly.",
    );
  if (
    mode === "staging" &&
    ([
      `https://bewmgfluzrypdcgnlxvg.supabase.co`,
      `https://ndhdczyqjrbxnglduukc.supabase.co`,
    ].includes(client) ||
      /your-|placeholder|replace/i.test(client))
  )
    fail("Staging must use a real separate Supabase project.");
  if (wed && mode === "production") {
    const cli = fs.readFileSync("supabase/config.toml", "utf8");
    if (!cli.includes(`project_id = "${productionProject}"`))
      fail("Supabase CLI project does not match production.");
  }
}
if (mode === "staging") {
  if (vars.ROVTY_ENV !== "staging") fail("Staging must set ROVTY_ENV=staging.");
  for (const entry of config.routes || []) {
    const pattern = typeof entry === "string" ? entry : entry.pattern;
    const host = String(pattern)
      .replace(/^https?:\/\//, "")
      .split("/")[0];
    if (
      ["rovty.com", "dash.rovty.com", "wed.rovty.com"].includes(host) ||
      host.includes("*")
    )
      fail("Staging routes must name explicit, non-production hosts.");
  }
  const required = site
    ? ["ASSIST_DATA_ORIGIN"]
    : wed
      ? ["ROVTY_DASHBOARD_ORIGIN"]
      : ["WED_ORIGIN"];
  for (const name of required) {
    if (prodOrigins.has(origin(vars[name], name)))
      fail(`${name} cannot point to production from staging.`);
  }
  const clientOrigins = wed
    ? ["VITE_ROVTY_DASHBOARD_ORIGIN", "VITE_ROVTY_SITE_ORIGIN"]
    : site
      ? ["VITE_ROVTY_DASHBOARD_ORIGIN", "VITE_ROVTY_WED_ORIGIN"]
      : ["VITE_ROVTY_SITE_ORIGIN"];
  for (const name of clientOrigins) {
    if (prodOrigins.has(origin(env[name], name)))
      fail(`${name} cannot point to production from staging.`);
  }
  if (
    wed &&
    origin(vars.ROVTY_DASHBOARD_ORIGIN, "ROVTY_DASHBOARD_ORIGIN") !==
      origin(env.VITE_ROVTY_DASHBOARD_ORIGIN, "VITE_ROVTY_DASHBOARD_ORIGIN")
  )
    fail("Browser and server dashboard origins must match.");
  for (const [name, value] of Object.entries(vars))
    if (
      /ORIGIN|URL/.test(name) &&
      typeof value === "string" &&
      (prodOrigins.has(new URL(value).origin) ||
        ["bewmgfluzrypdcgnlxvg", "ndhdczyqjrbxnglduukc"].some((ref) =>
          value.includes(ref),
        ))
    )
      fail(`${name} still references production.`);
}
console.log(
  `Validated ${pkg.name}: ${mode} configuration. No deployment or database change performed.`,
);
