import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Acceptance h: the trainer sessions pilot never writes to Mindbody.
//
// Starting from every page, API route and library file of the feature, follow
// every local import (the whole reachable code, not just the feature's own
// files) and fail if any of it calls a Mindbody write. The Mindbody client's
// write methods are listed below; the last test fails if someone adds a new
// write method to the client without adding it here.

const ROOT = path.resolve(__dirname, "..");
const ENTRY_DIRS = [
  "app/dashboard/trainer-calendar",
  "app/dashboard/trainer-pay",
  "app/dashboard/trainer-rates",
  "app/dashboard/trainer-reconciliation",
  "app/api/trainer-sessions",
  "app/api/sessions/rules",
  "lib/trainer",
];
const MINDBODY_CLIENT = "lib/mindbody/client.ts";
// Every method on the Mindbody client that changes data in Mindbody.
const WRITE_METHODS = ["addClient", "addClientToClass", "removeClientFromClass", "substituteClassTeacher"];
// Modules whose whole job is pushing to Mindbody.
const WRITE_MODULES = ["lib/booking/mindbody-push.ts"];

function filesIn(dir: string): string[] {
  const full = path.join(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).flatMap((name) => {
    const rel = path.posix.join(dir, name);
    return statSync(path.join(ROOT, rel)).isDirectory() ? filesIn(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null; // a package
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    const full = path.join(ROOT, candidate);
    if (existsSync(full) && statSync(full).isFile()) return candidate;
  }
  return null;
}

const IMPORT = /(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;

function reachable(): Set<string> {
  const seen = new Set<string>();
  const queue = ENTRY_DIRS.flatMap(filesIn);
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(path.join(ROOT, file), "utf8");
    for (const match of source.matchAll(IMPORT)) {
      const target = resolveImport(file, match[1] ?? match[2] ?? match[3]);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

describe("trainer sessions pilot: no Mindbody writes", () => {
  const files = reachable();

  it("covers the feature's own files", () => {
    expect(files.has("app/api/trainer-sessions/route.ts")).toBe(true);
    expect(files.has("lib/trainer/pilot.ts")).toBe(true);
    expect(files.size).toBeGreaterThan(20);
  });

  it("never reaches a module that pushes to Mindbody", () => {
    expect([...files].filter((file) => WRITE_MODULES.includes(file))).toEqual([]);
  });

  it("never calls a Mindbody write method anywhere it can reach", () => {
    const offenders: string[] = [];
    const call = new RegExp(`\\.(${WRITE_METHODS.join("|")})\\s*\\(`);
    for (const file of files) {
      if (file === MINDBODY_CLIENT) continue; // defines them; calling is what counts
      const source = readFileSync(path.join(ROOT, file), "utf8");
      if (call.test(source)) offenders.push(file);
      if (/mindbodyonline\.com/i.test(source) && /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(source)) offenders.push(`${file} (raw request)`);
    }
    expect(offenders).toEqual([]);
  });

  it("knows every write method on the Mindbody client", () => {
    const source = readFileSync(path.join(ROOT, MINDBODY_CLIENT), "utf8");
    // Each method's own body (from its "async name(" to the next method) that
    // sends a POST. Authentication is excluded (it only gets a token); request
    // is the generic sender the others call.
    const starts = [...source.matchAll(/\n\s+async\s+(\w+)\s*\(/g)].map((match) => ({ name: match[1], at: match.index! }));
    const writes = new Set<string>();
    starts.forEach((method, i) => {
      const body = source.slice(method.at, starts[i + 1]?.at ?? source.length);
      if (/method:\s*"POST"/.test(body) && method.name !== "authenticate" && method.name !== "request") writes.add(method.name);
    });
    expect([...writes].sort()).toEqual([...WRITE_METHODS].sort());
  });
});
