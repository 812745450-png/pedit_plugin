import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeCanvasState, RuntimeGenerationTask } from "../src/runtime/canvasRuntimeStore";
import {
  createRegionMaskPngDataUrl,
  enrichRuntimeTaskRegionMasks,
  maxInlineMaskPixels,
  readImageDimensions
} from "../src/runtime/regionMask";

const previousRuntimeFile = process.env.PEDIT_RUNTIME_FILE;
const tempDirs: string[] = [];

afterEach(() => {
  if (previousRuntimeFile === undefined) {
    delete process.env.PEDIT_RUNTIME_FILE;
  } else {
    process.env.PEDIT_RUNTIME_FILE = previousRuntimeFile;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime region masks", () => {
  it("creates an RGBA PNG mask with transparent pixels inside the polygon", () => {
    const maskUrl = createRegionMaskPngDataUrl(
      [
        { x: 25, y: 25 },
        { x: 75, y: 25 },
        { x: 75, y: 75 },
        { x: 25, y: 75 }
      ],
      4,
      4
    );
    const png = Buffer.from(maskUrl.split(",")[1], "base64");
    const decoded = decodeRgbaPng(png);

    expect(readImageDimensions(maskUrl)).toEqual({ width: 4, height: 4 });
    expect(alphaAt(decoded, 0, 0)).toBe(255);
    expect(alphaAt(decoded, 2, 2)).toBe(0);
  });

  it("adds generated mask assets to runtime region edit tasks", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-mask-test-"));
    tempDirs.push(tempDir);
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");
    const sourceImageUrl = createRegionMaskPngDataUrl([], 8, 6);
    const state: RuntimeCanvasState = {
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
    };
    const task: RuntimeGenerationTask = {
      id: "task-a",
      type: "region_edit",
      status: "pending",
      sourceNodeIds: ["source-a"],
      regions: [
        {
          id: "region-a",
          label: "区域 1",
          points: [
            { x: 25, y: 25 },
            { x: 75, y: 25 },
            { x: 75, y: 75 },
            { x: 25, y: 75 }
          ],
          instruction: "Edit inside"
        }
      ],
      instruction: "区域 1: Edit inside",
      codexPrompt: "Pedit task task-a",
      error: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    };

    const enriched = enrichRuntimeTaskRegionMasks(state, task);
    const maskPath = enriched.regions?.[0].maskPath;

    expect(maskPath).toMatch(/region-a\.png$/);
    expect(maskPath && existsSync(maskPath)).toBe(true);
    expect(maskPath && decodeRgbaPng(readFileSync(maskPath))).toMatchObject({
      width: 8,
      height: 6
    });
    expect(enriched.regions?.[0].maskUrl).toBeUndefined();
    expect(enriched.regions?.[0].maskSize).toEqual({ width: 8, height: 6 });
    expect(enriched.regions?.[0].maskStatus).toBe("ready");
    expect(enriched.codexPrompt).toContain("task.regions[].maskPath");
  });

  it("describes contextual inpaint masks as soft problem anchors", () => {
    const enriched = enrichRuntimeTaskRegionMasks(
      runtimeState(fakePngDataUrl(8, 6)),
      {
        ...runtimeTask(),
        selectionSemantics: "contextual_inpaint",
        instruction: "区域 1: 移除衣物",
        codexPrompt: "Pedit task task-a"
      }
    );

    expect(enriched.codexPrompt).toContain("For contextual inpaint tasks, use the mask as the primary problem area");
    expect(enriched.codexPrompt).toContain("outside pixels are preservation targets, not an absolute hard boundary");
    expect(enriched.codexPrompt).not.toContain("opaque pixels must be preserved");
    expect(enriched.codexPrompt).not.toContain("preserve everything outside the target region as strictly");
  });

  it("creates masks for static canvas asset source images when distDir is provided", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-mask-static-test-"));
    tempDirs.push(tempDir);
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");
    const distDir = join(tempDir, "dist");
    mkdirSync(join(distDir, "samples"), { recursive: true });
    writeFileSync(
      join(distDir, "samples", "person.png"),
      Buffer.from(fakePngDataUrl(8, 6).split(",")[1], "base64")
    );

    const enriched = enrichRuntimeTaskRegionMasks(
      runtimeState("/samples/person.png"),
      runtimeTask(),
      distDir
    );

    const maskPath = enriched.regions?.[0].maskPath;
    expect(maskPath && existsSync(maskPath)).toBe(true);
    expect(maskPath && decodeRgbaPng(readFileSync(maskPath))).toMatchObject({
      width: 8,
      height: 6
    });
    expect(enriched.regions?.[0].maskStatus).toBe("ready");
  });

  it("skips inline mask generation for oversized source images", () => {
    const sourceImageUrl = fakePngDataUrl(5000, 5000);
    const enriched = enrichRuntimeTaskRegionMasks(
      runtimeState(sourceImageUrl),
      runtimeTask()
    );

    expect(5000 * 5000).toBeGreaterThan(maxInlineMaskPixels);
    expect(enriched.regions?.[0].maskUrl).toBeUndefined();
    expect(enriched.regions?.[0].maskPath).toBeUndefined();
    expect(enriched.regions?.[0].maskSize).toEqual({ width: 5000, height: 5000 });
    expect(enriched.regions?.[0].maskStatus).toBe("skipped_too_large");
    expect(enriched.regions?.[0].maskReason).toContain("mask generation is capped");
    expect(enriched.codexPrompt).toContain("Continue with polygon/bounds");
  });

  it("keeps region tasks usable when source dimensions cannot be read", () => {
    const enriched = enrichRuntimeTaskRegionMasks(
      runtimeState("data:image/webp;base64,not-a-readable-test-image"),
      runtimeTask()
    );

    expect(enriched.regions?.[0].maskUrl).toBeUndefined();
    expect(enriched.regions?.[0].maskPath).toBeUndefined();
    expect(enriched.regions?.[0].maskStatus).toBe("skipped_unsupported_source");
    expect(enriched.codexPrompt).toContain("Continue with polygon/bounds");
  });
});

const decodeRgbaPng = (png: Buffer) => {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idatParts: Buffer[] = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  return {
    width,
    height,
    raw: inflateSync(Buffer.concat(idatParts))
  };
};

const alphaAt = (
  image: { width: number; raw: Buffer },
  x: number,
  y: number
) => image.raw[y * (image.width * 4 + 1) + 1 + x * 4 + 3];

const runtimeState = (imageUrl: string): RuntimeCanvasState => ({
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
  tasks: []
});

const runtimeTask = (): RuntimeGenerationTask => ({
  id: "task-a",
  type: "region_edit",
  status: "pending",
  sourceNodeIds: ["source-a"],
  regions: [
    {
      id: "region-a",
      label: "区域 1",
      points: [
        { x: 25, y: 25 },
        { x: 75, y: 25 },
        { x: 75, y: 75 },
        { x: 25, y: 75 }
      ],
      instruction: "Edit inside"
    }
  ],
  instruction: "区域 1: Edit inside",
  codexPrompt: "Pedit task task-a",
  error: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
});

const fakePngDataUrl = (width: number, height: number) => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  Buffer.from("IHDR", "ascii").copy(png, 12);
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return `data:image/png;base64,${png.toString("base64")}`;
};
