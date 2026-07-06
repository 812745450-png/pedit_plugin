import type { PeditNode, PeditTask } from "@pedit/core";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createModelGenerationRequest,
  createPendingTask,
  listPendingModelRequests
} from "../src/tools/createPendingTask.js";
import { claimNextPendingTask } from "../src/tools/claimNextTask.js";
import {
  createDefaultRuntimeCanvasState,
  writeRuntimeGenerationResult,
  mergeRuntimeCanvasStateFromClient,
  readRuntimeCanvasState,
  writeRuntimeCanvasState,
  upsertRuntimeTask,
  type RuntimeGenerationTask
} from "../src/runtime/canvasRuntimeStore.js";
import {
  recordRuntimeBridgeTaskRequest,
  readRuntimeBridgeStatus,
  recordRuntimeMcpToolCall
} from "../src/runtime/bridgeRuntimeStore.js";
import { exportCurrentImage } from "../src/tools/exportCurrentImage.js";
import { getCanvasState } from "../src/tools/getCanvasState.js";
import { openPeditCanvas } from "../src/tools/openCanvas.js";
import { writeGenerationResult } from "../src/tools/writeGenerationResult.js";
import { createMockGenerationResult } from "../src/mock/mockGenerator.js";
import { invokePeditTool } from "../src/tools/registry.js";
import { createRegionMaskPngDataUrl } from "../src/runtime/regionMask.js";

const node = (id: string, parentIds: string[] = []): PeditNode => ({
  id,
  name: id.toUpperCase(),
  kind: parentIds.length > 1 ? "merge" : parentIds.length === 1 ? "edit" : "upload",
  imagePath: `images/${id}.png`,
  thumbnailPath: `thumbs/${id}.png`,
  parentIds,
  hidden: false,
  deleted: false
});

const fakePngDataUrl = (width: number, height: number) => {
  return createRegionMaskPngDataUrl([], width, height);
};

const project = (overrides: Partial<Parameters<typeof getCanvasState>[0]> = {}): Parameters<typeof getCanvasState>[0] => ({
  mode: "big_image_view",
  currentNodeId: "a",
  selectedNodeIds: [],
  graph: {
    nodes: [node("a")]
  },
  tasks: [],
  ...overrides
});

describe("tool contracts", () => {
  it("starts the runtime canvas as an empty project", () => {
    expect(createDefaultRuntimeCanvasState()).toMatchObject({
      mode: "big_image_view",
      currentNodeId: null,
      selectedNodeIds: [],
      showHiddenNodes: false,
      nodes: [],
      tasks: []
    });
  });

  it("stores runtime image data as assets and compacts oversized prompts", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-runtime-assets-"));
    const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");
    const imageUrl = fakePngDataUrl(8, 6);

    try {
      const saved = writeRuntimeCanvasState({
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
            createdAt: "2026-07-01T00:00:00.000Z"
          }
        ],
        tasks: [
          {
            id: "task-a",
            type: "region_edit",
            status: "pending",
            sourceNodeIds: ["source-a"],
            regions: [],
            instruction: "Edit region",
            referenceImages: [
              {
                name: "style-reference.png",
                imageUrl
              }
            ],
            codexPrompt: `Source image: ${imageUrl}`,
            error: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z"
          }
        ]
      });

      expect(saved.nodes[0].imageUrl).toMatch(/^\/runtime-assets\/source-a-/);
      expect(existsSync(join(tempDir, "assets", basename(saved.nodes[0].imageUrl)))).toBe(true);
      expect(saved.tasks[0].referenceImages?.[0]).toMatchObject({
        name: "style-reference.png"
      });
      expect(saved.tasks[0].referenceImages?.[0].imageUrl).toMatch(
        /^\/runtime-assets\/task-a-reference-1-/
      );
      expect(
        existsSync(
          join(
            tempDir,
            "assets",
            basename(saved.tasks[0].referenceImages?.[0].imageUrl ?? "")
          )
        )
      ).toBe(true);
      expect(saved.tasks[0].codexPrompt).toContain("runtime image data omitted");
      expect(readFileSync(join(tempDir, "canvas-state.json"), "utf8")).not.toContain(
        "data:image"
      );
    } finally {
      if (previousRuntimeFile === undefined) {
        delete process.env.PEDIT_RUNTIME_FILE;
      } else {
        process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("preserves server-side succeeded results when a stale client project is saved", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-runtime-merge-"));
    const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    try {
      const sourceImageUrl = fakePngDataUrl(8, 6);
      const resultImageUrl = fakePngDataUrl(8, 6);
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
            imageUrl: sourceImageUrl,
            parentIds: [],
            hidden: false,
            deleted: false,
            position: { x: 0, y: 0 },
            summary: "",
            createdAt: "2026-07-01T00:00:00.000Z"
          },
          {
            id: "result-a",
            name: "Codex result",
            kind: "edit",
            imageUrl: resultImageUrl,
            parentIds: ["source-a"],
            hidden: false,
            deleted: false,
            position: { x: 300, y: 0 },
            summary: "Written by Codex.",
            createdByTaskId: "task-a",
            createdAt: "2026-07-01T00:01:00.000Z"
          }
        ],
        tasks: [
          {
            id: "task-a",
            type: "region_edit",
            status: "succeeded",
            sourceNodeIds: ["source-a"],
            regions: [],
            instruction: "Edit region",
            codexPrompt: "Use image2.",
            resultNodeId: "result-a",
            error: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:01:00.000Z"
          }
        ]
      });

      const merged = mergeRuntimeCanvasStateFromClient({
        mode: "big_image_view",
        currentNodeId: "source-a",
        selectedNodeIds: ["source-a"],
        showHiddenNodes: false,
        nodes: [
          {
            id: "source-a",
            name: "Source",
            kind: "source",
            imageUrl: sourceImageUrl,
            parentIds: [],
            hidden: false,
            deleted: false,
            position: { x: 0, y: 0 },
            summary: "",
            createdAt: "2026-07-01T00:00:00.000Z"
          }
        ],
        tasks: []
      });

      expect(merged.currentNodeId).toBe("result-a");
      expect(merged.selectedNodeIds).toEqual(["result-a"]);
      expect(merged.nodes.map((node) => node.id)).toContain("result-a");
      expect(merged.tasks.map((task) => task.id)).toContain("task-a");
      expect(merged.tasks.find((task) => task.id === "task-a")?.status).toBe("succeeded");
    } finally {
      if (previousRuntimeFile === undefined) {
        delete process.env.PEDIT_RUNTIME_FILE;
      } else {
        process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("normalizes legacy annotation handoff tasks to manual handoff", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-runtime-handoff-"));
    const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    try {
      const saved = writeRuntimeCanvasState({
        mode: "big_image_view",
        currentNodeId: null,
        selectedNodeIds: [],
        showHiddenNodes: false,
        nodes: [],
        tasks: [
          {
            id: "task-legacy-handoff",
            type: "region_edit",
            status: "pending",
            sourceNodeIds: ["source-a"],
            regions: [],
            instruction: "Change eye color",
            codexPrompt: "Use image2.",
            selectionSemantics: "contextual_inpaint",
            handoffChannel: "annotation_handoff",
            handoffPrompt: "Pedit Annotation Handoff\ntaskId=task-legacy-handoff",
            error: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z"
          }
        ]
      });

      expect(saved.tasks[0].handoffChannel).toBe("manual_handoff");
      expect(saved.tasks[0].handoffPrompt).toContain("Pedit Codex Handoff");
      expect(saved.tasks[0].handoffPrompt).toContain("taskId=task-legacy-handoff");
      expect(saved.tasks[0].handoffPrompt).toContain("contextual_inpaint 表示选区是问题锚点，不是硬边界");
      expect(saved.tasks[0].handoffPrompt).toContain("最终写回 Pedit 的图片必须是你最终展示和验收的同一张图片");
    } finally {
      if (previousRuntimeFile === undefined) {
        delete process.env.PEDIT_RUNTIME_FILE;
      } else {
        process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("normalizes legacy annotation handoff tasks when reading runtime state", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-runtime-read-handoff-"));
    const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
    const runtimeFile = join(tempDir, "canvas-state.json");
    process.env.PEDIT_RUNTIME_FILE = runtimeFile;

    try {
      writeFileSync(
        runtimeFile,
        JSON.stringify({
          mode: "big_image_view",
          currentNodeId: null,
          selectedNodeIds: [],
          showHiddenNodes: false,
          nodes: [],
          tasks: [
            {
              id: "task-read-legacy",
              type: "region_edit",
              status: "pending",
              sourceNodeIds: ["source-a"],
              regions: [],
              instruction: "Change eye color",
              codexPrompt: "Use image2.",
              handoffChannel: "annotation_handoff",
              handoffPrompt: "Pedit Annotation Handoff\ntaskId=task-read-legacy",
              error: null,
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z"
            }
          ]
        })
      );

      const state = readRuntimeCanvasState();
      expect(state.tasks[0].handoffChannel).toBe("manual_handoff");
      expect(state.tasks[0].handoffPrompt).toContain("Pedit Codex Handoff");
      expect(state.tasks[0].handoffPrompt).toContain("最终写回 Pedit 的图片必须是你最终展示和验收的同一张图片");
    } finally {
      if (previousRuntimeFile === undefined) {
        delete process.env.PEDIT_RUNTIME_FILE;
      } else {
        process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("exposes status through the shared tool registry", () => {
    const result = invokePeditTool("pedit_status");

    expect(result).toMatchObject({
      toolName: "pedit_status",
      ok: true
    });
    expect(result.tools).toContain("pedit_get_canvas_state");
    expect(result.tools).toContain("pedit_export_current_image");
    expect(result.tools).toContain("pedit_open_canvas");
    expect(result.tools).toContain("pedit_claim_next_task");
    expect(result.tools).toContain("pedit_run_local_fast_path");
  });

  it("starts the local static canvas server through the open canvas tool", () => {
    const spawned: Array<{ command: string; args: string[]; cwd: string }> = [];
    const result = openPeditCanvas({
      pluginRoot: "/tmp/pedit",
      spawnProcess(command, args, options) {
        spawned.push({ command, args, cwd: options.cwd });
      }
    });

    expect(result).toEqual({
      toolName: "pedit_open_canvas",
      ok: true,
      canvasUrl: "http://127.0.0.1:5173",
      preferredSurface: "codex-sidebar",
      openInstruction: "Open canvasUrl in the Codex sidebar in-app browser.",
      launched: true
    });
    expect(spawned).toEqual([
      {
        command: "node",
        args: [
          "packages/server/dist/index.js",
          "--serve-canvas",
          "--host",
          "127.0.0.1",
          "--port",
          "5173"
        ],
        cwd: "/tmp/pedit"
      }
    ]);
  });

  it("invokes canvas state and export tools through the shared registry", () => {
    const currentProject = project();
    const state = invokePeditTool("pedit_get_canvas_state", {
      project: currentProject
    });
    const exported = invokePeditTool("pedit_export_current_image", {
      project: currentProject
    });

    expect(state).toMatchObject({
      toolName: "pedit_get_canvas_state",
      currentNodeId: "a"
    });
    expect(exported).toMatchObject({
      toolName: "pedit_export_current_image",
      nodeId: "a",
      imagePath: "images/a.png"
    });
  });

  it("exports the current runtime image without returning image data through the registry", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-runtime-export-"));
    const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    try {
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
            imageUrl: "data:image/png;base64,aW1hZ2U=",
            parentIds: [],
            hidden: false,
            deleted: false,
            position: { x: 0, y: 0 },
            summary: "",
            createdAt: "2026-07-01T00:00:00.000Z"
          }
        ],
        tasks: []
      });

      const exported = invokePeditTool("pedit_export_current_image", {
        filePath: join(tempDir, "source.png")
      });

      expect(exported).toMatchObject({
        toolName: "pedit_export_current_image",
        nodeId: "source-a",
        imagePath: join(tempDir, "source.png"),
        requiresClarification: false
      });
      expect(existsSync(join(tempDir, "source.png"))).toBe(true);
      expect(readFileSync(join(tempDir, "source.png")).toString("utf8")).toBe("image");
    } finally {
      if (previousRuntimeFile === undefined) {
        delete process.env.PEDIT_RUNTIME_FILE;
      } else {
        process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects region edit runtime results whose dimensions differ from the source image", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-runtime-dimension-"));
    const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    try {
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
            imageUrl: fakePngDataUrl(8, 6),
            parentIds: [],
            hidden: false,
            deleted: false,
            position: { x: 0, y: 0 },
            summary: "",
            createdAt: "2026-07-01T00:00:00.000Z"
          }
        ],
        tasks: [
          {
            id: "task-a",
            type: "region_edit",
            status: "running",
            sourceNodeIds: ["source-a"],
            regions: [],
            instruction: "Edit region",
            codexPrompt: "Edit region",
            error: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z"
          }
        ]
      });

      const updated = writeRuntimeGenerationResult({
        taskId: "task-a",
        imageUrl: fakePngDataUrl(4, 4)
      });

      expect(updated.nodes).toHaveLength(1);
      expect(updated.tasks[0]).toMatchObject({
        id: "task-a",
        status: "failed"
      });
      expect(updated.tasks[0]).not.toHaveProperty("resultNodeId");
      expect(updated.tasks[0].error).toContain("do not match source dimensions");
    } finally {
      if (previousRuntimeFile === undefined) {
        delete process.env.PEDIT_RUNTIME_FILE;
      } else {
        process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects successful runtime results that are not decodable images", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-runtime-invalid-image-"));
    const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    try {
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
            imageUrl: fakePngDataUrl(8, 6),
            parentIds: [],
            hidden: false,
            deleted: false,
            position: { x: 0, y: 0 },
            summary: "",
            createdAt: "2026-07-01T00:00:00.000Z"
          }
        ],
        tasks: [
          {
            id: "task-a",
            type: "multi_node_merge",
            status: "running",
            sourceNodeIds: ["source-a"],
            regions: [],
            instruction: "Generate",
            codexPrompt: "Generate",
            error: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z"
          }
        ]
      });

      const updated = writeRuntimeGenerationResult({
        taskId: "task-a",
        imageUrl: "data:image/png;base64,aW1hZ2U="
      });

      expect(updated.nodes).toHaveLength(1);
      expect(updated.tasks[0]).toMatchObject({
        id: "task-a",
        status: "failed"
      });
      expect(updated.tasks[0]).not.toHaveProperty("resultNodeId");
      expect(updated.tasks[0].error).toContain("Generated image could not be decoded");
    } finally {
      if (previousRuntimeFile === undefined) {
        delete process.env.PEDIT_RUNTIME_FILE;
      } else {
        process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects region edit results that fall below the configured fidelity byte floor", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-runtime-low-fidelity-"));
    const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    try {
      const sourceImage = `${fakePngDataUrl(8, 6)}${Buffer.alloc(4096).toString("base64")}`;
      const resultImage = fakePngDataUrl(8, 6);

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
            imageUrl: sourceImage,
            parentIds: [],
            hidden: false,
            deleted: false,
            position: { x: 0, y: 0 },
            summary: "",
            createdAt: "2026-07-01T00:00:00.000Z"
          }
        ],
        tasks: [
          {
            id: "task-a",
            type: "region_edit",
            status: "running",
            sourceNodeIds: ["source-a"],
            regions: [],
            instruction: "Edit region",
            codexPrompt: "Edit region",
            error: null,
            selectionSemantics: "strict_local",
            qualityGate: {
              minResultByteRatio: 0.9
            },
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z"
          }
        ]
      });

      const updated = writeRuntimeGenerationResult({
        taskId: "task-a",
        imageUrl: resultImage
      });

      expect(updated.nodes).toHaveLength(1);
      expect(updated.tasks[0]).toMatchObject({
        id: "task-a",
        status: "failed",
        qualityGate: {
          status: "failed"
        }
      });
      expect(updated.tasks[0].error).toContain("quality gate");
      expect(updated.tasks[0].error).toContain("too small");
    } finally {
      if (previousRuntimeFile === undefined) {
        delete process.env.PEDIT_RUNTIME_FILE;
      } else {
        process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reports ambiguous target when version mode has no selection", () => {
    const state = getCanvasState(
      project({
        mode: "version",
        currentNodeId: null,
        selectedNodeIds: [],
        graph: { nodes: [] },
        tasks: []
      })
    );

    expect(state.toolName).toBe("pedit_get_canvas_state");
    expect(state.requiresClarification).toBe(true);
  });

  it("appends a pending task without mutating the project", () => {
    const original = project({ tasks: [] });
    const task: PeditTask = {
      id: "task_1",
      type: "region_edit",
      sourceNodeId: "a",
      regions: [],
      status: "running",
      error: "old error"
    };

    const updated = createPendingTask(original, task);

    expect(original.tasks).toEqual([]);
    expect(updated.tasks).toEqual([{ ...task, status: "pending", error: null }]);
  });

  it("claims the next pending project task before Codex calls image2", () => {
    const task: PeditTask = {
      id: "task_claim",
      type: "multi_node_merge",
      sourceNodeIds: ["a", "b"],
      instruction: "Blend them",
      status: "pending",
      error: null
    };
    const original = project({
      graph: {
        nodes: [node("a"), node("b")]
      },
      tasks: [task]
    });

    const claimed = claimNextPendingTask(original);

    expect(original.tasks[0].status).toBe("pending");
    expect(claimed.claimedTask?.status).toBe("running");
    expect(claimed.modelRequest).toMatchObject({
      taskId: "task_claim",
      type: "multi_node_merge",
      instruction: "Blend them"
    });
    expect(claimed.project.tasks[0]).toMatchObject({
      id: "task_claim",
      status: "running",
      error: null
    });
  });

  it("keeps runtime canvas tasks pending until Codex explicitly claims them", () => {
    const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-runtime-"));
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    try {
      const task: RuntimeGenerationTask = {
        id: "task_waiting_for_codex",
        type: "region_edit",
        status: "pending",
        sourceNodeIds: ["root-image-group"],
        regions: [],
        instruction: "Change the background",
        codexPrompt: "Call image2",
        error: null,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z"
      };

      const updated = upsertRuntimeTask(task);

      expect(updated.tasks).toHaveLength(1);
      expect(updated.tasks[0]).toMatchObject({
        id: "task_waiting_for_codex",
        status: "pending",
        error: null
      });
    } finally {
      if (previousRuntimeFile === undefined) {
        delete process.env.PEDIT_RUNTIME_FILE;
      } else {
        process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("records MCP bridge task requests and tool calls in the runtime bridge state", () => {
    const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-runtime-bridge-"));
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    try {
      expect(readRuntimeBridgeStatus()).toMatchObject({
        mode: "mcp",
        status: "unavailable",
        automationId: "pedit-mcp",
        handoffMode: "manual_handoff",
        lastHandoffRequestAt: null,
        lastHandoffTaskId: null,
        lastHandoffChannel: null,
        lastWakeRequestAt: null,
        lastWakeTaskId: null,
        lastMcpToolCallAt: null,
        lastMcpToolName: null
      });

      const requested = recordRuntimeBridgeTaskRequest(
        "task_to_claim",
        "manual_handoff"
      );

      expect(requested).toMatchObject({
        status: "unavailable",
        automationId: "pedit-mcp",
        handoffMode: "manual_handoff",
        lastHandoffTaskId: "task_to_claim",
        lastHandoffChannel: "manual_handoff",
        lastWakeTaskId: "task_to_claim"
      });
      expect(requested.lastHandoffRequestAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
      );
      expect(requested.lastWakeRequestAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
      );
      expect(readRuntimeBridgeStatus().lastWakeTaskId).toBe("task_to_claim");
      expect(readRuntimeBridgeStatus().lastHandoffTaskId).toBe("task_to_claim");

      recordRuntimeMcpToolCall("pedit_claim_next_task");

      expect(readRuntimeBridgeStatus()).toMatchObject({
        status: "active",
        lastMcpToolName: "pedit_claim_next_task"
      });
    } finally {
      if (previousRuntimeFile === undefined) {
        delete process.env.PEDIT_RUNTIME_FILE;
      } else {
        process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("normalizes legacy annotation handoff channels in bridge status", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-runtime-bridge-legacy-"));
    const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    try {
      writeFileSync(
        join(tempDir, "bridge-state.json"),
        JSON.stringify({
          lastHandoffRequestAt: "2026-07-01T00:00:00.000Z",
          lastHandoffTaskId: "task-legacy",
          lastHandoffChannel: "annotation_handoff",
          lastWakeRequestAt: "2026-07-01T00:00:00.000Z",
          lastWakeTaskId: "task-legacy",
          lastMcpToolCallAt: null,
          lastMcpToolName: null
        })
      );

      expect(readRuntimeBridgeStatus()).toMatchObject({
        handoffMode: "manual_handoff",
        lastHandoffTaskId: "task-legacy",
        lastHandoffChannel: "manual_handoff"
      });
    } finally {
      if (previousRuntimeFile === undefined) {
        delete process.env.PEDIT_RUNTIME_FILE;
      } else {
        process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("builds a regional model request with source image and masks", () => {
    const task: PeditTask = {
      id: "task_regions",
      type: "region_edit",
      sourceNodeId: "a",
      regions: [
        {
          id: "region-1",
          label: "Region 1",
          maskPath: "masks/r1.png",
          instruction: "Change to green"
        },
        {
          id: "region-2",
          label: "Region 2",
          maskPath: "masks/r2.png",
          instruction: "Use wood texture"
        }
      ],
      status: "pending",
      error: null
    };

    expect(createModelGenerationRequest(project(), task)).toEqual({
      taskId: "task_regions",
      type: "region_edit",
      sourceNodeId: "a",
      sourceImagePath: "images/a.png",
      regions: [
        {
          id: "region-1",
          label: "Region 1",
          maskPath: "masks/r1.png",
          instruction: "Change to green"
        },
        {
          id: "region-2",
          label: "Region 2",
          maskPath: "masks/r2.png",
          instruction: "Use wood texture"
        }
      ]
    });
  });

  it("builds a multi-image model request from selected source nodes", () => {
    const task: PeditTask = {
      id: "task_merge",
      type: "multi_node_merge",
      sourceNodeIds: ["a", "b"],
      instruction: "Use A as structure and B as material reference",
      status: "pending",
      error: null
    };
    const currentProject = project({
      graph: {
        nodes: [node("a"), node("b")]
      },
      tasks: [task]
    });

    expect(listPendingModelRequests(currentProject)).toEqual([
      {
        taskId: "task_merge",
        type: "multi_node_merge",
        sourceNodeIds: ["a", "b"],
        sourceImagePaths: ["images/a.png", "images/b.png"],
        instruction: "Use A as structure and B as material reference"
      }
    ]);
  });

  it("creates a region edit generation result node connected to the source parent", () => {
    const task: PeditTask = {
      id: "task_1",
      type: "region_edit",
      sourceNodeId: "a",
      regions: [],
      status: "running",
      error: null
    };

    const result = writeGenerationResult({
      nodes: [node("a")],
      tasks: [task],
      taskId: task.id,
      resultNodeId: "b",
      imagePath: "images/b.png",
      thumbnailPath: "thumbs/b.png",
      summary: "Edited A"
    });

    expect(result.nodes.find((candidate) => candidate.id === "b")?.parentIds).toEqual(["a"]);
    expect(result.summary).toBe("Edited A");
    expect(result.nodes.find((candidate) => candidate.id === "b")?.createdByTaskId).toBe("task_1");
    expect(result.tasks.find((candidate) => candidate.id === "task_1")).toMatchObject({
      status: "succeeded",
      resultNodeId: "b",
      error: null
    });
  });

  it("creates a merge result node connected to all source parents", () => {
    const task: PeditTask = {
      id: "task_2",
      type: "multi_node_merge",
      sourceNodeIds: ["a", "b"],
      instruction: "Blend them",
      status: "running",
      error: null
    };

    const result = writeGenerationResult({
      nodes: [node("a"), node("b")],
      tasks: [task],
      taskId: task.id,
      resultNodeId: "merged",
      imagePath: "images/merged.png",
      thumbnailPath: "thumbs/merged.png"
    });

    expect(result.nodes.find((candidate) => candidate.id === "merged")?.parentIds).toEqual(["a", "b"]);
    expect(result.nodes.find((candidate) => candidate.id === "merged")?.kind).toBe("merge");
  });

  it("marks failed generation results without creating a node", () => {
    const task: PeditTask = {
      id: "task_3",
      type: "region_edit",
      sourceNodeId: "a",
      regions: [],
      status: "running",
      error: null
    };

    const result = writeGenerationResult({
      nodes: [node("a")],
      tasks: [task],
      taskId: task.id,
      error: "Generator unavailable"
    });

    expect(result.nodes).toEqual([node("a")]);
    expect(result.tasks.find((candidate) => candidate.id === "task_3")).toMatchObject({
      status: "failed",
      error: "Generator unavailable"
    });
  });

  it("round trips deterministic mock generation metadata into a result node", () => {
    const task: PeditTask = {
      id: "task mock/4",
      type: "region_edit",
      sourceNodeId: "a",
      regions: [],
      status: "running",
      error: null
    };
    const mockResult = createMockGenerationResult(task);

    const result = writeGenerationResult({
      nodes: [node("a")],
      tasks: [task],
      taskId: task.id,
      ...mockResult
    });

    expect(mockResult).toEqual({
      resultNodeId: "mock_task_mock_4_result",
      imagePath: "images/mock_task_mock_4_result.png",
      thumbnailPath: "thumbs/mock_task_mock_4_result.png",
      summary: "Mock region edit result for a"
    });
    expect(result.resultNode).toMatchObject({
      id: mockResult.resultNodeId,
      imagePath: mockResult.imagePath,
      thumbnailPath: mockResult.thumbnailPath,
      parentIds: ["a"]
    });
  });

  it("reports current image export ambiguity when no current image is selected", () => {
    const result = exportCurrentImage(project({ currentNodeId: null }));

    expect(result.toolName).toBe("pedit_export_current_image");
    expect(result.requiresClarification).toBe(true);
    expect(result.imagePath).toBeNull();
  });

  it("only exports the current image while in big image view mode", () => {
    const editResult = exportCurrentImage(project({ mode: "big_image_edit" }));
    const versionResult = exportCurrentImage(project({ mode: "version", selectedNodeIds: ["a"] }));

    expect(editResult).toMatchObject({
      requiresClarification: true,
      clarificationReason: "Current image export is only available in big image view mode."
    });
    expect(versionResult).toMatchObject({
      requiresClarification: true,
      clarificationReason: "Current image export is only available in big image view mode."
    });
  });

  it("reports current image export ambiguity when the current image was deleted", () => {
    const result = exportCurrentImage(
      project({
        graph: {
          nodes: [{ ...node("a"), deleted: true }]
        }
      })
    );

    expect(result).toMatchObject({
      nodeId: "a",
      imagePath: null,
      thumbnailPath: null,
      requiresClarification: true,
      clarificationReason: "Current image node could not be found or has been deleted."
    });
  });

  it("resolves generation results by taskId from the provided tasks", () => {
    const standaloneTask: PeditTask = {
      id: "standalone",
      type: "region_edit",
      sourceNodeId: "wrong",
      regions: [],
      status: "running",
      error: null
    };
    const providedTask: PeditTask = {
      id: "task_4",
      type: "region_edit",
      sourceNodeId: "a",
      regions: [],
      status: "running",
      error: null
    };

    const result = writeGenerationResult({
      nodes: [node("a"), node("wrong")],
      tasks: [providedTask],
      task: standaloneTask,
      taskId: providedTask.id,
      resultNodeId: "b",
      imagePath: "images/b.png",
      thumbnailPath: "thumbs/b.png"
    });

    expect(result.task.id).toBe("task_4");
    expect(result.resultNode?.parentIds).toEqual(["a"]);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.id).toBe("task_4");
  });

  it("throws a clear error before creating a node when taskId cannot be resolved", () => {
    expect(() =>
      writeGenerationResult({
        nodes: [node("a")],
        tasks: [],
        taskId: "missing",
        resultNodeId: "b",
        imagePath: "images/b.png",
        thumbnailPath: "thumbs/b.png"
      })
    ).toThrow("Task missing could not be found in provided tasks.");
  });

  it("rejects writing generation results to terminal tasks", () => {
    const succeededTask: PeditTask = {
      id: "task_5",
      type: "region_edit",
      sourceNodeId: "a",
      regions: [],
      status: "succeeded",
      error: null,
      resultNodeId: "old"
    };
    const failedTask: PeditTask = {
      id: "task_6",
      type: "multi_node_merge",
      sourceNodeIds: ["a", "b"],
      instruction: "Blend them",
      status: "failed",
      error: "old error"
    };

    expect(() =>
      writeGenerationResult({
        nodes: [node("a")],
        tasks: [succeededTask],
        taskId: succeededTask.id,
        resultNodeId: "b",
        imagePath: "images/b.png",
        thumbnailPath: "thumbs/b.png"
      })
    ).toThrow("Task task_5 is already succeeded and cannot be written.");

    expect(() =>
      writeGenerationResult({
        nodes: [node("a"), node("b")],
        tasks: [failedTask],
        taskId: failedTask.id,
        error: "new error"
      })
    ).toThrow("Task task_6 is already failed and cannot be written.");
  });

  it("throws clear errors for malformed task types", () => {
    const malformedTask = {
      id: "task_bad",
      type: "unexpected_task",
      sourceNodeIds: ["a", "b"],
      status: "running",
      error: null
    } as unknown as PeditTask;

    expect(() =>
      writeGenerationResult({
        nodes: [node("a"), node("b")],
        tasks: [malformedTask],
        taskId: malformedTask.id,
        resultNodeId: "bad",
        imagePath: "images/bad.png",
        thumbnailPath: "thumbs/bad.png"
      })
    ).toThrow("Unsupported task type unexpected_task.");

    expect(() => createPendingTask(project({ tasks: [] }), malformedTask)).toThrow(
      "Unsupported task type unexpected_task."
    );
    expect(() => createMockGenerationResult(malformedTask)).toThrow("Unsupported task type unexpected_task.");
  });
});
