import { loadPeditServerConfig } from "../config.js";
import {
  PEDIT_CREATE_PENDING_TASK_TOOL_NAME
} from "./createPendingTask.js";
import {
  PEDIT_CLAIM_NEXT_TASK_TOOL_NAME
} from "./claimNextTask.js";
import {
  PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME
} from "./exportCurrentImage.js";
import {
  PEDIT_GET_CANVAS_STATE_TOOL_NAME
} from "./getCanvasState.js";
import {
  PEDIT_OPEN_CANVAS_TOOL_NAME
} from "./openCanvas.js";
import {
  PEDIT_RUN_LOCAL_FAST_PATH_TOOL_NAME
} from "./runLocalFastPath.js";
import {
  PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME
} from "./writeGenerationResult.js";

export const PEDIT_STATUS_TOOL_NAME = "pedit_status" as const;

export interface PeditStatusResult {
  toolName: typeof PEDIT_STATUS_TOOL_NAME;
  ok: true;
  canvasUrl: string;
  projectParentDir: string;
  tools: string[];
}

export const getPeditStatus = (): PeditStatusResult => {
  const config = loadPeditServerConfig();

  return {
    toolName: PEDIT_STATUS_TOOL_NAME,
    ok: true,
    canvasUrl: config.canvasUrl,
    projectParentDir: config.projectParentDir,
    tools: [
      PEDIT_STATUS_TOOL_NAME,
      PEDIT_OPEN_CANVAS_TOOL_NAME,
      PEDIT_GET_CANVAS_STATE_TOOL_NAME,
      PEDIT_CREATE_PENDING_TASK_TOOL_NAME,
      PEDIT_CLAIM_NEXT_TASK_TOOL_NAME,
      PEDIT_RUN_LOCAL_FAST_PATH_TOOL_NAME,
      PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME,
      PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME
    ]
  };
};
