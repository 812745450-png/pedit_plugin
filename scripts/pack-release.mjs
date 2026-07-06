#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = resolve(pluginRoot, "..", "release");
const packageName = "pedit";
const packageDir = join(releaseRoot, packageName);
const archivePath = join(releaseRoot, "pedit-release.zip");

const excludedNames = new Set([
  ".git",
  ".pedit-runtime",
  "node_modules",
  ".DS_Store",
  "coverage",
  "test-results",
  "playwright-report"
]);

const excludedPathFragments = [
  "packages/server/.pedit-runtime",
  "docs/validation",
  "apps/canvas/test-results",
  "apps/canvas/playwright-report"
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: pluginRoot,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function shouldExclude(sourcePath) {
  const name = basename(sourcePath);
  if (excludedNames.has(name)) return true;

  const relative = sourcePath.slice(pluginRoot.length + 1);
  return excludedPathFragments.some((fragment) => relative === fragment || relative.startsWith(`${fragment}/`));
}

async function copyClean(source, target) {
  if (shouldExclude(source)) return;

  const stats = statSync(source);
  if (stats.isDirectory()) {
    mkdirSync(target, { recursive: true });
    const entries = await readdir(source);
    for (const entry of entries) {
      await copyClean(join(source, entry), join(target, entry));
    }
    return;
  }

  copyFileSync(source, target);
}

run("pnpm", ["build"]);
run("pnpm", ["validate:plugin"]);

rmSync(packageDir, { recursive: true, force: true });
rmSync(archivePath, { force: true });
mkdirSync(releaseRoot, { recursive: true });

await copyClean(pluginRoot, packageDir);

if (existsSync(archivePath)) {
  rmSync(archivePath, { force: true });
}

const zipResult = spawnSync("zip", ["-qr", archivePath, packageName], {
  cwd: releaseRoot,
  stdio: "inherit"
});

if (zipResult.status !== 0) {
  process.exit(zipResult.status ?? 1);
}

console.log(`Release package created: ${archivePath}`);
