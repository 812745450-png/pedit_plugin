import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadPeditServerConfig } from "../config.js";

export const PEDIT_OPEN_CANVAS_TOOL_NAME = "pedit_open_canvas" as const;

interface SpawnOptions {
  cwd: string;
}

interface OpenCanvasOptions {
  pluginRoot?: string;
  spawnProcess?: (
    command: string,
    args: string[],
    options: SpawnOptions
  ) => void;
}

export interface OpenCanvasResult {
  toolName: typeof PEDIT_OPEN_CANVAS_TOOL_NAME;
  ok: true;
  canvasUrl: string;
  preferredSurface: "codex-sidebar";
  openInstruction: string;
  launched: true;
}

const defaultPluginRoot = () =>
  resolve(fileURLToPath(new URL("../../../..", import.meta.url)));

const defaultSpawnProcess: OpenCanvasOptions["spawnProcess"] = (
  command,
  args,
  options
) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: true,
    shell: process.platform === "win32",
    stdio: "ignore"
  });

  child.unref();
};

export const openPeditCanvas = (
  options: OpenCanvasOptions = {}
): OpenCanvasResult => {
  const config = loadPeditServerConfig();
  const pluginRoot = options.pluginRoot ?? defaultPluginRoot();
  const spawnProcess = options.spawnProcess ?? defaultSpawnProcess;

  spawnProcess(
    "node",
    [
      "packages/server/dist/index.js",
      "--serve-canvas",
      "--host",
      "127.0.0.1",
      "--port",
      "5173"
    ],
    { cwd: pluginRoot }
  );

  return {
    toolName: PEDIT_OPEN_CANVAS_TOOL_NAME,
    ok: true,
    canvasUrl: config.canvasUrl,
    preferredSurface: "codex-sidebar",
    openInstruction: "Open canvasUrl in the Codex sidebar in-app browser.",
    launched: true
  };
};
