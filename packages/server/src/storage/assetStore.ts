import { copyFile, mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { PeditProjectState } from "./projectStore.js";

export type ProjectAssetDir = "images" | "masks" | "thumbs" | "diffs";

export interface StoredProjectAsset {
  relativePath: string;
  absolutePath: string;
}

const assertInsideProject = (project: PeditProjectState, absolutePath: string): void => {
  const projectRoot = resolve(project.rootPath);
  const resolvedPath = resolve(absolutePath);
  const relativePath = relative(projectRoot, resolvedPath);

  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Project asset path must stay inside the project root.");
  }
};

const assertSafeFileName = (fileName: string): void => {
  if (
    fileName.length === 0 ||
    fileName === "." ||
    fileName === ".." ||
    isAbsolute(fileName) ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName !== basename(fileName)
  ) {
    throw new Error("Project asset file name must be a single safe file name.");
  }
};

const assertInsideAssetDir = (assetDirPath: string, absolutePath: string): void => {
  const relativePath = relative(assetDirPath, absolutePath);

  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Project asset path must stay inside the selected asset directory.");
  }
};

export const resolveProjectAssetPath = (project: PeditProjectState, relativePath: string): string => {
  const absolutePath = resolve(project.rootPath, relativePath);
  assertInsideProject(project, absolutePath);
  return absolutePath;
};

export const copyAssetToProject = async (
  project: PeditProjectState,
  sourcePath: string,
  assetDir: ProjectAssetDir,
  fileName = basename(sourcePath)
): Promise<StoredProjectAsset> => {
  assertSafeFileName(fileName);

  const assetDirPath = resolveProjectAssetPath(project, assetDir);
  const absolutePath = resolve(assetDirPath, fileName);
  assertInsideAssetDir(assetDirPath, absolutePath);
  const relativePath = join(assetDir, fileName);

  await mkdir(dirname(absolutePath), { recursive: true });
  await copyFile(sourcePath, absolutePath);

  return {
    relativePath,
    absolutePath
  };
};
