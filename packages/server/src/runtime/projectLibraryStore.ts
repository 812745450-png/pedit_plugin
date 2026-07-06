import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  createDefaultRuntimeCanvasState,
  readRuntimeCanvasState,
  writeRuntimeCanvasState,
  type RuntimeCanvasState
} from "./canvasRuntimeStore.js";
import { runtimeDirPath } from "./runtimeAssets.js";

export interface RuntimeProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentNodeId: string | null;
  thumbnailUrl: string | null;
  nodeCount: number;
  taskCount: number;
}

export interface RuntimeProjectLibrary {
  activeProjectId: string | null;
  projects: RuntimeProjectSummary[];
}

export interface RuntimeProjectLibraryResult {
  ok: true;
  activeProjectId: string | null;
  projects: RuntimeProjectSummary[];
  project: RuntimeCanvasState;
}

const emptyLibrary = (): RuntimeProjectLibrary => ({
  activeProjectId: null,
  projects: []
});

const projectsDirPath = () => resolve(runtimeDirPath(), "projects");
const projectLibraryPath = () => join(projectsDirPath(), "index.json");
const projectDirPath = (projectId: string) => join(projectsDirPath(), safeProjectId(projectId));
const projectStatePath = (projectId: string) => join(projectDirPath(projectId), "canvas-state.json");

const writeJsonSync = (filePath: string, value: unknown) => {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
};

const readJsonSync = <T>(filePath: string): T =>
  JSON.parse(readFileSync(filePath, "utf8")) as T;

const safeProjectId = (projectId: string) => {
  if (!/^[a-z0-9-]+$/.test(projectId)) {
    throw new Error("Invalid Pedit project id.");
  }

  return projectId;
};

const slugName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "project";

const createProjectId = (name: string) =>
  `${slugName(name)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const hasProjectContent = (state: RuntimeCanvasState) =>
  state.nodes.length > 0 || state.tasks.length > 0;

const inferProjectName = (state: RuntimeCanvasState, fallback = "未命名项目") => {
  const rootNode =
    state.nodes.find((node) => !node.parentIds.length && !node.deleted) ??
    state.nodes.find((node) => !node.deleted);
  const currentNode = state.currentNodeId
    ? state.nodes.find((node) => node.id === state.currentNodeId)
    : null;

  return rootNode?.name?.trim() || currentNode?.name?.trim() || fallback;
};

const summarizeProject = (
  projectId: string,
  state: RuntimeCanvasState,
  previous?: RuntimeProjectSummary,
  name?: string
): RuntimeProjectSummary => {
  const currentNode = state.currentNodeId
    ? state.nodes.find((node) => node.id === state.currentNodeId)
    : null;
  const thumbnailNode =
    currentNode ??
    [...state.nodes].reverse().find((node) => !node.deleted && node.imageUrl) ??
    null;
  const now = new Date().toISOString();

  return {
    id: projectId,
    name: name?.trim() || previous?.name || inferProjectName(state),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    currentNodeId: state.currentNodeId,
    thumbnailUrl: thumbnailNode?.imageUrl ?? null,
    nodeCount: state.nodes.filter((node) => !node.deleted).length,
    taskCount: state.tasks.length
  };
};

const readRawLibrary = (): RuntimeProjectLibrary => {
  const filePath = projectLibraryPath();

  if (!existsSync(filePath)) {
    return emptyLibrary();
  }

  try {
    const library = readJsonSync<RuntimeProjectLibrary>(filePath);
    return {
      activeProjectId:
        typeof library.activeProjectId === "string" ? library.activeProjectId : null,
      projects: Array.isArray(library.projects) ? library.projects : []
    };
  } catch {
    return emptyLibrary();
  }
};

const writeLibrary = (library: RuntimeProjectLibrary) => {
  writeJsonSync(projectLibraryPath(), {
    activeProjectId: library.activeProjectId,
    projects: [...library.projects].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )
  });
};

const writeProjectState = (projectId: string, state: RuntimeCanvasState) => {
  writeJsonSync(projectStatePath(projectId), state);
};

const readProjectState = (projectId: string): RuntimeCanvasState => {
  const statePath = projectStatePath(projectId);

  if (!existsSync(statePath)) {
    throw new Error(`Pedit project ${projectId} could not be found.`);
  }

  return readJsonSync<RuntimeCanvasState>(statePath);
};

const result = (
  library: RuntimeProjectLibrary,
  project: RuntimeCanvasState
): RuntimeProjectLibraryResult => ({
  ok: true,
  activeProjectId: library.activeProjectId,
  projects: [...library.projects].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  ),
  project
});

export const saveActiveRuntimeProject = (
  state: RuntimeCanvasState = readRuntimeCanvasState(),
  name?: string
): RuntimeProjectLibraryResult => {
  let library = readRawLibrary();
  let activeProjectId = library.activeProjectId;

  if (!activeProjectId) {
    if (!hasProjectContent(state)) {
      writeLibrary(library);
      return result(library, state);
    }

    activeProjectId = createProjectId(name ?? inferProjectName(state));
    library = {
      activeProjectId,
      projects: [
        ...library.projects,
        summarizeProject(activeProjectId, state, undefined, name)
      ]
    };
  } else {
    const previous = library.projects.find((project) => project.id === activeProjectId);
    const summary = summarizeProject(activeProjectId, state, previous, name);
    library = {
      activeProjectId,
      projects: [
        summary,
        ...library.projects.filter((project) => project.id !== activeProjectId)
      ]
    };
  }

  writeProjectState(activeProjectId, state);
  writeLibrary(library);
  return result(library, state);
};

export const readRuntimeProjectLibrary = (): RuntimeProjectLibraryResult => {
  const state = readRuntimeCanvasState();
  const library = readRawLibrary();

  if (!library.activeProjectId && hasProjectContent(state)) {
    return saveActiveRuntimeProject(state, inferProjectName(state));
  }

  writeLibrary(library);
  return result(library, state);
};

export const createRuntimeProject = (name = "未命名项目"): RuntimeProjectLibraryResult => {
  saveActiveRuntimeProject();
  const project = createDefaultRuntimeCanvasState();
  const projectId = createProjectId(name);
  const library = readRawLibrary();
  const nextLibrary = {
    activeProjectId: projectId,
    projects: [
      summarizeProject(projectId, project, undefined, name),
      ...library.projects.filter((candidate) => candidate.id !== projectId)
    ]
  };

  writeProjectState(projectId, project);
  writeRuntimeCanvasState(project);
  writeLibrary(nextLibrary);
  return result(nextLibrary, project);
};

export const openRuntimeProject = (projectId: string): RuntimeProjectLibraryResult => {
  saveActiveRuntimeProject();
  const project = writeRuntimeCanvasState(readProjectState(projectId));
  const library = readRawLibrary();
  const previous = library.projects.find((candidate) => candidate.id === projectId);
  const summary = summarizeProject(projectId, project, previous);
  const nextLibrary = {
    activeProjectId: projectId,
    projects: [
      summary,
      ...library.projects.filter((candidate) => candidate.id !== projectId)
    ]
  };

  writeProjectState(projectId, project);
  writeLibrary(nextLibrary);
  return result(nextLibrary, project);
};

export const renameRuntimeProject = (
  projectId: string | null,
  name: string
): RuntimeProjectLibraryResult => {
  const cleanName = name.trim();
  if (!cleanName) {
    throw new Error("Project name cannot be empty.");
  }

  const library = readRawLibrary();
  const targetProjectId = projectId ?? library.activeProjectId;
  if (!targetProjectId) {
    throw new Error("No active Pedit project is available to rename.");
  }

  const isActiveProject = targetProjectId === library.activeProjectId;
  const state = isActiveProject
    ? readRuntimeCanvasState()
    : readProjectState(targetProjectId);
  const rootNode =
    state.nodes.find((node) => !node.parentIds.length && !node.deleted) ??
    state.nodes.find((node) => !node.deleted);
  const renamedState = rootNode
    ? {
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === rootNode.id ? { ...node, name: cleanName } : node
        )
      }
    : state;
  const previous = library.projects.find((project) => project.id === targetProjectId);
  const summary = summarizeProject(targetProjectId, renamedState, previous, cleanName);
  const nextLibrary = {
    activeProjectId: library.activeProjectId,
    projects: [
      summary,
      ...library.projects.filter((project) => project.id !== targetProjectId)
    ]
  };

  if (isActiveProject) {
    writeRuntimeCanvasState(renamedState);
  }
  writeProjectState(targetProjectId, renamedState);
  writeLibrary(nextLibrary);
  return result(nextLibrary, isActiveProject ? renamedState : readRuntimeCanvasState());
};

export const deleteRuntimeProject = (projectId: string): RuntimeProjectLibraryResult => {
  const library = readRawLibrary();
  const remainingProjects = library.projects.filter((project) => project.id !== projectId);
  rmSync(projectDirPath(projectId), { recursive: true, force: true });

  if (library.activeProjectId !== projectId) {
    const nextLibrary = {
      activeProjectId: library.activeProjectId,
      projects: remainingProjects
    };
    writeLibrary(nextLibrary);
    return result(nextLibrary, readRuntimeCanvasState());
  }

  const nextActiveProject = remainingProjects[0] ?? null;
  const nextProjectState = nextActiveProject
    ? writeRuntimeCanvasState(readProjectState(nextActiveProject.id))
    : writeRuntimeCanvasState(createDefaultRuntimeCanvasState());
  const nextLibrary = {
    activeProjectId: nextActiveProject?.id ?? null,
    projects: remainingProjects
  };

  writeLibrary(nextLibrary);
  return result(nextLibrary, nextProjectState);
};
