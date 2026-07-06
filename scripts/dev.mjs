#!/usr/bin/env node

import { spawn } from "node:child_process";

const child = spawn(
  "pnpm",
  ["--filter", "@pedit/canvas", "dev", "--host", "127.0.0.1", "--port", "5173"],
  {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
    shell: process.platform === "win32"
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
