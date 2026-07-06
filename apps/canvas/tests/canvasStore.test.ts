import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";
import { BigImageEdit } from "../src/modes/BigImageEdit";
import {
  applyCanvasStateSnapshot,
  createCanvasUiState,
  selectNode,
  setCanvasMode,
  setCanvasLocked,
  toggleShowHiddenNodes,
  toCanvasStateSnapshot
} from "../src/state/canvasStore";

describe("canvas UI state transitions", () => {
  it("starts in view mode with no selected project node", () => {
    expect(createCanvasUiState()).toEqual({
      mode: "big_image_view",
      locked: false,
      currentNodeId: null,
      selectedNodeIds: [],
      showHiddenNodes: false
    });
  });

  it("switches modes without discarding the current node selection", () => {
    const state = selectNode(createCanvasUiState(), "node-root");
    const editState = setCanvasMode(state, "big_image_edit");
    const versionState = setCanvasMode(editState, "version");

    expect(versionState.mode).toBe("version");
    expect(versionState.currentNodeId).toBe("node-root");
    expect(versionState.selectedNodeIds).toEqual(["node-root"]);
  });

  it("updates lock and hidden-node visibility independently", () => {
    const lockedState = setCanvasLocked(createCanvasUiState(), true);
    const hiddenState = toggleShowHiddenNodes(lockedState);

    expect(hiddenState.locked).toBe(true);
    expect(hiddenState.showHiddenNodes).toBe(true);
  });

  it("serializes and applies canvas state snapshots", () => {
    const state = createCanvasUiState({
      mode: "version",
      currentNodeId: "node-a",
      selectedNodeIds: ["node-a", "node-b"],
      showHiddenNodes: true
    });
    const snapshot = toCanvasStateSnapshot(state);
    const applied = applyCanvasStateSnapshot(createCanvasUiState(), snapshot);

    expect(snapshot).toEqual({
      mode: "version",
      currentNodeId: "node-a",
      selectedNodeIds: ["node-a", "node-b"],
      showHiddenNodes: true
    });
    expect(applied).toMatchObject(snapshot);
    expect(applied.locked).toBe(false);
  });
});

describe("canvas accessibility and locked controls", () => {
  it("marks the active mode button as pressed", () => {
    const markup = renderToStaticMarkup(createElement(App));

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="false"');
  });

  it("disables edit tools while locked", () => {
    const markup = renderToStaticMarkup(
      createElement(BigImageEdit, {
        currentNodeId: "node-root",
        locked: true
      })
    );

    expect(markup.match(/disabled=""/g)?.length).toBe(7);
  });
});
