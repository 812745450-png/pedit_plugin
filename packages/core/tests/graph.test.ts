import { describe, expect, it } from "vitest";
import {
  cascadeDelete,
  copyBranch,
  hideBranch,
  restoreBranch,
  visibleNodes,
  type PeditNode
} from "../src/graph";

const nodes: PeditNode[] = [
  { id: "a", name: "A", kind: "upload", imagePath: "images/a.png", thumbnailPath: "thumbs/a.png", parentIds: [], hidden: false, deleted: false },
  { id: "b", name: "B", kind: "edit", imagePath: "images/b.png", thumbnailPath: "thumbs/b.png", parentIds: ["a"], hidden: false, deleted: false },
  { id: "c", name: "C", kind: "edit", imagePath: "images/c.png", thumbnailPath: "thumbs/c.png", parentIds: ["b"], hidden: false, deleted: false },
  { id: "d", name: "D", kind: "edit", imagePath: "images/d.png", thumbnailPath: "thumbs/d.png", parentIds: ["a"], hidden: false, deleted: false }
];

const cloneNodes = (): PeditNode[] => nodes.map((node) => ({ ...node, parentIds: [...node.parentIds] }));

describe("graph branch operations", () => {
  it("hides a node and all descendants", () => {
    const result = hideBranch(nodes, "b");
    expect(result.find((node) => node.id === "b")?.hidden).toBe(true);
    expect(result.find((node) => node.id === "c")?.hidden).toBe(true);
    expect(result.find((node) => node.id === "d")?.hidden).toBe(false);
  });

  it("restores a hidden node and all descendants", () => {
    const hidden = hideBranch(nodes, "b");
    const result = restoreBranch(hidden, "b");
    expect(result.find((node) => node.id === "b")?.hidden).toBe(false);
    expect(result.find((node) => node.id === "c")?.hidden).toBe(false);
  });

  it("cascade deletes a node and all descendants", () => {
    const result = cascadeDelete(nodes, "b");
    expect(result.find((node) => node.id === "b")?.deleted).toBe(true);
    expect(result.find((node) => node.id === "c")?.deleted).toBe(true);
    expect(result.find((node) => node.id === "a")?.deleted).toBe(false);
  });

  it("filters hidden and deleted nodes from default visible nodes", () => {
    const result = visibleNodes(cascadeDelete(hideBranch(nodes, "d"), "b"), false);
    expect(result.map((node) => node.id)).toEqual(["a"]);
  });

  it("copies a branch with new independent ids", () => {
    const result = copyBranch(nodes, "b", (oldId) => `copy_${oldId}`);
    const copyB = result.find((node) => node.id === "copy_b");
    const copyC = result.find((node) => node.id === "copy_c");
    expect(copyB?.parentIds).toEqual(["a"]);
    expect(copyC?.parentIds).toEqual(["copy_b"]);
    expect(copyB?.name).toBe("B Copy");
  });

  it("clones parent ids in returned graph operation results", () => {
    const operations = [
      (input: PeditNode[]) => hideBranch(input, "b"),
      (input: PeditNode[]) => restoreBranch(input, "b"),
      (input: PeditNode[]) => cascadeDelete(input, "b"),
      (input: PeditNode[]) => visibleNodes(input, true),
      (input: PeditNode[]) => copyBranch(input, "b", (oldId) => `copy_${oldId}`)
    ];

    for (const operation of operations) {
      const input = cloneNodes();
      const result = operation(input);
      result.find((node) => node.id === "b")?.parentIds.push("mutated");

      expect(input.find((node) => node.id === "b")?.parentIds).toEqual(["a"]);
    }
  });
});
