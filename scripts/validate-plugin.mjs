#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const relativeValidator = "skills/.system/plugin-creator/scripts/validate_plugin.py";
const validatorCandidates = [
  process.env.PEDIT_PLUGIN_VALIDATOR,
  process.env.CODEX_HOME
    ? resolve(process.env.CODEX_HOME, relativeValidator)
    : undefined,
  resolve(homedir(), ".codex", relativeValidator)
].filter(Boolean);

const validator = validatorCandidates.find((candidate) => existsSync(candidate));

if (!validator) {
  console.error("Unable to find the Codex plugin validator.");
  console.error("Checked:");
  for (const candidate of validatorCandidates) {
    console.error(`- ${candidate}`);
  }
  console.error(
    "Set PEDIT_PLUGIN_VALIDATOR to the validate_plugin.py path, or set CODEX_HOME to a Codex home containing skills/.system/plugin-creator."
  );
  process.exit(1);
}

const result = spawnSync("python3", [validator, pluginRoot], {
  stdio: "inherit"
});

process.exit(result.status ?? 1);
