import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultRuntimeCanvasState,
  writeRuntimeCanvasState,
  type RuntimeCanvasState
} from "../src/runtime/canvasRuntimeStore.js";
import {
  createRuntimeProject,
  openRuntimeProject,
  readRuntimeProjectLibrary,
  renameRuntimeProject,
  saveActiveRuntimeProject
} from "../src/runtime/projectLibraryStore.js";

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

describe("runtime project library", () => {
  it("migrates the existing single runtime project into the project library", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-project-library-"));
    tempDirs.push(tempDir);
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    writeRuntimeCanvasState(projectState("source-a", "旧项目"));

    const library = readRuntimeProjectLibrary();

    expect(library.activeProjectId).toBeTruthy();
    expect(library.projects).toHaveLength(1);
    expect(library.projects[0]).toMatchObject({
      name: "旧项目",
      nodeCount: 1,
      taskCount: 0
    });
  });

  it("creates a new empty active project without losing the previous project", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-project-library-"));
    tempDirs.push(tempDir);
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    writeRuntimeCanvasState(projectState("source-a", "旅行项目"));
    const first = readRuntimeProjectLibrary();
    const firstProjectId = first.activeProjectId as string;

    const created = createRuntimeProject("空项目");

    expect(created.activeProjectId).not.toBe(firstProjectId);
    expect(created.projects.map((project) => project.id)).toContain(firstProjectId);
    expect(created.projects).toHaveLength(2);
    expect(created.project.nodes).toEqual([]);

    const reopened = openRuntimeProject(firstProjectId);
    expect(reopened.project.nodes[0]?.name).toBe("旅行项目");
    expect(reopened.activeProjectId).toBe(firstProjectId);
  });

  it("updates the active project snapshot after runtime changes", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-project-library-"));
    tempDirs.push(tempDir);
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    const created = createRuntimeProject("空项目");
    const projectId = created.activeProjectId as string;

    const updatedState = writeRuntimeCanvasState(projectState("source-b", "新上传"));
    saveActiveRuntimeProject(updatedState);
    const reopened = openRuntimeProject(projectId);

    expect(reopened.project.nodes[0]?.id).toBe("source-b");
    expect(reopened.projects.find((project) => project.id === projectId)).toMatchObject({
      name: "空项目",
      nodeCount: 1
    });
  });

  it("renames the active project and its root node without requiring a project id", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pedit-project-library-"));
    tempDirs.push(tempDir);
    process.env.PEDIT_RUNTIME_FILE = join(tempDir, "canvas-state.json");

    writeRuntimeCanvasState(projectState("source-a", "旧项目名"));
    readRuntimeProjectLibrary();

    const renamed = renameRuntimeProject(null, "新项目名");

    expect(renamed.projects[0]).toMatchObject({ name: "新项目名" });
    expect(renamed.project.nodes[0]?.name).toBe("新项目名");
    expect(openRuntimeProject(renamed.activeProjectId as string).project.nodes[0]?.name).toBe(
      "新项目名"
    );
  });
});

const projectState = (nodeId: string, nodeName: string): RuntimeCanvasState => ({
  ...createDefaultRuntimeCanvasState(),
  mode: "big_image_view",
  currentNodeId: nodeId,
  selectedNodeIds: [nodeId],
  nodes: [
    {
      id: nodeId,
      name: nodeName,
      kind: "source",
      imageUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lHJmLwAAAABJRU5ErkJggg==",
      parentIds: [],
      hidden: false,
      deleted: false,
      position: { x: 0, y: 0 },
      summary: "",
      createdAt: "2026-07-03T00:00:00.000Z"
    }
  ]
});
