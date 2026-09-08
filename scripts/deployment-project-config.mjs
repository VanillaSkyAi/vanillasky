import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing deployment setting: ${name}`);
  return value;
};
const target = required("DEPLOYMENT_TARGET");
if (!["preview", "production"].includes(target)) throw new Error("Invalid deployment target");
const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
const databaseId = required("CLOUDFLARE_QUOTA_DATABASE_ID");
if (!/^[0-9a-f-]{36}$/i.test(databaseId) || databaseId === "00000000-0000-0000-0000-000000000000") throw new Error("Invalid deployment quota database");
config.name = required("CLOUDFLARE_PAGES_PROJECT");
config.pages_build_output_dir = resolve("dist");
config.vars = { ...config.vars, VIDEO_CHAT_PAID_PROVIDERS: target === "production" ? "enabled" : "disabled" };
config.d1_databases = [{
  binding: "VIDEO_CHAT_QUOTAS",
  database_name: required("CLOUDFLARE_QUOTA_DATABASE_NAME"),
  database_id: databaseId,
  migrations_dir: resolve("migrations"),
}];
// Pages preview bindings are non-inheritable: repeat the selected isolated
// bindings explicitly so preview never falls back to production resources.
config.env = { preview: { vars: config.vars, d1_databases: config.d1_databases } };
writeFileSync("wrangler.deploy.json", JSON.stringify(config, null, 2) + "\n");
