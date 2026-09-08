import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const securityHeaders = ["x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "content-security-policy"];

export function parseRootHeaderPolicy(source) {
  const policy = new Headers();
  let rootBlock = false;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      rootBlock = line.trim() === "/*";
      continue;
    }
    if (!rootBlock) continue;
    const match = line.trim().match(/^([^:]+):\s*(.+)$/);
    if (!match || policy.has(match[1])) throw new Error("Invalid or duplicate root hosting header");
    policy.set(match[1], match[2]);
  }
  for (const name of securityHeaders) {
    if (!policy.get(name)) throw new Error(`Missing root security header: ${name}`);
  }
  return policy;
}

export function assertResponseHeaders(headers, policy) {
  for (const [name, value] of policy) {
    if (headers.get(name) !== value) throw new Error(`Hosted response does not preserve ${name}`);
  }
}

export function readRootHeaderPolicy(root = process.cwd()) {
  return parseRootHeaderPolicy(readFileSync(resolve(root, "public/_headers"), "utf8"));
}

export function assertBuiltHostingPolicy(root = process.cwd()) {
  for (const name of ["_headers", "_routes.json"]) {
    if (!readFileSync(resolve(root, `public/${name}`)).equals(readFileSync(resolve(root, `dist/${name}`)))) {
      throw new Error(`Built hosting policy differs from public/${name}`);
    }
  }
  const routes = JSON.parse(readFileSync(resolve(root, "dist/_routes.json"), "utf8"));
  if (routes.version !== 1 || !Array.isArray(routes.include) || !Array.isArray(routes.exclude)
    || !["/api/*", "/owner", "/owner/"].every(route => routes.include.includes(route)) || routes.exclude.length !== 0) {
    throw new Error("Built routes must protect API and owner paths with Functions");
  }
  return readRootHeaderPolicy(root);
}
