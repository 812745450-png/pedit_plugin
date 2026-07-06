import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import type {
  RuntimeCanvasState,
  RuntimeGenerationTask,
  RuntimeRegionDraft,
  RuntimeSelectionSemantics
} from "./canvasRuntimeStore.js";
import {
  readRuntimeImageDimensions,
  runtimeFilePath
} from "./runtimeAssets.js";

interface ImageDimensions {
  width: number;
  height: number;
}

export const maxInlineMaskPixels = 16_777_216;

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

export const enrichRuntimeTaskRegionMasks = (
  state: RuntimeCanvasState,
  task: RuntimeGenerationTask,
  distDir?: string
): RuntimeGenerationTask => {
  if (task.type !== "region_edit" || !task.regions?.length) {
    return task;
  }

  const sourceNode = state.nodes.find((node) => node.id === task.sourceNodeIds[0]);
  const dimensions = sourceNode ? readImageDimensions(sourceNode.imageUrl, distDir) : null;

  if (!dimensions) {
    return {
      ...task,
      regions: task.regions.map((region) => ({
        ...region,
        maskStatus: region.maskUrl || region.maskPath ? "ready" : "skipped_unsupported_source",
        maskReason: region.maskUrl || region.maskPath
          ? region.maskReason
          : "Source image dimensions could not be read from the runtime image URL."
      })),
      codexPrompt: withMaskPromptContract(task.codexPrompt, task.selectionSemantics)
    };
  }

  if (dimensions.width * dimensions.height > maxInlineMaskPixels) {
    return {
      ...task,
      regions: task.regions.map((region) => ({
        ...region,
        maskSize: dimensions,
        maskStatus: region.maskUrl || region.maskPath ? "ready" : "skipped_too_large",
        maskReason: region.maskUrl || region.maskPath
          ? region.maskReason
          : `Source image is ${dimensions.width}x${dimensions.height}; mask generation is capped at ${maxInlineMaskPixels} pixels to avoid runtime memory and state-size blowups.`
      })),
      codexPrompt: withMaskPromptContract(task.codexPrompt, task.selectionSemantics)
    };
  }

  const regions: RuntimeRegionDraft[] = task.regions.map((region) => {
    if (region.maskUrl || region.maskPath || region.points.length < 3) {
      return {
        ...region,
        maskStatus: region.maskUrl || region.maskPath ? "ready" : region.maskStatus,
        maskSize:
          region.maskUrl || region.maskPath
            ? (region.maskSize ?? dimensions)
            : region.maskSize
      };
    }

    const maskPath = writeRegionMaskPng(
      task.id,
      region.id,
      createRegionMaskPng(region.points, dimensions.width, dimensions.height)
    );

    return {
      ...region,
      maskPath,
      maskSize: dimensions,
      maskStatus: "ready" as const
    };
  });

  return {
    ...task,
    regions,
    codexPrompt: withMaskPromptContract(task.codexPrompt, task.selectionSemantics)
  };
};

export const createRegionMaskPngDataUrl = (
  points: RuntimeRegionDraft["points"],
  width: number,
  height: number
) => `data:image/png;base64,${createRegionMaskPng(points, width, height).toString("base64")}`;

export const createRegionMaskPng = (
  points: RuntimeRegionDraft["points"],
  width: number,
  height: number
) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Mask dimensions must be positive integers.");
  }

  const raw = Buffer.alloc((width * 4 + 1) * height, 255);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
  }

  const bounds = regionPixelBounds(points, width, height);
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (isPointInPolygon(((x + 0.5) / width) * 100, ((y + 0.5) / height) * 100, points)) {
        const offset = y * (width * 4 + 1) + 1 + x * 4;
        raw[offset + 3] = 0;
      }
    }
  }

  return Buffer.concat([
    pngSignature,
    pngChunk("IHDR", pngHeader(width, height)),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
};

export const readImageDimensions = (imageUrl: string, distDir?: string): ImageDimensions | null =>
  readRuntimeImageDimensions(imageUrl, distDir);

const withMaskPromptContract = (
  prompt: string,
  selectionSemantics: RuntimeSelectionSemantics = "soft_local"
) => {
  if (prompt.includes("task.regions[].maskPath") || prompt.includes("task.regions[].maskUrl")) {
    return prompt;
  }

  return [
    prompt,
    "Mask assets:",
    maskAssetsInstruction(selectionSemantics),
    maskFallbackInstruction(selectionSemantics)
  ].join("\n");
};

const maskAssetsInstruction = (selectionSemantics: RuntimeSelectionSemantics) => {
  if (selectionSemantics === "strict_local") {
    return "When a region includes task.regions[].maskPath or task.regions[].maskUrl, it is an RGBA PNG mask for the first source image: fully transparent pixels are the editable area and opaque pixels must be preserved. Prefer the mask for image-edit APIs that support masks; use polygon/bbox as the audit fallback.";
  }

  if (selectionSemantics === "contextual_inpaint") {
    return "When a region includes task.regions[].maskPath or task.regions[].maskUrl, it is an RGBA PNG mask for the first source image. For contextual inpaint tasks, use the mask as the primary problem area and use polygon/bbox plus surrounding image context as the audit fallback; outside pixels are preservation targets, not an absolute hard boundary, so a narrow transition area may be adjusted when required to remove seams and keep texture, lighting, shadows, and physical structure coherent.";
  }

  if (selectionSemantics === "global_edit") {
    return "When a region includes task.regions[].maskPath or task.regions[].maskUrl, it is an RGBA PNG attention mask for the first source image. Use it to locate the user's focus while preserving identity, composition, resolution, and unrelated details across the whole image.";
  }

  return "When a region includes task.regions[].maskPath or task.regions[].maskUrl, it is an RGBA PNG mask for the first source image. Use the selected area as the main target and allow only subtle nearby blending when required for a natural photographic result.";
};

const maskFallbackInstruction = (selectionSemantics: RuntimeSelectionSemantics) => {
  if (selectionSemantics === "strict_local") {
    return "If maskStatus is skipped_too_large or skipped_unsupported_source, do not treat that as a failed task. Continue with polygon/bounds and preserve everything outside the target region as strictly as the active image tool allows.";
  }

  return "If maskStatus is skipped_too_large or skipped_unsupported_source, do not treat that as a failed task. Continue with polygon/bounds, using the selection as the target anchor and preserving everything outside the contextual edit area.";
};

const writeRegionMaskPng = (taskId: string, regionId: string, bytes: Buffer) => {
  const maskDir = join(dirname(runtimeFilePath()), "masks", safeSegment(taskId));
  mkdirSync(maskDir, { recursive: true });
  const maskPath = join(maskDir, `${safeSegment(regionId)}.png`);
  writeFileSync(maskPath, bytes);
  return maskPath;
};

const safeSegment = (value: string) => value.replace(/[^a-zA-Z0-9_.-]/g, "_");


const regionPixelBounds = (
  points: RuntimeRegionDraft["points"],
  width: number,
  height: number
) => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    minX: clampInt(Math.floor((Math.min(...xs) / 100) * width), 0, width - 1),
    maxX: clampInt(Math.ceil((Math.max(...xs) / 100) * width), 0, width - 1),
    minY: clampInt(Math.floor((Math.min(...ys) / 100) * height), 0, height - 1),
    maxY: clampInt(Math.ceil((Math.max(...ys) / 100) * height), 0, height - 1)
  };
};

const isPointInPolygon = (
  x: number,
  y: number,
  points: RuntimeRegionDraft["points"]
) => {
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersects =
      (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
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

const clampInt = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
