import { createPendingTask } from "./createPendingTask.js";
import {
  claimNextPendingTask,
  PEDIT_CLAIM_NEXT_TASK_TOOL_NAME
} from "./claimNextTask.js";
import {
  exportCurrentImage,
  PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME
} from "./exportCurrentImage.js";
import {
  getCanvasState,
  PEDIT_GET_CANVAS_STATE_TOOL_NAME
} from "./getCanvasState.js";
import {
  getPeditStatus,
  PEDIT_STATUS_TOOL_NAME
} from "./status.js";
import {
  openPeditCanvas,
  PEDIT_OPEN_CANVAS_TOOL_NAME
} from "./openCanvas.js";
import {
  runLocalFastPath,
  PEDIT_RUN_LOCAL_FAST_PATH_TOOL_NAME,
  type RunLocalFastPathInput
} from "./runLocalFastPath.js";
import type { PeditToolProjectState } from "./types.js";
import {
  writeGenerationResult,
  type WriteGenerationResultInput
} from "./writeGenerationResult.js";
import {
  readRuntimeCanvasState,
  claimNextRuntimeTask,
  upsertRuntimeTask,
  writeRuntimeGenerationResult,
  type RuntimeGenerationTask,
  type RuntimeResultInput
} from "../runtime/canvasRuntimeStore.js";
import {
  PEDIT_CREATE_PENDING_TASK_TOOL_NAME
} from "./createPendingTask.js";
import {
  PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME
} from "./writeGenerationResult.js";
import type { PeditTask } from "@pedit/core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readRuntimeImageUrlBytesSync } from "../runtime/runtimeAssets.js";
import { readRuntimeProjectLibrary, saveActiveRuntimeProject } from "../runtime/projectLibraryStore.js";

export {
  PEDIT_CREATE_PENDING_TASK_TOOL_NAME,
  PEDIT_CLAIM_NEXT_TASK_TOOL_NAME,
  PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME,
  PEDIT_GET_CANVAS_STATE_TOOL_NAME,
  PEDIT_OPEN_CANVAS_TOOL_NAME,
  PEDIT_RUN_LOCAL_FAST_PATH_TOOL_NAME,
  PEDIT_STATUS_TOOL_NAME,
  PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME
};

export type PeditToolName =
  | typeof PEDIT_STATUS_TOOL_NAME
  | typeof PEDIT_GET_CANVAS_STATE_TOOL_NAME
  | typeof PEDIT_OPEN_CANVAS_TOOL_NAME
  | typeof PEDIT_CREATE_PENDING_TASK_TOOL_NAME
  | typeof PEDIT_CLAIM_NEXT_TASK_TOOL_NAME
  | typeof PEDIT_RUN_LOCAL_FAST_PATH_TOOL_NAME
  | typeof PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME
  | typeof PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME;

interface ProjectInput {
  project: PeditToolProjectState;
}

interface CreatePendingTaskInput extends ProjectInput {
  task: PeditTask;
}

interface WriteResultProjectInput extends ProjectInput {
  result: Omit<WriteGenerationResultInput, "nodes" | "tasks">;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireProject = (input: unknown): PeditToolProjectState => {
  if (!isRecord(input) || !isRecord(input.project)) {
    throw new Error("Pedit tool input requires a project object.");
  }

  return input.project as unknown as PeditToolProjectState;
};

const hasProject = (input: unknown): input is ProjectInput =>
  isRecord(input) && isRecord(input.project);

export const invokePeditTool = (toolName: PeditToolName, input: unknown = {}) => {
  if (toolName === PEDIT_STATUS_TOOL_NAME) {
    return getPeditStatus();
  }

  if (toolName === PEDIT_OPEN_CANVAS_TOOL_NAME) {
    return openPeditCanvas();
  }

  if (toolName === PEDIT_GET_CANVAS_STATE_TOOL_NAME) {
    if (!hasProject(input)) {
      readRuntimeProjectLibrary();
      const state = readRuntimeCanvasState();
      return {
        toolName: PEDIT_GET_CANVAS_STATE_TOOL_NAME,
        ...state,
        pendingTasks: state.tasks.filter((task) => task.status === "pending"),
        runningTasks: state.tasks.filter((task) => task.status === "running")
      };
    }

    return getCanvasState(requireProject(input));
  }

  if (toolName === PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME) {
    if (!hasProject(input)) {
      const state = readRuntimeCanvasState();
      const nodeId =
        isRecord(input) && typeof input.nodeId === "string"
          ? input.nodeId
          : state.currentNodeId;
      const node = state.nodes.find((candidate) => candidate.id === nodeId && !candidate.deleted);

      if (!node) {
        return {
          toolName: PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME,
          nodeId: nodeId ?? null,
          imagePath: null,
          thumbnailPath: null,
          requiresClarification: true,
          clarificationReason: "Current or requested runtime image node could not be found."
        };
      }

      const filePath =
        isRecord(input) && typeof input.filePath === "string"
          ? input.filePath
          : `.pedit-runtime/exports/${node.id}.png`;
      const imagePath = exportRuntimeImageSync({
        imageUrl: node.imageUrl,
        filePath,
        distDir: resolve("apps/canvas/dist")
      });

      return {
        toolName: PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME,
        nodeId: node.id,
        imagePath,
        thumbnailPath: null,
        requiresClarification: false,
        clarificationReason: null
      };
    }

    return exportCurrentImage(requireProject(input));
  }

  if (toolName === PEDIT_CREATE_PENDING_TASK_TOOL_NAME) {
    if (!hasProject(input)) {
      const task = isRecord(input) && isRecord(input.task)
        ? input.task
        : input;
      const project = upsertRuntimeTask(task as RuntimeGenerationTask);
      saveActiveRuntimeProject(project);
      return {
        toolName: PEDIT_CREATE_PENDING_TASK_TOOL_NAME,
        ...project
      };
    }

    const project = requireProject(input);
    const task = (input as CreatePendingTaskInput).task;

    if (!task) {
      throw new Error("pedit_create_pending_task requires a task.");
    }

    return createPendingTask(project, task);
  }

  if (toolName === PEDIT_CLAIM_NEXT_TASK_TOOL_NAME) {
    if (!hasProject(input)) {
      const claimed = claimNextRuntimeTask();
      saveActiveRuntimeProject(claimed.project);
      return {
        toolName: PEDIT_CLAIM_NEXT_TASK_TOOL_NAME,
        ...claimed
      };
    }

    const project = requireProject(input);
    return claimNextPendingTask(project);
  }

  if (toolName === PEDIT_RUN_LOCAL_FAST_PATH_TOOL_NAME) {
    const fastPathResult = runLocalFastPath(input as RunLocalFastPathInput);
    saveActiveRuntimeProject(fastPathResult.project);
    return fastPathResult;
  }

  if (toolName === PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME) {
    if (!hasProject(input)) {
      const result = isRecord(input) && isRecord(input.result)
        ? input.result
        : input;
      const project = writeRuntimeGenerationResult(result as RuntimeResultInput);
      saveActiveRuntimeProject(project);
      return {
        toolName: PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME,
        ...project
      };
    }

    const project = requireProject(input);
    const result = (input as WriteResultProjectInput).result;

    if (!result) {
      throw new Error("pedit_write_generation_result requires a result object.");
    }

    return writeGenerationResult({
      ...result,
      nodes: project.graph.nodes,
      tasks: project.tasks
    });
  }

  throw new Error(`Unknown Pedit tool ${toolName satisfies never}.`);
};

const exportRuntimeImageSync = ({
  imageUrl,
  filePath,
  distDir
}: {
  imageUrl: string;
  filePath: string;
  distDir: string;
}) => {
  const targetPath = resolve(filePath);
  const bytes = readRuntimeImageBytesSync(imageUrl, distDir);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, bytes);
  return targetPath;
};

const readRuntimeImageBytesSync = (imageUrl: string, distDir: string) => {
  return readRuntimeImageUrlBytesSync(imageUrl, distDir);
};
