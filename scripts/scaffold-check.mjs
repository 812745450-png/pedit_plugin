#!/usr/bin/env node

const target = process.argv[2] ?? "check";

console.log(
  `Pedit ${target} has no package targets yet. This scaffold check exits 0 until build/test packages are added in later tasks.`
);
