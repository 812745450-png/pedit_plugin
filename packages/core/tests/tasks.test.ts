import { describe, expect, it } from "vitest";
import {
  canStartRegionEdit,
  createMergeTask,
  createRegionEditTask,
  type MergeTask,
  type RegionEditTask
} from "../src/tasks";

describe("task contracts", () => {
  it("requires at least one region with an instruction", () => {
    expect(canStartRegionEdit([{ id: "r1", label: "区域 1", maskPath: "masks/r1.png", instruction: "" }])).toBe(false);
    expect(canStartRegionEdit([{ id: "r1", label: "区域 1", maskPath: "masks/r1.png", instruction: "改成绿色" }])).toBe(true);
  });

  it("drops empty region instructions when creating edit tasks", () => {
    const task = createRegionEditTask("task_1", "node_1", [
      { id: "r1", label: "区域 1", maskPath: "masks/r1.png", instruction: "改成绿色" },
      { id: "r2", label: "区域 2", maskPath: "masks/r2.png", instruction: "   " }
    ]);
    expect(task.regions.map((region) => region.id)).toEqual(["r1"]);
    expect(task.status).toBe("pending");
  });

  it("rejects region edit tasks without non-empty instructions", () => {
    expect(() =>
      createRegionEditTask("task_1", "node_1", [
        { id: "r1", label: "区域 1", maskPath: "masks/r1.png", instruction: " " }
      ])
    ).toThrow("Region edit task requires at least one non-empty region instruction.");
  });

  it("creates merge tasks with all selected source nodes", () => {
    const task = createMergeTask("task_2", ["node_1", "node_3"], "合并两张图");
    expect(task.type).toBe("multi_node_merge");
    expect(task.sourceNodeIds).toEqual(["node_1", "node_3"]);
    expect(task.instruction).toBe("合并两张图");
  });

  it("rejects merge tasks with fewer than two source nodes", () => {
    expect(() => createMergeTask("task_2", ["node_1"], "合并两张图")).toThrow(
      "Merge task requires at least two source nodes."
    );
  });

  it("rejects merge tasks with blank instructions", () => {
    expect(() => createMergeTask("task_2", ["node_1", "node_3"], "   ")).toThrow(
      "Merge task instruction cannot be blank."
    );
  });

  it("allows task result nodes to be assigned after completion", () => {
    const regionTask = createRegionEditTask("task_3", "node_1", [
      { id: "r1", label: "区域 1", maskPath: "masks/r1.png", instruction: "改成蓝色" }
    ]);
    const mergeTask = createMergeTask("task_4", ["node_1", "node_3"], "合并两张图");
    const completedRegionTask: RegionEditTask = { ...regionTask, resultNodeId: "node_2" };
    const completedMergeTask: MergeTask = { ...mergeTask, resultNodeId: "node_4" };

    expect(regionTask.resultNodeId).toBeUndefined();
    expect(mergeTask.resultNodeId).toBeUndefined();
    expect(completedRegionTask.resultNodeId).toBe("node_2");
    expect(completedMergeTask.resultNodeId).toBe("node_4");
  });
});
