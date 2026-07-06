import { resolve } from "node:path";
import {
  readRuntimeCanvasState,
  updateRuntimeTaskProgress,
  type RuntimeCanvasState
} from "../runtime/canvasRuntimeStore.js";
import { tryRunLocalFastPathTask } from "../runtime/localFastPath.js";

export const PEDIT_RUN_LOCAL_FAST_PATH_TOOL_NAME = "pedit_run_local_fast_path" as const;

export interface RunLocalFastPathInput {
  taskId?: string;
  canvasDistDir?: string;
}

export interface RunLocalFastPathResult {
  toolName: typeof PEDIT_RUN_LOCAL_FAST_PATH_TOOL_NAME;
  ok: boolean;
  taskId: string | null;
  resultNodeId: string | null;
  unsupported: boolean;
  error: string | null;
  message: string;
  project: RuntimeCanvasState;
}

export const runLocalFastPath = (
  input: RunLocalFastPathInput = {}
): RunLocalFastPathResult => {
  const initialState = readRuntimeCanvasState();
  const taskId =
    typeof input.taskId === "string" && input.taskId.trim()
      ? input.taskId.trim()
      : initialState.tasks.find((task) => task.status === "running")?.id ?? null;

  if (!taskId) {
    return createResult({
      ok: false,
      taskId: null,
      resultNodeId: null,
      unsupported: false,
      error: "No running Pedit task was found. Claim a task first with pedit_claim_next_task.",
      message: "没有可处理的 running 任务；请先调用 pedit_claim_next_task。"
    });
  }

  const task = initialState.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    return createResult({
      ok: false,
      taskId,
      resultNodeId: null,
      unsupported: false,
      error: `Task ${taskId} could not be found.`,
      message: "未找到指定任务。"
    });
  }

  if (task.status !== "running") {
    return createResult({
      ok: false,
      taskId,
      resultNodeId: null,
      unsupported: false,
      error: `Task ${taskId} is ${task.status}; claim it first with pedit_claim_next_task before running the local fast path.`,
      message: "任务还没有被 Codex claim，不能直接写入本地 fast-path 结果。"
    });
  }

  const result = tryRunLocalFastPathTask(
    taskId,
    input.canvasDistDir ?? resolve("apps/canvas/dist")
  );

  if (result) {
    return createResult({
      ok: true,
      taskId,
      resultNodeId: result.resultNodeId,
      unsupported: false,
      error: null,
      message: "本地高保真局部处理已完成，结果已写回 Pedit 版本树。"
    });
  }

  const latestState = readRuntimeCanvasState();
  const latestTask = latestState.tasks.find((candidate) => candidate.id === taskId);
  if (latestTask?.status === "running") {
    updateRuntimeTaskProgress(taskId, {
      workerStage: "processing",
      workerMessage: "本地高保真快速通道不适用；请继续使用 image2，并在写回前做尺寸和画质自检。"
    });
  }

  return createResult({
    ok: false,
    taskId,
    resultNodeId: null,
    unsupported: true,
    error: "Local fast path does not support this task or source image. Continue with image2 and write the validated result with pedit_write_generation_result.",
    message: "本地快速通道不适用，任务仍可继续交给 image2 处理。"
  });
};

const createResult = ({
  ok,
  taskId,
  resultNodeId,
  unsupported,
  error,
  message
}: Omit<RunLocalFastPathResult, "toolName" | "project">): RunLocalFastPathResult => ({
  toolName: PEDIT_RUN_LOCAL_FAST_PATH_TOOL_NAME,
  ok,
  taskId,
  resultNodeId,
  unsupported,
  error,
  message,
  project: readRuntimeCanvasState()
});
