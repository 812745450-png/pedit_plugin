import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readRuntimeCanvasState,
  writeRuntimeCanvasState,
  type RuntimeGenerationTask
} from "../src/runtime/canvasRuntimeStore.js";
import {
  cancelCodexExecTask,
  runCodexExecTask,
  startCodexExecTaskInBackground
} from "../src/runtime/codexExecWorker.js";
import { createRegionMaskPngDataUrl } from "../src/runtime/regionMask.js";

let tempRoot: string | null = null;

const fakePngDataUrl = (width: number, height: number) => {
  return createRegionMaskPngDataUrl([], width, height);
};

const pendingTask = (overrides: Partial<RuntimeGenerationTask> = {}): RuntimeGenerationTask => ({
  id: "task-worker",
  type: "region_edit",
  status: "pending",
  sourceNodeIds: ["source-a"],
  regions: [],
  instruction: "Make a precise edit.",
  codexPrompt: "Pedit task-worker prompt.",
  error: null,
  createdAt: "2026-07-02T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
  ...overrides
});

const writeProject = (imageUrl = fakePngDataUrl(8, 6)) =>
  writeRuntimeCanvasState({
    mode: "big_image_view",
    currentNodeId: "source-a",
    selectedNodeIds: ["source-a"],
    showHiddenNodes: false,
    nodes: [
      {
        id: "source-a",
        name: "Source",
        kind: "source",
        imageUrl,
        parentIds: [],
        hidden: false,
        deleted: false,
        position: { x: 0, y: 0 },
        summary: "",
        createdAt: "2026-07-02T00:00:00.000Z"
      }
    ],
    tasks: [pendingTask()]
  });

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
  delete process.env.PEDIT_RUNTIME_FILE;
  delete process.env.PEDIT_CODEX_COMMAND;
});

describe("Codex Exec runtime worker", () => {
  it("writes a successful Codex Exec output into the version tree", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "pedit-codex-worker-"));
    process.env.PEDIT_RUNTIME_FILE = join(tempRoot, "canvas-state.json");
    writeProject();
    const mockCodex = join(tempRoot, "mock-codex.mjs");
    await writeFile(
      mockCodex,
      [
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "const stdin = readFileSync(0, 'utf8');",
        "const outputPath = /^RESULT_IMAGE_PATH=(.+)$/m.exec(stdin)?.[1];",
        "if (!outputPath) process.exit(2);",
        `const png = Buffer.from('${fakePngDataUrl(8, 6).split(",")[1]}', 'base64');`,
        "writeFileSync(outputPath, png);",
        "console.log(JSON.stringify({ ok: true }));"
      ].join("\n"),
      "utf8"
    );

    const result = await runCodexExecTask({
      taskId: "task-worker",
      codexCommand: process.execPath,
      codexBaseArgs: [mockCodex],
      timeoutMs: 5_000
    });

    const state = readRuntimeCanvasState();
    expect(result.ok).toBe(true);
    expect(state.tasks[0].status).toBe("succeeded");
    expect(state.tasks[0].resultNodeId).toBeTruthy();
    expect(state.nodes).toHaveLength(2);
    expect(state.currentNodeId).toBe(state.tasks[0].resultNodeId);
  });

  it("uses the local fast path for strict color edits without spawning Codex Exec", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "pedit-codex-worker-fast-path-"));
    process.env.PEDIT_RUNTIME_FILE = join(tempRoot, "canvas-state.json");
    writeRuntimeCanvasState({
      mode: "big_image_view",
      currentNodeId: "source-a",
      selectedNodeIds: ["source-a"],
      showHiddenNodes: false,
      nodes: [
        {
          id: "source-a",
          name: "Source",
          kind: "source",
          imageUrl: fakePngDataUrl(16, 12),
          parentIds: [],
          hidden: false,
          deleted: false,
          position: { x: 0, y: 0 },
          summary: "",
          createdAt: "2026-07-02T00:00:00.000Z"
        }
      ],
      tasks: [
        pendingTask({
          selectionSemantics: "strict_local",
          instruction: "区域 1: 把眼睛换成蓝色",
          regions: [
            {
              id: "region-eye",
              label: "区域 1",
              points: [
                { x: 25, y: 25 },
                { x: 75, y: 25 },
                { x: 75, y: 75 },
                { x: 25, y: 75 }
              ],
              bounds: { x: 25, y: 25, width: 50, height: 50 },
              instruction: "把眼睛换成蓝色"
            }
          ]
        })
      ]
    });

    const result = await runCodexExecTask({
      taskId: "task-worker",
      codexCommand: join(tempRoot, "missing-codex-command"),
      timeoutMs: 5_000
    });

    const state = readRuntimeCanvasState();
    expect(result.ok).toBe(true);
    expect(state.tasks[0].status).toBe("succeeded");
    expect(state.tasks[0].workerMessage).toBeUndefined();
    expect(state.nodes).toHaveLength(2);
  });

  it("reports succeeded when the background worker completes through the fast path immediately", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "pedit-codex-worker-fast-background-"));
    process.env.PEDIT_RUNTIME_FILE = join(tempRoot, "canvas-state.json");
    process.env.PEDIT_CODEX_COMMAND = join(tempRoot, "missing-codex-command");
    writeRuntimeCanvasState({
      mode: "big_image_view",
      currentNodeId: "source-a",
      selectedNodeIds: ["source-a"],
      showHiddenNodes: false,
      nodes: [
        {
          id: "source-a",
          name: "Source",
          kind: "source",
          imageUrl: fakePngDataUrl(16, 12),
          parentIds: [],
          hidden: false,
          deleted: false,
          position: { x: 0, y: 0 },
          summary: "",
          createdAt: "2026-07-02T00:00:00.000Z"
        }
      ],
      tasks: [
        pendingTask({
          selectionSemantics: "strict_local",
          instruction: "区域 1: 把眼睛换成蓝色",
          regions: [
            {
              id: "region-eye",
              label: "区域 1",
              points: [
                { x: 25, y: 25 },
                { x: 75, y: 25 },
                { x: 75, y: 75 },
                { x: 25, y: 75 }
              ],
              bounds: { x: 25, y: 25, width: 50, height: 50 },
              instruction: "把眼睛换成蓝色"
            }
          ]
        })
      ]
    });

    const result = startCodexExecTaskInBackground("task-worker");

    expect(result.ok).toBe(true);
    expect(result.status).toBe("succeeded");
    expect(result.project.tasks[0].status).toBe("succeeded");
    expect(result.project.nodes).toHaveLength(2);
  });

  it("marks the task failed without creating a node when Codex exits without an output image", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "pedit-codex-worker-"));
    process.env.PEDIT_RUNTIME_FILE = join(tempRoot, "canvas-state.json");
    writeProject();
    const mockCodex = join(tempRoot, "mock-codex-no-output.mjs");
    await writeFile(mockCodex, "console.log('done without image');\n", "utf8");

    const result = await runCodexExecTask({
      taskId: "task-worker",
      codexCommand: process.execPath,
      codexBaseArgs: [mockCodex],
      timeoutMs: 5_000
    });

    const state = readRuntimeCanvasState();
    expect(result.ok).toBe(false);
    expect(state.tasks[0].status).toBe("failed");
    expect(state.tasks[0].error).toContain("did not write");
    expect(state.nodes).toHaveLength(1);
  });

  it("exports static canvas assets as Codex Exec input images", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "pedit-codex-worker-static-"));
    process.env.PEDIT_RUNTIME_FILE = join(tempRoot, "canvas-state.json");
    const distDir = join(tempRoot, "dist");
    await mkdir(join(distDir, "samples"), { recursive: true });
    await writeFile(join(distDir, "samples", "person.png"), Buffer.from(fakePngDataUrl(8, 6).split(",")[1], "base64"));
    writeProject("/samples/person.png");
    const mockCodex = join(tempRoot, "mock-codex-static.mjs");
    await writeFile(
      mockCodex,
      [
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "const stdin = readFileSync(0, 'utf8');",
        "const outputPath = /^RESULT_IMAGE_PATH=(.+)$/m.exec(stdin)?.[1];",
        "if (!outputPath) process.exit(2);",
        `const png = Buffer.from('${fakePngDataUrl(8, 6).split(",")[1]}', 'base64');`,
        "writeFileSync(outputPath, png);"
      ].join("\n"),
      "utf8"
    );

    const result = await runCodexExecTask({
      taskId: "task-worker",
      codexCommand: process.execPath,
      codexBaseArgs: [mockCodex],
      canvasDistDir: distDir,
      timeoutMs: 5_000
    });

    expect(result.ok).toBe(true);
    expect(readRuntimeCanvasState().tasks[0].status).toBe("succeeded");
  });

  it("streams Codex Exec progress into the running task", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "pedit-codex-worker-progress-"));
    process.env.PEDIT_RUNTIME_FILE = join(tempRoot, "canvas-state.json");
    writeProject();
    const mockCodex = join(tempRoot, "mock-codex-progress.mjs");
    await writeFile(
      mockCodex,
      [
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "const stdin = readFileSync(0, 'utf8');",
        "const outputPath = /^RESULT_IMAGE_PATH=(.+)$/m.exec(stdin)?.[1];",
        "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '正在分析选区并准备修图' } }));",
        "await new Promise((resolve) => setTimeout(resolve, 300));",
        `const png = Buffer.from('${fakePngDataUrl(8, 6).split(",")[1]}', 'base64');`,
        "writeFileSync(outputPath, png);"
      ].join("\n"),
      "utf8"
    );

    const promise = runCodexExecTask({
      taskId: "task-worker",
      codexCommand: process.execPath,
      codexBaseArgs: [mockCodex],
      timeoutMs: 5_000
    });

    await waitUntil(() =>
      readRuntimeCanvasState().tasks[0].workerMessage?.includes("正在分析选区")
    );
    await promise;
  });

  it("cancels a long-running Codex Exec task without waiting for a hard timeout", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "pedit-codex-worker-cancel-"));
    process.env.PEDIT_RUNTIME_FILE = join(tempRoot, "canvas-state.json");
    writeProject();
    const mockCodex = join(tempRoot, "mock-codex-long-running.mjs");
    await writeFile(
      mockCodex,
      [
        "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '长任务处理中' } }));",
        "await new Promise((resolve) => setTimeout(resolve, 60_000));"
      ].join("\n"),
      "utf8"
    );

    const promise = runCodexExecTask({
      taskId: "task-worker",
      codexCommand: process.execPath,
      codexBaseArgs: [mockCodex],
      timeoutMs: 0
    });
    await waitUntil(() => readRuntimeCanvasState().tasks[0].status === "running");

    cancelCodexExecTask("task-worker");
    await promise;

    const state = readRuntimeCanvasState();
    expect(state.tasks[0].status).toBe("failed");
    expect(state.tasks[0].error).toBe("用户已取消此任务。");
    expect(state.tasks[0].workerMessage).toBeUndefined();
  });

  it("does not rewrite an already completed task when cancel is requested late", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "pedit-codex-worker-late-cancel-"));
    process.env.PEDIT_RUNTIME_FILE = join(tempRoot, "canvas-state.json");
    writeRuntimeCanvasState({
      mode: "big_image_view",
      currentNodeId: "result-a",
      selectedNodeIds: ["result-a"],
      showHiddenNodes: false,
      nodes: [
        {
          id: "source-a",
          name: "Source",
          kind: "source",
          imageUrl: fakePngDataUrl(8, 6),
          parentIds: [],
          hidden: false,
          deleted: false,
          position: { x: 0, y: 0 },
          summary: "",
          createdAt: "2026-07-02T00:00:00.000Z"
        },
        {
          id: "result-a",
          name: "Result",
          kind: "edit",
          imageUrl: fakePngDataUrl(8, 6),
          parentIds: ["source-a"],
          hidden: false,
          deleted: false,
          position: { x: 300, y: 0 },
          summary: "Done",
          createdByTaskId: "task-worker",
          createdAt: "2026-07-02T00:01:00.000Z"
        }
      ],
      tasks: [
        pendingTask({
          status: "succeeded",
          resultNodeId: "result-a",
          error: null,
          updatedAt: "2026-07-02T00:01:00.000Z"
        })
      ]
    });

    cancelCodexExecTask("task-worker");

    const state = readRuntimeCanvasState();
    expect(state.tasks[0].status).toBe("succeeded");
    expect(state.tasks[0].resultNodeId).toBe("result-a");
    expect(state.nodes).toHaveLength(2);
  });
});

const waitUntil = async (predicate: () => boolean | undefined) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2_000) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition.");
};
