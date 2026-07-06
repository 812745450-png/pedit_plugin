import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { PeditNode, PeditTask } from "@pedit/core";

export type ProjectMode = "big_image_view" | "big_image_edit" | "version";

export interface PeditProjectState {
  id: string;
  name: string;
  rootPath: string;
  currentNodeId: string | null;
  selectedNodeIds: string[];
  mode: ProjectMode;
  showHiddenNodes: boolean;
  graph: {
    nodes: PeditNode[];
  };
  tasks: PeditTask[];
}

interface ProjectMetadata {
  id: string;
  name: string;
  rootPath: string;
  currentNodeId: string | null;
  selectedNodeIds: string[];
  mode: ProjectMode;
  showHiddenNodes: boolean;
}

export class ProjectStoreError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ProjectStoreError";
  }
}

const PROJECT_DIRS = ["images", "masks", "thumbs", "diffs", "tasks"] as const;

const slugProjectName = (name: string): string => {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return slug.length > 0 ? slug : "project";
};

const createProjectId = (name: string): string =>
  `${slugProjectName(name)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const projectMetadataPath = (rootPath: string): string => join(rootPath, "project.json");
const graphPath = (rootPath: string): string => join(rootPath, "graph.json");
const tasksPath = (rootPath: string): string => join(rootPath, "tasks", "tasks.json");

const writeJson = async (path: string, value: unknown): Promise<void> => {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
};

const readProjectJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new ProjectStoreError(`Failed to read project store file ${path}.`, path, {
      cause: error
    });
  }
};

const toMetadata = (project: PeditProjectState): ProjectMetadata => ({
  id: project.id,
  name: project.name,
  rootPath: project.rootPath,
  currentNodeId: project.currentNodeId,
  selectedNodeIds: [...project.selectedNodeIds],
  mode: project.mode,
  showHiddenNodes: project.showHiddenNodes
});

const ensureInsideDirectory = (parentDir: string, childPath: string): void => {
  const relativePath = relative(parentDir, childPath);

  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Project path must stay inside the parent directory.");
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isProjectMode = (value: unknown): value is ProjectMode =>
  value === "big_image_view" || value === "big_image_edit" || value === "version";

const requireString = (value: unknown, fieldName: string, filePath: string): string => {
  if (typeof value !== "string") {
    throw new ProjectStoreError(`Invalid project store file ${filePath}: ${fieldName} must be a string.`, filePath);
  }

  return value;
};

const parseMetadata = (value: unknown, filePath: string): ProjectMetadata => {
  if (!isRecord(value)) {
    throw new ProjectStoreError(`Invalid project store file ${filePath}: expected an object.`, filePath);
  }

  if (value.currentNodeId !== null && typeof value.currentNodeId !== "string") {
    throw new ProjectStoreError(`Invalid project store file ${filePath}: currentNodeId must be a string or null.`, filePath);
  }

  if (!Array.isArray(value.selectedNodeIds) || !value.selectedNodeIds.every((nodeId) => typeof nodeId === "string")) {
    throw new ProjectStoreError(`Invalid project store file ${filePath}: selectedNodeIds must be an array of strings.`, filePath);
  }

  if (!isProjectMode(value.mode)) {
    throw new ProjectStoreError(`Invalid project store file ${filePath}: mode is not supported.`, filePath);
  }

  return {
    id: requireString(value.id, "id", filePath),
    name: requireString(value.name, "name", filePath),
    rootPath: requireString(value.rootPath, "rootPath", filePath),
    currentNodeId: value.currentNodeId,
    selectedNodeIds: value.selectedNodeIds,
    mode: value.mode,
    showHiddenNodes:
      typeof value.showHiddenNodes === "boolean" ? value.showHiddenNodes : false
  };
};

const parseGraph = (value: unknown, filePath: string): { nodes: PeditNode[] } => {
  if (!isRecord(value) || !Array.isArray(value.nodes)) {
    throw new ProjectStoreError(`Invalid project store file ${filePath}: graph must contain a nodes array.`, filePath);
  }

  return {
    nodes: value.nodes as PeditNode[]
  };
};

const parseTasks = (value: unknown, filePath: string): PeditTask[] => {
  if (!Array.isArray(value)) {
    throw new ProjectStoreError(`Invalid project store file ${filePath}: tasks must be an array.`, filePath);
  }

  return value as PeditTask[];
};

export const saveProject = async (project: PeditProjectState): Promise<void> => {
  await mkdir(join(project.rootPath, "tasks"), { recursive: true });
  await writeJson(projectMetadataPath(project.rootPath), toMetadata(project));
  await writeJson(graphPath(project.rootPath), project.graph);
  await writeJson(tasksPath(project.rootPath), project.tasks);
};

export const createProject = async (parentDir: string, name: string): Promise<PeditProjectState> => {
  const id = createProjectId(name);
  const resolvedParentDir = resolve(parentDir);
  const rootPath = resolve(resolvedParentDir, id);
  ensureInsideDirectory(resolvedParentDir, rootPath);

  await mkdir(rootPath, { recursive: false });
  await Promise.all(PROJECT_DIRS.map((dirName) => mkdir(join(rootPath, dirName), { recursive: true })));

  const project: PeditProjectState = {
    id,
    name,
    rootPath,
    currentNodeId: null,
    selectedNodeIds: [],
    mode: "big_image_view",
    showHiddenNodes: false,
    graph: {
      nodes: []
    },
    tasks: []
  };

  await saveProject(project);
  return project;
};

export const loadProject = async (rootPath: string): Promise<PeditProjectState> => {
  const resolvedRootPath = resolve(rootPath);
  const metadataFilePath = projectMetadataPath(resolvedRootPath);
  const graphFilePath = graphPath(resolvedRootPath);
  const tasksFilePath = tasksPath(resolvedRootPath);
  const [metadata, graph, tasks] = await Promise.all([
    readProjectJson(metadataFilePath).then((value) => parseMetadata(value, metadataFilePath)),
    readProjectJson(graphFilePath).then((value) => parseGraph(value, graphFilePath)),
    readProjectJson(tasksFilePath).then((value) => parseTasks(value, tasksFilePath))
  ]);

  return {
    id: metadata.id,
    name: metadata.name,
    rootPath: resolvedRootPath,
    currentNodeId: metadata.currentNodeId,
    selectedNodeIds: [...metadata.selectedNodeIds],
    mode: metadata.mode,
    showHiddenNodes: metadata.showHiddenNodes,
    graph: {
      nodes: graph.nodes.map((node) => ({ ...node, parentIds: [...node.parentIds] }))
    },
    tasks
  };
};
