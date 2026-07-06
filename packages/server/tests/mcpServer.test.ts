import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMcpResponse,
  encodeMcpMessage,
  handleMcpRequest,
  parseMcpFrames
} from "../src/mcpServer.js";
import { writeRuntimeCanvasState } from "../src/runtime/canvasRuntimeStore.js";
import { readRuntimeBridgeStatus } from "../src/runtime/bridgeRuntimeStore.js";

describe("MCP stdio server contract", () => {
  it("lists Pedit tools through the MCP tools/list method", () => {
    const response = handleMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "pedit_status" }),
          expect.objectContaining({ name: "pedit_open_canvas" }),
          expect.objectContaining({ name: "pedit_get_canvas_state" }),
          expect.objectContaining({ name: "pedit_create_pending_task" }),
          expect.objectContaining({ name: "pedit_claim_next_task" }),
          expect.objectContaining({ name: "pedit_run_local_fast_path" }),
          expect.objectContaining({ name: "pedit_write_generation_result" }),
          expect.objectContaining({ name: "pedit_export_current_image" })
        ])
      }
    });
  });

  it("calls pedit_status through the MCP tools/call method", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-mcp-bridge-test-"));
    const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    try {
      expect(readRuntimeBridgeStatus().status).toBe("unavailable");

      const response = handleMcpRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "pedit_status",
          arguments: {}
        }
      });

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 2,
        result: {
          content: [
            expect.objectContaining({
              type: "text",
              text: expect.stringContaining('"ok": true')
            })
          ]
        }
      });
      expect(readRuntimeBridgeStatus()).toMatchObject({
        status: "active",
        lastMcpToolName: "pedit_status"
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

  it("omits data URLs from MCP canvas state responses", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-mcp-test-"));
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
            imageUrl: "data:image/png;base64,large-image-payload",
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

      const response = handleMcpRequest({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "pedit_get_canvas_state",
          arguments: {}
        }
      });
      const text = response?.result?.content?.[0]?.text;

      expect(text).toContain("/runtime-assets/source-a-");
      expect(text).not.toContain("data:image");
      expect(text).not.toContain("large-image-payload");
    } finally {
      if (previousRuntimeFile === undefined) {
        delete process.env.PEDIT_RUNTIME_FILE;
      } else {
        process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("compacts verbose task prompts and long polygons in MCP responses", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-mcp-compact-test-"));
    const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    try {
      writeRuntimeCanvasState({
        mode: "big_image_view",
        currentNodeId: "source-a",
        selectedNodeIds: ["source-a"],
        showHiddenNodes: false,
        nodes: [],
        tasks: [
          {
            id: "task-compact",
            type: "region_edit",
            status: "pending",
            sourceNodeIds: ["source-a"],
            regions: [
              {
                id: "region-1",
                label: "区域 1",
                points: Array.from({ length: 32 }, (_, index) => ({
                  x: index,
                  y: index + 1
                })),
                bounds: { x: 1, y: 2, width: 3, height: 4 },
                maskPath: "/tmp/mask.png",
                maskSize: { width: 100, height: 100 },
                maskStatus: "ready",
                instruction: "精修"
              }
            ],
            instruction: "精修",
            codexPrompt: "x".repeat(5000),
            error: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z"
          }
        ]
      });

      const response = handleMcpRequest({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "pedit_get_canvas_state",
          arguments: {}
        }
      });
      const text = response?.result?.content?.[0]?.text;

      expect(text).toContain("[omitted codexPrompt: 5000 chars");
      expect(text).toContain('"omitted": 16');
      expect(text).toContain('"maskPath": "/tmp/mask.png"');
      expect(text).not.toContain("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    } finally {
      if (previousRuntimeFile === undefined) {
        delete process.env.PEDIT_RUNTIME_FILE;
      } else {
        process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("encodes and parses MCP Content-Length frames", () => {
    const message = createMcpResponse(3, { ok: true });
    const frame = encodeMcpMessage(message);
    const parsed = parseMcpFrames(Buffer.from(frame, "utf8"));

    expect(parsed.messages).toEqual([message]);
    expect(parsed.remaining.length).toBe(0);
  });
});
