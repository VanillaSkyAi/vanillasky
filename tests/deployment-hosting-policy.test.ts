import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { assertBuiltHostingPolicy, assertResponseHeaders, parseRootHeaderPolicy } from "../scripts/deployment-hosting-policy.mjs";

const rootPolicy = `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(self)
  Content-Security-Policy: default-src 'self'; frame-ancestors 'none'
`;
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function builtApp() {
  const root = mkdtempSync(join(tmpdir(), "hosting-policy-"));
  roots.push(root);
  for (const directory of ["public", "dist"]) {
    mkdirSync(join(root, directory));
    writeFileSync(join(root, directory, "_headers"), rootPolicy);
    writeFileSync(join(root, directory, "_routes.json"), JSON.stringify({ version: 1, include: ["/api/*", "/owner", "/owner/"], exclude: [] }));
  }
  return root;
}

test("build verification catches omitted and weakened deployment files", () => {
  const root = builtApp();
  expect(() => assertBuiltHostingPolicy(root)).not.toThrow();
  writeFileSync(join(root, "dist/_headers"), rootPolicy.replace("DENY", "SAMEORIGIN"));
  expect(() => assertBuiltHostingPolicy(root)).toThrow("Built hosting policy differs");
  rmSync(join(root, "dist/_headers"));
  expect(() => assertBuiltHostingPolicy(root)).toThrow();
});

test("owner and API routes cannot bypass their Functions protection", () => {
  const root = builtApp();
  const routes = JSON.parse(readFileSync(join(root, "public/_routes.json"), "utf8"));
  routes.include = ["/api/*"];
  for (const directory of ["public", "dist"]) writeFileSync(join(root, directory, "_routes.json"), JSON.stringify(routes));
  expect(() => assertBuiltHostingPolicy(root)).toThrow("protect API and owner");
});

test("HTTP verification rejects missing or altered headers and respects other path blocks", () => {
  const policy = parseRootHeaderPolicy(`${rootPolicy}/images/*\n  Cache-Control: public, max-age=3600\n`);
  const response = new Response("<!doctype html>", { headers: policy });
  expect(() => assertResponseHeaders(response.headers, policy)).not.toThrow();
  expect(policy.has("cache-control")).toBe(false);
  response.headers.set("Content-Security-Policy", "default-src *");
  expect(() => assertResponseHeaders(response.headers, policy)).toThrow("content-security-policy");
  response.headers.delete("Content-Security-Policy");
  expect(() => assertResponseHeaders(response.headers, policy)).toThrow("content-security-policy");
  expect(() => parseRootHeaderPolicy("/*\n  X-Content-Type-Options: nosniff\n")).toThrow("Missing root security header");
});
