import { deflateSync, inflateSync } from "node:zlib";
import {
  readRuntimeCanvasState,
  updateRuntimeTaskProgress,
  writeRuntimeGenerationResult,
  type RuntimeGenerationTask,
  type RuntimeImageNode,
  type RuntimeRegionDraft
} from "./canvasRuntimeStore.js";
import { readRuntimeImageUrlBytesSync } from "./runtimeAssets.js";

export type LocalFastPathResult =
  | { ok: true; taskId: string; resultNodeId: string }
  | null;

interface RgbaImage {
  width: number;
  height: number;
  data: Buffer;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const maxFastPathPixels = 12_000_000;
const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

export const tryRunLocalFastPathTask = (
  taskId: string,
  canvasDistDir?: string
): LocalFastPathResult => {
  const state = readRuntimeCanvasState();
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  const sourceNode = task
    ? state.nodes.find((node) => node.id === task.sourceNodeIds[0])
    : null;
  const targetColor = task ? targetColorFromInstruction(task.instruction) : null;

  if (!task || !sourceNode || !canUseFastPath(task, targetColor)) {
    return null;
  }

  updateRuntimeTaskProgress(taskId, {
    workerStage: "processing",
    workerMessage: "本地快速局部改色中，正在保留原图尺寸和细节..."
  });

  const sourceImage = safeDecodePngToRgba(
    readRuntimeImageUrlBytesSync(sourceNode.imageUrl, canvasDistDir)
  );
  if (!sourceImage) {
    return null;
  }

  const edited = applyColorEdit(
    sourceImage,
    task.regions ?? [],
    targetColor,
    task.instruction
  );
  const imageUrl = `data:image/png;base64,${encodeRgbaPng(edited).toString("base64")}`;
  const nextState = writeRuntimeGenerationResult({
    taskId,
    imageUrl,
    name: "Pedit fast edit result",
    summary: task.instruction,
    edgeLabel: "Fast local edit"
  });
  const updatedTask = nextState.tasks.find((candidate) => candidate.id === taskId);

  return updatedTask?.status === "succeeded" && updatedTask.resultNodeId
    ? { ok: true, taskId, resultNodeId: updatedTask.resultNodeId }
    : null;
};

const canUseFastPath = (
  task: RuntimeGenerationTask,
  targetColor: RgbColor | null
) =>
  task.type === "region_edit" &&
  task.selectionSemantics === "strict_local" &&
  Boolean(targetColor) &&
  isSafeLocalFastPathInstruction(task) &&
  Boolean(
    task.regions?.some(
      (region) =>
        region.points.length >= 3 &&
        isEyeColorEdit(task.instruction, region)
    )
  );

const isSafeLocalFastPathInstruction = (task: RuntimeGenerationTask) => {
  const text = [
    task.instruction,
    ...(task.regions?.map((region) => region.instruction) ?? [])
  ].join(" ");

  return !/(文字|文本|字|英文|中文|label|text|caption|包装|商标|logo|标志|花|菊花|flower|package|packaging|remove|erase|删除|去除|消除|替换)/i.test(
    text
  );
};

const targetColorFromInstruction = (instruction: string): RgbColor | null => {
  if (/(蓝|blue)/i.test(instruction)) {
    return { r: 36, g: 110, b: 230 };
  }
  if (/(绿|green)/i.test(instruction)) {
    return { r: 34, g: 150, b: 86 };
  }
  if (/(红|red)/i.test(instruction)) {
    return { r: 210, g: 52, b: 58 };
  }
  if (/(黄|金色|yellow|gold)/i.test(instruction)) {
    return { r: 224, g: 170, b: 48 };
  }
  if (/(紫|purple)/i.test(instruction)) {
    return { r: 132, g: 80, b: 210 };
  }
  if (/(粉|pink)/i.test(instruction)) {
    return { r: 220, g: 88, b: 148 };
  }
  if (/(黑|black)/i.test(instruction)) {
    return { r: 18, g: 18, b: 20 };
  }
  if (/(白|white)/i.test(instruction)) {
    return { r: 238, g: 238, b: 232 };
  }
  if (/(灰|gray|grey)/i.test(instruction)) {
    return { r: 128, g: 132, b: 136 };
  }

  return null;
};

const applyColorEdit = (
  image: RgbaImage,
  regions: RuntimeRegionDraft[],
  targetColor: RgbColor | null,
  taskInstruction: string
): RgbaImage => {
  if (!targetColor) {
    return image;
  }

  const data = Buffer.from(image.data);
  for (const region of regions) {
    if (region.points.length < 3) {
      continue;
    }
    const eyeAwareColorEdit = isEyeColorEdit(taskInstruction, region);

    const bounds = regionPixelBounds(region.points, image.width, image.height);
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const px = ((x + 0.5) / image.width) * 100;
        const py = ((y + 0.5) / image.height) * 100;
        if (!isPointInPolygon(px, py, region.points)) {
          continue;
        }

        const offset = (y * image.width + x) * 4;
        const alpha = data[offset + 3];
        if (alpha === 0) {
          continue;
        }

        const sourceColor = {
          r: data[offset],
          g: data[offset + 1],
          b: data[offset + 2]
        };
        if (eyeAwareColorEdit && !isLikelyIrisColorPixel(sourceColor)) {
          continue;
        }

        const luminance = luminanceOf(sourceColor);
        const shade = clamp(0.38 + luminance / 255, 0.34, 1.25);
        const blend = eyeAwareColorEdit ? 0.72 : 0.68;
        data[offset] = clampByte(sourceColor.r * (1 - blend) + targetColor.r * shade * blend);
        data[offset + 1] = clampByte(sourceColor.g * (1 - blend) + targetColor.g * shade * blend);
        data[offset + 2] = clampByte(sourceColor.b * (1 - blend) + targetColor.b * shade * blend);
      }
    }
  }

  return { ...image, data };
};

const isEyeColorEdit = (
  taskInstruction: string,
  region: RuntimeRegionDraft
) =>
  /(眼|瞳|虹膜|eye|iris|pupil)/i.test(
    [taskInstruction, region.instruction, region.label].join(" ")
  );

const isLikelyIrisColorPixel = (color: RgbColor) => {
  const luminance = luminanceOf(color);
  const chroma = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);

  return luminance >= 24 && luminance <= 190 && chroma >= 16;
};

const luminanceOf = (color: RgbColor) =>
  0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

const decodePngToRgba = (bytes: Buffer): RgbaImage | null => {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(pngSignature)) {
    return null;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const nextOffset = dataEnd + 4;

    if (nextOffset > bytes.length) {
      return null;
    }

    if (type === "IHDR") {
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === "IDAT") {
      idatChunks.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }

    offset = nextOffset;
  }

  if (
    !width ||
    !height ||
    width * height > maxFastPathPixels ||
    bitDepth !== 8 ||
    interlace !== 0 ||
    (colorType !== 2 && colorType !== 6) ||
    !idatChunks.length
  ) {
    return null;
  }

  const channels = colorType === 6 ? 4 : 3;
  const rowLength = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const expectedLength = (rowLength + 1) * height;
  if (inflated.length < expectedLength) {
    return null;
  }

  const rgba = Buffer.alloc(width * height * 4);
  let inputOffset = 0;
  let previousRow = Buffer.alloc(rowLength);

  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[inputOffset];
    inputOffset += 1;
    const row = Buffer.from(inflated.subarray(inputOffset, inputOffset + rowLength));
    inputOffset += rowLength;
    unfilterRow(row, previousRow, channels, filterType);

    for (let x = 0; x < width; x += 1) {
      const sourceOffset = x * channels;
      const targetOffset = (y * width + x) * 4;
      rgba[targetOffset] = row[sourceOffset];
      rgba[targetOffset + 1] = row[sourceOffset + 1];
      rgba[targetOffset + 2] = row[sourceOffset + 2];
      rgba[targetOffset + 3] = channels === 4 ? row[sourceOffset + 3] : 255;
    }

    previousRow = row;
  }

  return { width, height, data: rgba };
};

const safeDecodePngToRgba = (bytes: Buffer): RgbaImage | null => {
  try {
    return decodePngToRgba(bytes);
  } catch {
    return null;
  }
};

const unfilterRow = (
  row: Buffer,
  previousRow: Buffer,
  bytesPerPixel: number,
  filterType: number
) => {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previousRow[index] ?? 0;
    const upLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] : 0;

    if (filterType === 1) {
      row[index] = (row[index] + left) & 0xff;
    } else if (filterType === 2) {
      row[index] = (row[index] + up) & 0xff;
    } else if (filterType === 3) {
      row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff;
    } else if (filterType === 4) {
      row[index] = (row[index] + paethPredictor(left, up, upLeft)) & 0xff;
    } else if (filterType !== 0) {
      throw new Error(`Unsupported PNG filter type ${filterType}.`);
    }
  }
};

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

const paethPredictor = (left: number, up: number, upLeft: number) => {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);

  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) {
    return left;
  }
  return distanceUp <= distanceUpLeft ? up : upLeft;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const clampByte = (value: number) => Math.round(clamp(value, 0, 255));

const clampInt = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
