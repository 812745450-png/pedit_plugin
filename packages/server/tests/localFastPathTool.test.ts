import { deflateSync, inflateSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readRuntimeCanvasState,
  writeRuntimeCanvasState,
  type RuntimeGenerationTask
} from "../src/runtime/canvasRuntimeStore.js";
import { readRuntimeImageUrlBytesSync } from "../src/runtime/runtimeAssets.js";
import { invokePeditTool } from "../src/tools/registry.js";

let tempRoot: string | null = null;

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

interface RgbaImage {
  width: number;
  height: number;
  data: Buffer;
}

const baseTask = (overrides: Partial<RuntimeGenerationTask> = {}): RuntimeGenerationTask => ({
  id: "task-local-fast",
  type: "region_edit",
  status: "running",
  sourceNodeIds: ["source-a"],
  selectionSemantics: "strict_local",
  regions: [
    {
      id: "region-eye",
      label: "区域 1",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ],
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      instruction: "把眼睛换成蓝色"
    }
  ],
  instruction: "区域 1: 把这只眼睛换成蓝色",
  codexPrompt: "Use the local high-fidelity path when possible.",
  error: null,
  createdAt: "2026-07-03T00:00:00.000Z",
  updatedAt: "2026-07-03T00:00:00.000Z",
  ...overrides
});

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
  delete process.env.PEDIT_RUNTIME_FILE;
});

describe("local fast-path tool", () => {
  it("keeps claimed strict local eye recolors high fidelity without invoking image2", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "pedit-local-fast-tool-"));
    process.env.PEDIT_RUNTIME_FILE = join(tempRoot, "canvas-state.json");
    const source = createRgbaPngDataUrl({
      width: 4,
      height: 4,
      data: Buffer.from([
        240, 240, 235, 255, 150, 150, 150, 255, 12, 10, 9, 255, 238, 238, 238, 255,
        145, 145, 145, 255, 96, 58, 32, 255, 102, 64, 36, 255, 142, 142, 142, 255,
        235, 235, 232, 255, 108, 70, 42, 255, 18, 16, 14, 255, 148, 148, 148, 255,
        244, 244, 240, 255, 152, 152, 152, 255, 146, 146, 146, 255, 236, 236, 232, 255
      ])
    });

    writeRuntimeCanvasState({
      mode: "big_image_edit",
      currentNodeId: "source-a",
      selectedNodeIds: ["source-a"],
      showHiddenNodes: false,
      nodes: [
        {
          id: "source-a",
          name: "Source",
          kind: "source",
          imageUrl: source,
          parentIds: [],
          hidden: false,
          deleted: false,
          position: { x: 0, y: 0 },
          summary: "",
          createdAt: "2026-07-03T00:00:00.000Z"
        }
      ],
      tasks: [baseTask()]
    });

    const result = invokePeditTool("pedit_run_local_fast_path", {
      taskId: "task-local-fast"
    });

    const state = readRuntimeCanvasState();
    expect(result).toMatchObject({
      toolName: "pedit_run_local_fast_path",
      ok: true,
      taskId: "task-local-fast"
    });
    expect(state.tasks[0]).toMatchObject({
      status: "succeeded",
      error: null
    });
    expect(state.nodes).toHaveLength(2);
    expect(state.currentNodeId).toBe(state.tasks[0].resultNodeId);

    const output = decodeFilter0RgbaPng(
      readRuntimeImageUrlBytesSync(state.nodes[1].imageUrl)
    );
    expect(output.width).toBe(4);
    expect(output.height).toBe(4);

    const iris = pixelAt(output, 1, 1);
    const whiteFur = pixelAt(output, 0, 0);
    const greyFur = pixelAt(output, 1, 3);
    const pupil = pixelAt(output, 2, 0);

    expect(iris.b).toBeGreaterThan(iris.r);
    expect(iris.b).toBeGreaterThan(iris.g);
    expect(whiteFur).toEqual({ r: 240, g: 240, b: 235, a: 255 });
    expect(greyFur).toEqual({ r: 152, g: 152, b: 152, a: 255 });
    expect(pupil.b - pupil.r).toBeLessThanOrEqual(8);
  });

  it("requires the task to be claimed before the local fast path writes a result", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "pedit-local-fast-pending-"));
    process.env.PEDIT_RUNTIME_FILE = join(tempRoot, "canvas-state.json");

    writeRuntimeCanvasState({
      mode: "big_image_edit",
      currentNodeId: "source-a",
      selectedNodeIds: ["source-a"],
      showHiddenNodes: false,
      nodes: [
        {
          id: "source-a",
          name: "Source",
          kind: "source",
          imageUrl: createRgbaPngDataUrl({
            width: 2,
            height: 2,
            data: Buffer.from([
              96, 58, 32, 255, 96, 58, 32, 255,
              96, 58, 32, 255, 96, 58, 32, 255
            ])
          }),
          parentIds: [],
          hidden: false,
          deleted: false,
          position: { x: 0, y: 0 },
          summary: "",
          createdAt: "2026-07-03T00:00:00.000Z"
        }
      ],
      tasks: [baseTask({ status: "pending" })]
    });

    const result = invokePeditTool("pedit_run_local_fast_path", {
      taskId: "task-local-fast"
    });

    const state = readRuntimeCanvasState();
    expect(result).toMatchObject({
      toolName: "pedit_run_local_fast_path",
      ok: false,
      taskId: "task-local-fast",
      error: expect.stringContaining("pedit_claim_next_task")
    });
    expect(state.tasks[0].status).toBe("pending");
    expect(state.nodes).toHaveLength(1);
  });

  it("does not write a version node for packaging text and flower replacement tasks", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "pedit-local-fast-complex-"));
    process.env.PEDIT_RUNTIME_FILE = join(tempRoot, "canvas-state.json");

    writeRuntimeCanvasState({
      mode: "big_image_edit",
      currentNodeId: "source-a",
      selectedNodeIds: ["source-a"],
      showHiddenNodes: false,
      nodes: [
        {
          id: "source-a",
          name: "Source",
          kind: "source",
          imageUrl: createRgbaPngDataUrl({
            width: 2,
            height: 2,
            data: Buffer.from([
              235, 190, 32, 255, 235, 190, 32, 255,
              235, 190, 32, 255, 235, 190, 32, 255
            ])
          }),
          parentIds: [],
          hidden: false,
          deleted: false,
          position: { x: 0, y: 0 },
          summary: "",
          createdAt: "2026-07-03T00:00:00.000Z"
        }
      ],
      tasks: [
        baseTask({
          instruction:
            "区域 1: 这朵菊花换成白菊，并且包装上的文字“特品菊花”换为菊花茶的英文名",
          regions: [
            {
              id: "region-package",
              label: "区域 1",
              points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 100, y: 100 },
                { x: 0, y: 100 }
              ],
              bounds: { x: 0, y: 0, width: 100, height: 100 },
              instruction:
                "这朵菊花换成白菊，并且包装上的文字“特品菊花”换为菊花茶的英文名"
            }
          ]
        })
      ]
    });

    const result = invokePeditTool("pedit_run_local_fast_path", {
      taskId: "task-local-fast"
    });

    const state = readRuntimeCanvasState();
    expect(result).toMatchObject({
      toolName: "pedit_run_local_fast_path",
      ok: false,
      unsupported: true,
      taskId: "task-local-fast",
      resultNodeId: null
    });
    expect(state.tasks[0].status).toBe("running");
    expect(state.tasks[0].resultNodeId).toBeUndefined();
    expect(state.nodes).toHaveLength(1);
  });
});

const createRgbaPngDataUrl = (image: RgbaImage) =>
  `data:image/png;base64,${encodeRgbaPng(image).toString("base64")}`;

const encodeRgbaPng = (image: RgbaImage) => {
  const rowLength = image.width * 4;
  const raw = Buffer.alloc((rowLength + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * (rowLength + 1);
    raw[rowStart] = 0;
    image.data.copy(raw, rowStart + 1, y * rowLength, (y + 1) * rowLength);
  }

  return Buffer.concat([
    pngSignature,
    pngChunk("IHDR", pngHeader(image.width, image.height)),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
};

const decodeFilter0RgbaPng = (bytes: Buffer): RgbaImage => {
  expect(bytes.subarray(0, 8).equals(pngSignature)).toBe(true);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === "IHDR") {
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
    } else if (type === "IDAT") {
      idatChunks.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  const raw = inflateSync(Buffer.concat(idatChunks));
  const data = Buffer.alloc(width * height * 4);
  const rowLength = width * 4;
  for (let y = 0; y < height; y += 1) {
    expect(raw[y * (rowLength + 1)]).toBe(0);
    raw.copy(
      data,
      y * rowLength,
      y * (rowLength + 1) + 1,
      y * (rowLength + 1) + 1 + rowLength
    );
  }

  return { width, height, data };
};

const pngHeader = (width: number, height: number) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return header;
};

const pngChunk = (type: string, data: Buffer) => {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
};

const crc32 = (data: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pixelAt = (image: RgbaImage, x: number, y: number) => {
  const offset = (y * image.width + x) * 4;
  return {
    r: image.data[offset],
    g: image.data[offset + 1],
    b: image.data[offset + 2],
    a: image.data[offset + 3]
  };
};
