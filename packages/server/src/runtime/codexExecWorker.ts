import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { appendFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  readRuntimeCanvasState,
  updateRuntimeTaskProgress,
  writeRuntimeCanvasState,
  writeRuntimeGenerationResult,
  type RuntimeCanvasState,
  type RuntimeGenerationTask
} from "./canvasRuntimeStore.js";
import {
  readRuntimeImageUrlBytesSync,
  runtimeDirPath
} from "./runtimeAssets.js";
import { tryRunLocalFastPathTask } from "./localFastPath.js";

export interface CodexExecTaskOptions {
  taskId: string;
  codexCommand?: string;
  codexBaseArgs?: string[];
  canvasDistDir?: string;
  timeoutMs?: number;
  cwd?: string;
}

export type CodexExecTaskResult =
  | { ok: true; taskId: string; resultNodeId: string }
  | { ok: false; taskId: string; error: string };

export interface CodexExecWorkerStartResult {
  ok: boolean;
  taskId: string;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  project: RuntimeCanvasState;
}

interface CodexExecWorkerStartOptions {
  canvasDistDir?: string;
}

interface SpawnResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const defaultTimeoutMs = 0;
const activeTaskIds = new Set<string>();
const activeProcesses = new Map<string, ChildProcess>();
const cancelledTaskIds = new Set<string>();

export const startCodexExecTaskInBackground = (
  taskId: string,
  options: CodexExecWorkerStartOptions = {}
): CodexExecWorkerStartResult => {
  if (process.env.PEDIT_CODEX_EXEC_ENABLED === "false") {
    return {
      ok: false,
      taskId,
      status: "failed",
      error: "Codex Exec worker is disabled by PEDIT_CODEX_EXEC_ENABLED=false.",
      project: readRuntimeCanvasState()
    };
  }

  if (activeTaskIds.has(taskId)) {
    return {
      ok: true,
      taskId,
      status: "running",
      error: null,
      project: readRuntimeCanvasState()
    };
  }

  activeTaskIds.add(taskId);
  void runCodexExecTask({
    taskId,
    codexCommand: process.env.PEDIT_CODEX_COMMAND || "codex",
    canvasDistDir: options.canvasDistDir ?? resolve("apps/canvas/dist"),
    timeoutMs: numberFromEnv(process.env.PEDIT_CODEX_EXEC_TIMEOUT_MS, defaultTimeoutMs)
  }).finally(() => {
    activeTaskIds.delete(taskId);
    activeProcesses.delete(taskId);
  });

  const project = readRuntimeCanvasState();
  const task = project.tasks.find((candidate) => candidate.id === taskId);
  const taskStarted = task?.status === "running" || task?.status === "succeeded";

  return {
    ok: taskStarted,
    taskId,
    status: task?.status === "succeeded" ? "succeeded" : task?.status === "running" ? "running" : "failed",
    error: taskStarted ? null : (task?.error ?? "Task could not be started."),
    project
  };
};

export const cancelCodexExecTask = (
  taskId: string,
  reason = "用户已取消此任务。"
): CodexExecWorkerStartResult => {
  const currentProject = readRuntimeCanvasState();
  const currentTask = currentProject.tasks.find((task) => task.id === taskId);
  if (
    !currentTask ||
    (currentTask.status !== "pending" && currentTask.status !== "running")
  ) {
    const stableStatus =
      currentTask?.status === "succeeded" ? "succeeded" : "failed";
    return {
      ok: false,
      taskId,
      status: stableStatus,
      error: currentTask?.error ?? null,
      project: currentProject
    };
  }

  cancelledTaskIds.add(taskId);
  updateRuntimeTaskProgress(taskId, {
    workerStage: "cancelling",
    workerMessage: "正在停止本机 Codex Exec..."
  });
  const child = activeProcesses.get(taskId);
  if (child && !child.killed) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 3_000).unref();
  }
  const project = writeRuntimeGenerationResult({ taskId, error: reason });
  activeTaskIds.delete(taskId);
  activeProcesses.delete(taskId);
  return {
    ok: false,
    taskId,
    status: "failed",
    error: reason,
    project
  };
};

export const runCodexExecTask = async ({
  taskId,
  codexCommand = "codex",
  codexBaseArgs = ["exec"],
  canvasDistDir = resolve("apps/canvas/dist"),
  timeoutMs = defaultTimeoutMs,
  cwd = process.cwd()
}: CodexExecTaskOptions): Promise<CodexExecTaskResult> => {
  const initialState = readRuntimeCanvasState();
  const task = initialState.tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    return { ok: false, taskId, error: `Task ${taskId} could not be found.` };
  }

  if (task.status !== "pending") {
    return {
      ok: false,
      taskId,
      error: `Task ${taskId} is ${task.status} and cannot be started.`
    };
  }

  markTaskRunning(initialState, task);

  try {
    const fastPathResult = tryRunLocalFastPathTask(taskId, canvasDistDir);
    if (fastPathResult) {
      return fastPathResult;
    }

    const workspace = prepareTaskWorkspace(task, canvasDistDir);
    const prompt = createCodexExecPrompt(task, workspace.outputPath);
    writeFileSync(workspace.promptPath, prompt, "utf8");

    const spawnResult = await runCodexProcess({
      taskId,
      command: codexCommand,
      args: createCodexArgs(codexBaseArgs, workspace.sourceImagePaths),
      prompt,
      cwd,
      timeoutMs,
      stdoutPath: workspace.stdoutPath,
      stderrPath: workspace.stderrPath
    });

    if (cancelledTaskIds.has(taskId)) {
      cancelledTaskIds.delete(taskId);
      return { ok: false, taskId, error: "用户已取消此任务。" };
    }

    if (spawnResult.timedOut) {
      return failTask(taskId, `Codex Exec timed out after ${timeoutMs} ms. Last worker step: ${currentWorkerMessage(taskId)}`);
    }

    if (spawnResult.exitCode !== 0) {
      return failTask(
        taskId,
        `Codex Exec exited before writing a result. Exit code: ${spawnResult.exitCode}; signal: ${spawnResult.signal ?? "null"}. See ${workspace.stderrPath}.`
      );
    }

    if (!existsSync(workspace.outputPath)) {
      return failTask(
        taskId,
        `Codex Exec completed but did not write a result image to ${workspace.outputPath}.`
      );
    }

    const resultImageUrl = imageFileToDataUrl(workspace.outputPath);
    const nextState = writeRuntimeGenerationResult({
      taskId,
      imageUrl: resultImageUrl,
      name: "Codex Exec result",
      summary: task.instruction,
      edgeLabel: "Codex Exec"
    });
    const updatedTask = nextState.tasks.find((candidate) => candidate.id === taskId);

    if (!updatedTask || updatedTask.status !== "succeeded" || !updatedTask.resultNodeId) {
      return {
        ok: false,
        taskId,
        error: updatedTask?.error ?? "Codex Exec result failed validation."
      };
    }

    return { ok: true, taskId, resultNodeId: updatedTask.resultNodeId };
  } catch (error) {
    return failTask(
      taskId,
      error instanceof Error ? error.message : String(error)
    );
  }
};

const markTaskRunning = (
  state: RuntimeCanvasState,
  task: RuntimeGenerationTask
) => {
  writeRuntimeCanvasState({
    ...state,
    tasks: state.tasks.map((candidate) =>
      candidate.id === task.id
        ? {
            ...candidate,
            status: "running",
            error: null,
            workerStage: "starting",
            workerMessage: "正在启动本机 Codex Exec...",
            workerStartedAt: new Date().toISOString(),
            lastWorkerLogAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        : candidate
    )
  });
};

const failTask = (taskId: string, error: string): CodexExecTaskResult => {
  writeRuntimeGenerationResult({ taskId, error });
  return { ok: false, taskId, error };
};

const prepareTaskWorkspace = (task: RuntimeGenerationTask, canvasDistDir: string) => {
  const taskDir = join(runtimeDirPath(), "workers", safeSegment(task.id));
  const inputDir = join(taskDir, "inputs");
  mkdirSync(inputDir, { recursive: true });

  const state = readRuntimeCanvasState();
  const sourceImagePaths = task.sourceNodeIds.map((nodeId, index) => {
    const node = state.nodes.find((candidate) => candidate.id === nodeId);

    if (!node) {
      throw new Error(`Source node ${nodeId} could not be found.`);
    }

    const imagePath = join(inputDir, `${index + 1}-${safeSegment(node.id)}.png`);
    writeFileSync(imagePath, readRuntimeImageUrlBytesSync(node.imageUrl, canvasDistDir));
    return imagePath;
  });

  return {
    taskDir,
    sourceImagePaths,
    outputPath: join(taskDir, "result.png"),
    promptPath: join(taskDir, "prompt.txt"),
    stdoutPath: join(taskDir, "stdout.log"),
    stderrPath: join(taskDir, "stderr.log")
  };
};

const createCodexExecPrompt = (
  task: RuntimeGenerationTask,
  outputPath: string
) =>
  [
    task.codexPrompt,
    "",
    "You are running inside Pedit's local Codex Exec worker.",
    "Use the attached source image files as the editing input.",
    "Write exactly one final result image to the absolute path below.",
    `RESULT_IMAGE_PATH=${outputPath}`,
    "Do not create a Pedit version node yourself. Pedit will validate and import the file after this command exits."
  ].join("\n");

const createCodexArgs = (baseArgs: string[], imagePaths: string[]) => [
  ...baseArgs,
  "--skip-git-repo-check",
  "--sandbox",
  "workspace-write",
  "-c",
  'approval_policy="never"',
  "--json",
  ...imagePaths.flatMap((imagePath) => ["--image", imagePath]),
  "--",
  "-"
];

const runCodexProcess = ({
  taskId,
  command,
  args,
  prompt,
  cwd,
  timeoutMs,
  stdoutPath,
  stderrPath
}: {
  taskId: string;
  command: string;
  args: string[];
  prompt: string;
  cwd: string;
  timeoutMs: number;
  stdoutPath: string;
  stderrPath: string;
}): Promise<SpawnResult> =>
  new Promise((resolveProcess) => {
    writeFileSync(stdoutPath, "", "utf8");
    writeFileSync(stderrPath, "", "utf8");
    updateRuntimeTaskProgress(taskId, {
      workerStage: "processing",
      workerMessage: "Codex Exec 已启动，等待模型规划和工具执行..."
    });
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    activeProcesses.set(taskId, child);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutText = "";
    let lastProgressAt = 0;
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            updateRuntimeTaskProgress(taskId, {
              workerStage: "cancelling",
              workerMessage: "Codex Exec 超时，正在停止任务..."
            });
            child.kill("SIGTERM");
          }, timeoutMs)
        : null;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      const text = chunk.toString("utf8");
      stdoutText += text;
      void appendFile(stdoutPath, text, "utf8");
      const now = Date.now();
      if (now - lastProgressAt > 1_500) {
        lastProgressAt = now;
        const progress = latestCodexProgress(stdoutText);
        updateRuntimeTaskProgress(taskId, {
          workerStage: progress.stage,
          workerMessage: progress.message,
          lastWorkerLogAt: new Date().toISOString()
        });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      void appendFile(stderrPath, chunk.toString("utf8"), "utf8");
    });
    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      activeProcesses.delete(taskId);
      resolveProcess({
        exitCode: 1,
        signal: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}${error.message}`,
        timedOut
      });
    });
    child.on("exit", (exitCode, signal) => {
      if (timer) {
        clearTimeout(timer);
      }
      activeProcesses.delete(taskId);
      resolveProcess({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut
      });
    });

    child.stdin.end(prompt);
  });

const latestCodexProgress = (
  stdoutText: string
): { stage: RuntimeGenerationTask["workerStage"]; message: string } => {
  const lines = stdoutText.trim().split(/\n+/).slice(-30).reverse();
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        item?: { type?: string; text?: string; command?: string; status?: string; message?: string };
        message?: string;
      };
      if (event.item?.type === "agent_message" && event.item.text) {
        return { stage: "processing", message: trimProgress(event.item.text) };
      }
      if (event.item?.type === "command_execution" && event.item.command) {
        const status = event.item.status === "completed" ? "完成" : "执行中";
        return {
          stage: event.item.status === "completed" ? "processing" : "writing",
          message: `工具${status}: ${trimProgress(event.item.command)}`
        };
      }
      if (event.type === "error" && event.message) {
        return { stage: "processing", message: trimProgress(event.message) };
      }
    } catch {
      continue;
    }
  }

  return { stage: "processing", message: "Codex Exec 正在处理图片..." };
};

const currentWorkerMessage = (taskId: string) => {
  const task = readRuntimeCanvasState().tasks.find((candidate) => candidate.id === taskId);
  return task?.workerMessage ?? "unknown";
};

const trimProgress = (value: string) =>
  value.replace(/\s+/g, " ").slice(0, 180);

const imageFileToDataUrl = (filePath: string) => {
  const extension = extname(filePath).toLowerCase();
  const mimeType =
    extension === ".jpg" || extension === ".jpeg"
      ? "image/jpeg"
      : extension === ".webp"
        ? "image/webp"
        : "image/png";
  const bytes = readFileSync(resolve(filePath));
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
};

const safeSegment = (value: string) => value.replace(/[^a-zA-Z0-9_.-]/g, "_");

const numberFromEnv = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
