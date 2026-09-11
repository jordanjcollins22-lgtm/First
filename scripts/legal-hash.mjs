#!/usr/bin/env node
/**
 * legal-hash.mjs — compute / verify SHA-256 hashes of every legal document.
 *
 *   node scripts/legal-hash.mjs --write     rewrite legal/HASHES.lock from the working tree
 *   node scripts/legal-hash.mjs --check     exit 1 if the working tree disagrees with the lock
 *   node scripts/legal-hash.mjs --check --staged   same, but read the git index (pre-commit)
 *   node scripts/legal-hash.mjs --json      print { file: sha256 } for the current lock
 *
 * The lock covers every *.md file directly inside legal/ except README.md.
 * No other code may write HASHES.lock. The optimizer never calls this script.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEGAL_DIR = join(ROOT, "legal");
const LOCK_PATH = join(LEGAL_DIR, "HASHES.lock");
const EXCLUDED = new Set(["README.md"]);

const args = new Set(process.argv.slice(2));
const staged = args.has("--staged");

function legalFiles() {
  if (staged) {
    const out = execFileSync("git", ["ls-files", "--cached", "--", "legal/*.md"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .filter(Boolean)
      .map((p) => p.replace(/^legal\//, ""))
      .filter((f) => !f.includes("/") && !EXCLUDED.has(f))
      .sort();
  }
  return readdirSync(LEGAL_DIR)
    .filter((f) => f.endsWith(".md") && !EXCLUDED.has(f))
    .sort();
}

function readLegal(file) {
  if (staged) {
    return execFileSync("git", ["show", `:legal/${file}`], { cwd: ROOT });
  }
  return readFileSync(join(LEGAL_DIR, file));
}

function readLock() {
  let text;
  if (staged) {
    try {
      text = execFileSync("git", ["show", ":legal/HASHES.lock"], { cwd: ROOT, encoding: "utf8" });
    } catch {
      return null;
    }
  } else {
    if (!existsSync(LOCK_PATH)) return null;
    text = readFileSync(LOCK_PATH, "utf8");
  }
  const map = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([a-f0-9]{64})\s{2}(\S+)$/);
    if (m) map[m[2]] = m[1];
  }
  return map;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function currentHashes() {
  const out = {};
  for (const f of legalFiles()) out[f] = sha256(readLegal(f));
  return out;
}

function render(hashes) {
  const lines = [
    "# legal/HASHES.lock — SHA-256 of each frozen legal document.",
    "# Regenerate ONLY via `npm run legal:hash` and commit with a `LEGAL:` message.",
    "# Format: <sha256>  <filename>",
  ];
  for (const [f, h] of Object.entries(hashes)) lines.push(`${h}  ${f}`);
  return lines.join("\n") + "\n";
}

const current = currentHashes();

if (args.has("--write")) {
  writeFileSync(LOCK_PATH, render(current));
  console.log(`Wrote ${LOCK_PATH} (${Object.keys(current).length} files).`);
  process.exit(0);
}

if (args.has("--json")) {
  process.stdout.write(JSON.stringify(readLock() ?? current, null, 2) + "\n");
  process.exit(0);
}

// default / --check
const lock = readLock();
if (!lock) {
  console.error("legal/HASHES.lock is missing. Run `npm run legal:hash` and commit it with a `LEGAL:` message.");
  process.exit(1);
}
const problems = [];
for (const [f, h] of Object.entries(current)) {
  if (!lock[f]) problems.push(`${f}: present but not in HASHES.lock`);
  else if (lock[f] !== h) problems.push(`${f}: content changed (lock ${lock[f].slice(0, 12)}…, actual ${h.slice(0, 12)}…)`);
}
for (const f of Object.keys(lock)) {
  if (!(f in current)) problems.push(`${f}: in HASHES.lock but file is missing`);
}
if (problems.length) {
  console.error("LEGAL HASH CHECK FAILED\n" + problems.map((p) => "  - " + p).join("\n"));
  console.error("\nLegal text may only change through the LEGAL: flow (see legal/README.md).");
  process.exit(1);
}
console.log(`Legal hash check passed (${Object.keys(current).length} files).`);
