import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import {
  parseDataUrl,
  resolveRuntimeAssetPath
} from "./runtimeAssets.js";

export interface RuntimeImageExportInput {
  imageUrl: string;
  filePath: string;
  distDir: string;
}

export interface RuntimeImageExportResult {
  ok: true;
  filePath: string;
}

export const exportRuntimeImage = async ({
  imageUrl,
  filePath,
  distDir
}: RuntimeImageExportInput): Promise<RuntimeImageExportResult> => {
  const targetPath = expandHome(filePath.trim());

  if (!targetPath) {
    throw new Error("Export requires a local file path.");
  }

  const bytes = await readImageBytes(imageUrl, distDir);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, bytes);

  return { ok: true, filePath: targetPath };
};

const expandHome = (filePath: string) => {
  if (filePath === "~") {
    return homedir();
  }

  if (filePath.startsWith(`~${sep}`) || filePath.startsWith("~/")) {
    return resolve(homedir(), filePath.slice(2));
  }

  return resolve(filePath);
};

const readImageBytes = async (imageUrl: string, distDir: string) => {
  if (imageUrl.startsWith("data:")) {
    return decodeDataUrl(imageUrl);
  }

  if (imageUrl.startsWith("/")) {
    const runtimeAssetPath = resolveRuntimeAssetPath(imageUrl);
    if (runtimeAssetPath) {
      return readFile(runtimeAssetPath);
    }

    const sourcePath = resolve(distDir, `.${imageUrl}`);

    if (!sourcePath.startsWith(resolve(distDir))) {
      throw new Error("Export source image is outside the canvas assets directory.");
    }

    return readFile(sourcePath);
  }

  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Could not fetch export source image: ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error("Unsupported export image URL.");
};

const decodeDataUrl = (dataUrl: string) => {
  const parsed = parseDataUrl(dataUrl);

  if (!parsed) {
    throw new Error("Invalid data URL export source.");
  }

  return parsed.bytes;
};
