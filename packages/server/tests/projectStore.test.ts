import { access, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyAssetToProject, resolveProjectAssetPath } from "../src/storage/assetStore.js";
import { createProject, loadProject, ProjectStoreError, saveProject } from "../src/storage/projectStore.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

const expectDirectory = async (path: string): Promise<void> => {
  await expect(access(path, constants.R_OK | constants.W_OK)).resolves.toBeUndefined();
};

describe("project store", () => {
  it("creates, saves, and loads project graph state", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pedit-store-"));
    const project = await createProject(tempDir, "Demo");

    project.graph.nodes.push({
      id: "node_1",
      name: "Original",
      kind: "upload",
      imagePath: "images/node_1.png",
      thumbnailPath: "thumbs/node_1.png",
      parentIds: [],
      hidden: false,
      deleted: false
    });
    project.mode = "version";
    project.currentNodeId = "node_1";
    project.selectedNodeIds = ["node_1"];
    project.showHiddenNodes = true;

    await saveProject(project);

    const loaded = await loadProject(project.rootPath);
    expect(loaded.name).toBe("Demo");
    expect(loaded.graph.nodes[0]?.name).toBe("Original");
    expect(loaded.mode).toBe("version");
    expect(loaded.currentNodeId).toBe("node_1");
    expect(loaded.selectedNodeIds).toEqual(["node_1"]);
    expect(loaded.showHiddenNodes).toBe(true);
  });

  it("creates the project directories and default state files", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pedit-store-"));

    const project = await createProject(tempDir, "../Demo Project!");

    expect(project.id).toMatch(/^demo-project-[a-z0-9]+$/);
    expect(project.rootPath).toBe(join(tempDir, project.id));
    expect(isAbsolute(project.rootPath)).toBe(true);
    expect(project.mode).toBe("big_image_view");
    expect(project.currentNodeId).toBeNull();
    expect(project.selectedNodeIds).toEqual([]);
    expect(project.showHiddenNodes).toBe(false);
    expect(project.graph.nodes).toEqual([]);
    expect(project.tasks).toEqual([]);

    await Promise.all(
      ["images", "masks", "thumbs", "diffs", "tasks"].map((dirName) =>
        expectDirectory(join(project.rootPath, dirName))
      )
    );

    await expectDirectory(project.rootPath);
    await expect(readFile(join(project.rootPath, "project.json"), "utf8")).resolves.toContain(
      "\"name\": \"../Demo Project!\""
    );
    await expect(readFile(join(project.rootPath, "graph.json"), "utf8")).resolves.toContain(
      "\"nodes\": []"
    );
    await expect(readFile(join(project.rootPath, "tasks", "tasks.json"), "utf8")).resolves.toContain(
      "[]"
    );
  });

  it("creates an absolute project root when parentDir is relative", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pedit-store-"));
    const relativeParentDir = relative(process.cwd(), tempDir);

    const project = await createProject(relativeParentDir, "Relative Demo");

    expect(isAbsolute(project.rootPath)).toBe(true);
    expect(project.rootPath).toBe(resolve(relativeParentDir, project.id));
  });

  it("copies assets into project asset directories and rejects escaped paths", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pedit-store-"));
    const project = await createProject(tempDir, "Assets");
    const sourcePath = join(tempDir, "source.txt");
    await writeFile(sourcePath, "asset bytes", "utf8");

    const copied = await copyAssetToProject(project, sourcePath, "images", "node_1.txt");

    expect(copied.relativePath).toBe("images/node_1.txt");
    await expect(readFile(copied.absolutePath, "utf8")).resolves.toBe("asset bytes");
    expect(resolveProjectAssetPath(project, copied.relativePath)).toBe(copied.absolutePath);
    expect(() => resolveProjectAssetPath(project, "../outside.txt")).toThrow(
      "Project asset path must stay inside the project root."
    );
  });

  it("rejects unsafe copied asset file names without overwriting project metadata", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pedit-store-"));
    const project = await createProject(tempDir, "Unsafe Assets");
    const sourcePath = join(tempDir, "source.txt");
    await writeFile(sourcePath, "unsafe overwrite", "utf8");
    const metadataPath = join(project.rootPath, "project.json");
    const originalMetadata = await readFile(metadataPath, "utf8");

    await expect(copyAssetToProject(project, sourcePath, "images", "../project.json")).rejects.toThrow(
      "Project asset file name must be a single safe file name."
    );
    await expect(copyAssetToProject(project, sourcePath, "images", "nested/file.png")).rejects.toThrow(
      "Project asset file name must be a single safe file name."
    );
    await expect(copyAssetToProject(project, sourcePath, "images", resolve(tempDir, "absolute.png"))).rejects.toThrow(
      "Project asset file name must be a single safe file name."
    );

    expect(await readFile(metadataPath, "utf8")).toBe(originalMetadata);
    await expect(loadProject(project.rootPath)).resolves.toMatchObject({ id: project.id });
  });

  it("wraps missing project metadata in a project store error", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pedit-store-"));
    const project = await createProject(tempDir, "Missing Metadata");
    await unlink(join(project.rootPath, "project.json"));

    await expect(loadProject(project.rootPath)).rejects.toThrow(ProjectStoreError);
    await expect(loadProject(project.rootPath)).rejects.toThrow("project.json");
  });

  it("wraps corrupt graph JSON in a project store error", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pedit-store-"));
    const project = await createProject(tempDir, "Corrupt Graph");
    await writeFile(join(project.rootPath, "graph.json"), "{ nope", "utf8");

    await expect(loadProject(project.rootPath)).rejects.toThrow(ProjectStoreError);
    await expect(loadProject(project.rootPath)).rejects.toThrow("graph.json");
  });

  it("wraps invalid task file shape in a project store error", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pedit-store-"));
    const project = await createProject(tempDir, "Invalid Tasks");
    await writeFile(join(project.rootPath, "tasks", "tasks.json"), "{\"tasks\": []}", "utf8");

    await expect(loadProject(project.rootPath)).rejects.toThrow(ProjectStoreError);
    await expect(loadProject(project.rootPath)).rejects.toThrow("tasks/tasks.json");
  });
});
