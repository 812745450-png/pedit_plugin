import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface ParsedDataUrl {
  mimeType: string;
  bytes: Buffer;
}

export const runtimeFilePath = () =>
  resolve(process.env.PEDIT_RUNTIME_FILE ?? ".pedit-runtime/canvas-state.json");

export const runtimeDirPath = () => dirname(runtimeFilePath());

export const runtimeAssetDirPath = () => resolve(runtimeDirPath(), "assets");

export const parseDataUrl = (dataUrl: string): ParsedDataUrl | null => {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);

  if (!match) {
    return null;
  }

  return {
    mimeType: match[1] || "application/octet-stream",
    bytes: match[2]
      ? Buffer.from(match[3], "base64")
      : Buffer.from(decodeURIComponent(match[3]), "utf8")
  };
};

export const persistRuntimeDataUrl = (
  imageUrl: string,
  prefix: string
): string => {
  const parsed = parseDataUrl(imageUrl);

  if (!parsed || !parsed.mimeType.startsWith("image/")) {
    return imageUrl;
  }

  const hash = createHash("sha256").update(parsed.bytes).digest("hex").slice(0, 20);
  const fileName = `${safeSegment(prefix)}-${hash}.${extensionForMime(parsed.mimeType)}`;
  const assetDir = runtimeAssetDirPath();
  const assetPath = resolve(assetDir, fileName);

  mkdirSync(assetDir, { recursive: true });
  if (!existsSync(assetPath)) {
    writeFileSync(assetPath, parsed.bytes);
  }

  return `/runtime-assets/${fileName}`;
};

export const compactRuntimeText = (text: string): string =>
  text.replace(
    /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g,
    "[runtime image data omitted; use sourceNodeIds, pedit_export_current_image, or /api/export]"
  );

export const resolveRuntimeAssetPath = (rawUrl: string): string | null => {
  const url = new URL(rawUrl, "http://127.0.0.1");

  if (!url.pathname.startsWith("/runtime-assets/")) {
    return null;
  }

  const relativePath = decodeURIComponent(url.pathname.replace(/^\/runtime-assets\//, ""));
  if (!relativePath || relativePath.includes("/") || relativePath.includes("\\")) {
    throw new Error("Runtime asset URL must reference a single file name.");
  }

  const assetDir = runtimeAssetDirPath();
  const assetPath = resolve(assetDir, relativePath);
  const relativeToAssets = relative(assetDir, assetPath);

  if (
    relativeToAssets === "" ||
    relativeToAssets.startsWith("..") ||
    isAbsolute(relativeToAssets)
  ) {
    throw new Error("Runtime asset URL is outside the runtime asset directory.");
  }

  return assetPath;
};

export const readRuntimeImageUrlBytesSync = (
  imageUrl: string,
  distDir?: string
): Buffer => {
  if (imageUrl.startsWith("data:")) {
    const parsed = parseDataUrl(imageUrl);

    if (!parsed) {
      throw new Error("Invalid runtime image data URL.");
    }

    return parsed.bytes;
  }

  const runtimeAssetPath = imageUrl.startsWith("/")
    ? resolveRuntimeAssetPath(imageUrl)
    : null;
  if (runtimeAssetPath) {
    return readFileSync(runtimeAssetPath);
  }

  if (distDir && imageUrl.startsWith("/")) {
    const sourcePath = resolve(distDir, `.${sep}${imageUrl}`);

    if (!sourcePath.startsWith(resolve(distDir))) {
      throw new Error("Runtime image source is outside the canvas assets directory.");
    }

    return readFileSync(sourcePath);
  }

  throw new Error("Runtime image URL must be a data URL, runtime asset, or canvas asset.");
};

export const readRuntimeImageDimensions = (imageUrl: string, distDir?: string) => {
  let data: Buffer;

  try {
    data = readRuntimeImageUrlBytesSync(imageUrl, distDir);
  } catch {
    return null;
  }

  if (
    data.length >= 24 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data.subarray(12, 16).toString("ascii") === "IHDR"
  ) {
    return {
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20)
    };
  }

  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    return readJpegDimensions(data);
  }

  return null;
};

export const validateRuntimeImageUrlSync = (
  imageUrl: string,
  distDir?: string
): { ok: true } | { ok: false; error: string } => {
  let data: Buffer;

  try {
    data = readRuntimeImageUrlBytesSync(imageUrl, distDir);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  if (data.length >= 8 && data.subarray(0, 8).equals(pngSignature)) {
    return validatePngBytes(data);
  }

  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    return readJpegDimensions(data)
      ? { ok: true }
      : { ok: false, error: "JPEG dimensions could not be decoded." };
  }

  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    const riffSize = data.readUInt32LE(4) + 8;
    return riffSize <= data.length
      ? { ok: true }
      : { ok: false, error: "WebP image is truncated." };
  }

  return { ok: false, error: "Generated image format is not a supported PNG, JPEG, or WebP." };
};

const extensionForMime = (mimeType: string) => {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  if (mimeType === "image/gif") {
    return "gif";
  }

  return "png";
};

const safeSegment = (value: string) => value.replace(/[^a-zA-Z0-9_.-]/g, "_");

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const validatePngBytes = (data: Buffer): { ok: true } | { ok: false; error: string } => {
  let offset = 8;
  let sawIhdr = false;
  let sawIdat = false;

  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    const chunkEnd = offset + 12 + length;

    if (chunkEnd > data.length) {
      return { ok: false, error: `PNG chunk ${type || "(unknown)"} is truncated.` };
    }

    if (type === "IHDR") {
      sawIhdr = length === 13;
    } else if (type === "IDAT") {
      sawIdat = true;
    } else if (type === "IEND") {
      return sawIhdr && sawIdat
        ? { ok: true }
        : { ok: false, error: "PNG image is missing IHDR or IDAT data." };
    }

    offset = chunkEnd;
  }

  return { ok: false, error: "PNG image is missing IEND marker." };
};

const readJpegDimensions = (data: Buffer) => {
  let offset = 2;
  const sofMarkers = new Set([
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf
  ]);

  while (offset + 4 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = data[offset + 1];
    offset += 2;

    if (marker === 0xd9 || marker === 0xda || offset + 2 > data.length) {
      break;
    }

    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) {
      break;
    }

    if (sofMarkers.has(marker) && length >= 7) {
      return {
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5)
      };
    }

    offset += length;
  }

  return null;
};
