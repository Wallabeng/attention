#!/usr/bin/env node
// Usage: npm run release -- <patch|minor|major|x.y.z> [--push]
// Bumps the version everywhere, commits, and creates the vX.Y.Z tag.
// With --push, also pushes the current branch and the tag (which triggers the release workflow).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = (p) => resolve(root, p);
const sh = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
const die = (msg) => {
  console.error(`error: ${msg}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const push = args.includes("--push");
const bump = args.find((a) => !a.startsWith("--"));
if (!bump) die("usage: npm run release -- <patch|minor|major|x.y.z> [--push]");

const pkg = JSON.parse(readFileSync(file("package.json"), "utf8"));
const prev = pkg.version;
const [maj, min, pat] = prev.split(".").map(Number);
const next =
  bump === "major" ? `${maj + 1}.0.0`
  : bump === "minor" ? `${maj}.${min + 1}.0`
  : bump === "patch" ? `${maj}.${min}.${pat + 1}`
  : bump.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(next)) die(`invalid version "${next}"`);
const tag = `v${next}`;

if (sh("git status --porcelain")) die("working tree is not clean");
if (sh(`git tag -l ${tag}`)) die(`tag ${tag} already exists`);

// package.json + package-lock.json (root entries only)
const lockPath = file("package-lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
pkg.version = next;
lock.version = next;
if (lock.packages?.[""]) lock.packages[""].version = next;
writeFileSync(file("package.json"), JSON.stringify(pkg, null, 2) + "\n");
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");

// src-tauri/Cargo.toml: first `version = "..."` is the [package] version
const cargoPath = file("src-tauri/Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8");
writeFileSync(cargoPath, cargo.replace(/^version = ".*"$/m, `version = "${next}"`));

// src-tauri/Cargo.lock: entry for the `app` crate
const cargoLockPath = file("src-tauri/Cargo.lock");
const cargoLock = readFileSync(cargoLockPath, "utf8");
writeFileSync(
  cargoLockPath,
  cargoLock.replace(/(name = "app"\nversion = ")[^"]*(")/, `$1${next}$2`),
);

sh("git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock");
sh(`git commit -m "Release ${tag}"`);
sh(`git tag ${tag}`);
console.log(`Created commit and tag ${tag} (was ${prev}).`);

if (push) {
  const branch = sh("git branch --show-current");
  sh(`git push origin ${branch} ${tag}`);
  console.log(`Pushed ${branch} and ${tag}.`);
} else {
  console.log(`Publish with: git push origin ${sh("git branch --show-current")} ${tag}`);
}
