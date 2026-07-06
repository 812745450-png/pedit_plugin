import { describe, expect, it, vi } from "vitest";
import {
  buildManualHandoffPrompt,
  buildCodexPrompt,
  describeRegionGeometry,
  getRegionBounds,
  inferSelectionSemantics,
  resetRemoteProject
} from "../src/state/peditClient";
import type { ImageProjectNode } from "../src/state/imageProject";

const node = (imageUrl = "data:image/png;base64,source"): ImageProjectNode => ({
  id: "source-a",
  name: "Source image",
  kind: "source",
  imageUrl,
  parentIds: [],
  hidden: false,
  deleted: false,
  position: { x: 0, y: 0 },
  summary: "",
  createdAt: "2026-07-01T00:00:00.000Z"
});

describe("Pedit region precision prompts", () => {
  it("resets the remote canvas runtime through the reset endpoint", async () => {
    const resetProject = {
      mode: "big_image_view" as const,
      currentNodeId: null,
      selectedNodeIds: [],
      showHiddenNodes: false,
      nodes: [],
      tasks: []
    };
    const fetchMock = vi.fn(async () => Response.json(resetProject));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resetRemoteProject()).resolves.toEqual(resetProject);
    expect(fetchMock).toHaveBeenCalledWith("/api/reset", { method: "POST" });

    vi.unstubAllGlobals();
  });

  it("computes a clamped percent bbox for lasso points", () => {
    expect(
      getRegionBounds([
        { x: 42.97289983143068, y: 30.710364487817195 },
        { x: 54.48705632925408, y: 38.151148702154295 },
        { x: 101, y: -5 }
      ])
    ).toEqual({
      x: 42.97,
      y: 0,
      width: 57.03,
      height: 38.15
    });
  });

  it("describes region geometry with bbox, center, and polygon points", () => {
    expect(
      describeRegionGeometry({
        label: "区域 1",
        points: [
          { x: 42.97289983143068, y: 30.710364487817195 },
          { x: 54.48705632925408, y: 38.151148702154295 }
        ]
      })
    ).toContain("区域 1: bbox x=42.97%, y=30.71%, w=11.51%, h=7.44%; center=(48.73%,34.43%); polygon=(42.97,30.71) (54.49,38.15)");
  });

  it("keeps color changes as strict local edits in the Codex prompt", () => {
    const prompt = buildCodexPrompt({
      taskId: "task-region",
      type: "region_edit",
      sourceNodes: [node()],
      instruction: "区域 1: 将这只眼睛换成绿色",
      selectionSemantics: "strict_local",
      regions: [
        {
          id: "region-1",
          label: "区域 1",
          instruction: "将这只眼睛换成绿色",
          bounds: { x: 42.97, y: 30.46, width: 11.52, height: 7.69 },
          points: [
            { x: 42.97, y: 30.71 },
            { x: 54.49, y: 30.71 },
            { x: 54.49, y: 38.15 },
            { x: 42.97, y: 38.15 }
          ]
        }
      ]
    });

    expect(prompt).toContain("Precision region geometry:");
    expect(prompt).toContain("Selection semantics: strict_local");
    expect(prompt).toContain("Strict local edit: only edit the selected target pixels");
    expect(prompt).toContain("task.regions[].maskPath");
    expect(prompt).toContain("fully transparent pixels are the editable area");
    expect(prompt).not.toContain("data:image/png;base64");
    expect(prompt).toContain("区域 1: bbox x=42.97%, y=30.46%, w=11.52%, h=7.69%; center=(48.73%,34.31%)");
    expect(prompt).toContain("polygon=(42.97,30.71) (54.49,30.71) (54.49,38.15) (42.97,38.15)");
  });

  it("treats object removal regions as contextual inpainting anchors", () => {
    const prompt = buildCodexPrompt({
      taskId: "task-remove",
      type: "region_edit",
      sourceNodes: [node()],
      instruction: "区域 1: 区域内的衣物移除",
      selectionSemantics: "contextual_inpaint",
      regions: [
        {
          id: "region-1",
          label: "区域 1",
          instruction: "区域内的衣物移除",
          bounds: { x: 0.13, y: 40.17, width: 43.73, height: 59.83 },
          points: [
            { x: 0.13, y: 40.17 },
            { x: 43.86, y: 40.17 },
            { x: 43.86, y: 100 },
            { x: 0.13, y: 100 }
          ]
        }
      ]
    });

    expect(prompt).toContain("Selection semantics: contextual_inpaint");
    expect(prompt).toContain("The selected region marks the primary object/problem area");
    expect(prompt).toContain("Use the surrounding context area to reconstruct a coherent final image");
    expect(prompt).toContain("You may adjust a narrow surrounding transition area");
    expect(prompt).toContain("For contextual inpaint tasks, use the mask as the primary problem area");
    expect(prompt).toContain("outside pixels are preservation targets, not an absolute hard boundary");
    expect(prompt).not.toContain("Treat each polygon as a hard edit mask.");
    expect(prompt).not.toContain("Edit only pixels inside the specified polygon/bbox");
    expect(prompt).not.toContain("opaque pixels must be preserved");
    expect(prompt).toContain("Reject visible seams, pasted texture, broken shadows, illogical reconstruction, heavy compression, blur, or low-fidelity output.");
  });

  it("infers selection semantics from the instruction", () => {
    expect(inferSelectionSemantics("把眼睛换成蓝色")).toBe("strict_local");
    expect(inferSelectionSemantics("区域内的衣物移除")).toBe("contextual_inpaint");
    expect(inferSelectionSemantics("把背景换成白色沙发")).toBe("global_edit");
  });

  it("requires the final writeback image to match the final Codex preview", () => {
    const handoffPrompt = buildManualHandoffPrompt({
      taskId: "task-handoff",
      type: "region_edit",
      instruction: "移除衣物",
      selectionSemantics: "contextual_inpaint",
      hasRegions: true
    });

    expect(handoffPrompt).toContain("image2 原始输出只能作为中间预览");
    expect(handoffPrompt).toContain("最终写回 Pedit 的图片必须是你最终展示和验收的同一张图片");
    expect(handoffPrompt).toContain("contextual_inpaint 表示选区是问题锚点，不是硬边界");
  });

  it("routes no-region edit handoff as whole-image editing", () => {
    const prompt = buildCodexPrompt({
      taskId: "task-global",
      type: "region_edit",
      sourceNodes: [node()],
      instruction: "整图要求: 把人物的头发换成黑色",
      selectionSemantics: "global_edit"
    });
    const handoffPrompt = buildManualHandoffPrompt({
      taskId: "task-global",
      type: "region_edit",
      instruction: "整图要求: 把人物的头发换成黑色",
      selectionSemantics: "global_edit",
      hasRegions: false
    });

    expect(prompt).toContain("No user region was selected");
    expect(prompt).toContain("whole-image edit instruction");
    expect(prompt).not.toContain("first call pedit_run_local_fast_path");
    expect(handoffPrompt).toContain("hasRegions=false");
    expect(handoffPrompt).toContain("本任务没有用户圈选区域");
    expect(handoffPrompt).toContain("直接按 sourceNodeIds 和 codexPrompt 使用整图 image2 编辑流程");
    expect(handoffPrompt).not.toContain("请先调用 pedit_run_local_fast_path");
  });

  it("routes uploaded reference images through structured task fields", () => {
    const prompt = buildCodexPrompt({
      taskId: "task-reference",
      type: "region_edit",
      sourceNodes: [node()],
      instruction: "整图要求: 把背景换成参考图中的背景; 参考图: ref.png",
      selectionSemantics: "global_edit",
      referenceImages: [
        {
          name: "ref.png",
          imageUrl: "data:image/png;base64,reference"
        }
      ]
    });
    const handoffPrompt = buildManualHandoffPrompt({
      taskId: "task-reference",
      type: "region_edit",
      instruction: "整图要求: 把背景换成参考图中的背景; 参考图: ref.png",
      selectionSemantics: "global_edit",
      hasRegions: false,
      referenceCount: 1
    });

    expect(prompt).toContain("Reference images:");
    expect(prompt).toContain("name=ref.png");
    expect(prompt).toContain("task.referenceImages[].imageUrl");
    expect(prompt).not.toContain("data:image/png;base64");
    expect(handoffPrompt).toContain("referenceCount=1");
    expect(handoffPrompt).toContain("task.referenceImages[].imageUrl");
  });
});
