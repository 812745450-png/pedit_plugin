import { homedir } from "node:os";
import { resolve } from "node:path";

export interface PeditServerConfig {
  projectParentDir: string;
  canvasUrl: string;
}

export const loadPeditServerConfig = (
  env: NodeJS.ProcessEnv = process.env
): PeditServerConfig => ({
  projectParentDir: resolve(env.PEDIT_PROJECT_PARENT_DIR ?? `${homedir()}/.pedit/projects`),
  canvasUrl: env.PEDIT_CANVAS_URL ?? "http://127.0.0.1:5173"
});
