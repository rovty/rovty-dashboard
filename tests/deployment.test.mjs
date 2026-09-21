import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const wed = pkg.name === "rovty-wed",
  site = pkg.name === "rovty-com";
const prodRef = wed ? "bewmgfluzrypdcgnlxvg" : "ndhdczyqjrbxnglduukc";
test("deployment checks isolate staging databases, credentials and origins", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rovty-deployment-test-"));
  try {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
    const run = () =>
      spawnSync(
        process.execPath,
        [path.join(root, "scripts/check-deployment.mjs"), "staging"],
        { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH || "" } },
      );
    assert.notEqual(run().status, 0, "missing staging files");
    const vars = site
      ? { ASSIST_DATA_ORIGIN: "https://dash-stage.example.test" }
      : wed
        ? {
            SUPABASE_URL: "https://staging-project.supabase.co",
            ROVTY_DASHBOARD_ORIGIN: "https://dash-stage.example.test",
          }
        : {
            SUPABASE_URL: "https://staging-project.supabase.co",
            SUPABASE_ANON_KEY: "sb_publishable_test",
            WED_ORIGIN: "https://wed-stage.example.test",
          };
    const config = {
      name: pkg.name + "-staging",
      vars: { ...vars, ROVTY_ENV: "staging" },
    };
    let browserEnv =
      "VITE_ROVTY_SITE_ORIGIN=https://stage.example.test\nVITE_ROVTY_DASHBOARD_ORIGIN=https://dash-stage.example.test\nVITE_ROVTY_WED_ORIGIN=https://wed-stage.example.test\nVITE_SUPABASE_URL=https://staging-project.supabase.co\nVITE_SUPABASE_ANON_KEY=sb_publishable_test\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test\n";
    const write = () => {
      fs.writeFileSync(
        path.join(dir, "wrangler.staging.jsonc"),
        JSON.stringify(config),
      );
      fs.writeFileSync(path.join(dir, ".env.staging"), browserEnv);
    };
    write();
    assert.equal(run().status, 0);
    const original = JSON.stringify(config);
    if (!site) {
      config.vars.SUPABASE_URL = "https://" + prodRef + ".supabase.co";
      browserEnv = browserEnv.replace(
        "https://staging-project.supabase.co",
        config.vars.SUPABASE_URL,
      );
      write();
      assert.notEqual(run().status, 0, "production project cannot be staged");
      Object.assign(config, JSON.parse(original));
      browserEnv = browserEnv.replace(
        "https://" + prodRef + ".supabase.co",
        "https://staging-project.supabase.co",
      );
      browserEnv = browserEnv.replaceAll(
        "sb_publishable_test",
        "sb_secret_wrong",
      );
      write();
      assert.notEqual(run().status, 0, "browser must not receive secret keys");
      browserEnv = browserEnv.replaceAll(
        "sb_secret_wrong",
        "sb_publishable_test",
      );
    }
    config.vars[
      site
        ? "ASSIST_DATA_ORIGIN"
        : wed
          ? "ROVTY_DASHBOARD_ORIGIN"
          : "WED_ORIGIN"
    ] = "https://dash.rovty.com";
    write();
    assert.notEqual(run().status, 0, "production cross-app origin");
    Object.assign(config, JSON.parse(original));
    config.routes = [{ pattern: "*.rovty.com/*" }];
    write();
    assert.notEqual(run().status, 0, "wildcard deployment route");
    delete config.routes;
    write();
    assert.equal(run().status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
