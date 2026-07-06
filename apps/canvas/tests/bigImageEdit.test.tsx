import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BigImageEdit,
  addLassoRegion,
  createLassoRegion,
  createBigImageEditState,
  deleteSelectedRegion,
  isValidLassoPolygon,
  redoEditState,
  requestExitEdit,
  startEditDraft,
  setRegionInstruction,
  startEditEnabled,
  undoEditState
} from "../src/modes/BigImageEdit";

const polygonPoints = [
  { x: 120, y: 120 },
  { x: 220, y: 150 },
  { x: 190, y: 250 }
];

describe("big image edit state", () => {
  it("keeps Start Edit disabled initially", () => {
    const state = createBigImageEditState();
    const markup = renderToStaticMarkup(
      createElement(BigImageEdit, {
        currentNodeId: "node-root",
        locked: false,
        initialState: state
      })
    );

    expect(startEditEnabled(state, false)).toBe(false);
    expect(markup).toContain("套索圈选");
    expect(markup).toContain('disabled=""');
  });

  it("enables Start Edit after drawing a polygon and typing an instruction", () => {
    const region = createLassoRegion(1, polygonPoints);
    const withRegion = addLassoRegion(createBigImageEditState(), region);
    const withInstruction = setRegionInstruction(
      withRegion,
      withRegion.regions[0].id,
      "Replace the sign text with the new launch message"
    );

    expect(withInstruction.regions[0].points).toEqual(polygonPoints);
    expect(withInstruction.regions[0]).toEqual({
      id: "region-1",
      label: "区域 1",
      points: polygonPoints,
      color: "#55f0c2",
      instruction: "Replace the sign text with the new launch message"
    });
    expect(startEditEnabled(withInstruction, false)).toBe(true);
  });

  it("enables Start Edit with only a whole-image instruction", () => {
    const state = {
      ...createBigImageEditState(),
      globalInstruction: "Make the whole image warmer and cleaner"
    };

    expect(startEditEnabled(state, false)).toBe(true);
  });

  it("disables Start Edit again after deleting the selected region", () => {
    const withRegion = addLassoRegion(
      createBigImageEditState(),
      createLassoRegion(1, polygonPoints)
    );
    const withInstruction = setRegionInstruction(
      withRegion,
      withRegion.regions[0].id,
      "Brighten only this foreground subject"
    );
    const deleted = deleteSelectedRegion(withInstruction);

    expect(deleted.regions).toEqual([]);
    expect(startEditEnabled(deleted, false)).toBe(false);
  });

  it("undoes and redoes region creation", () => {
    const withRegion = addLassoRegion(
      createBigImageEditState(),
      createLassoRegion(1, polygonPoints)
    );
    const undone = undoEditState(withRegion);
    const redone = redoEditState(undone);

    expect(undone.regions).toEqual([]);
    expect(redone.regions).toHaveLength(1);
    expect(redone.regions[0].points).toEqual(polygonPoints);
  });

  it("undoes and redoes instruction edits", () => {
    const withRegion = addLassoRegion(
      createBigImageEditState(),
      createLassoRegion(1, polygonPoints)
    );
    const withInstruction = setRegionInstruction(
      withRegion,
      "region-1",
      "Sharpen the selected foreground"
    );
    const unchanged = setRegionInstruction(
      withInstruction,
      "region-1",
      "Sharpen the selected foreground"
    );
    const undone = undoEditState(unchanged);
    const redone = redoEditState(undone);

    expect(withInstruction.undoStack).toHaveLength(2);
    expect(unchanged.undoStack).toHaveLength(2);
    expect(undone.regions[0].instruction).toBe("");
    expect(redone.regions[0].instruction).toBe(
      "Sharpen the selected foreground"
    );
  });

  it("rejects degenerate lasso polygons", () => {
    expect(isValidLassoPolygon([])).toBe(false);
    expect(
      isValidLassoPolygon([
        { x: 10, y: 10 },
        { x: 10, y: 10 },
        { x: 20, y: 20 }
      ])
    ).toBe(false);
    expect(
      isValidLassoPolygon([
        { x: 10, y: 10 },
        { x: 11, y: 10 },
        { x: 11, y: 11 },
        { x: 10, y: 11 }
      ])
    ).toBe(false);
    expect(isValidLassoPolygon(polygonPoints)).toBe(true);
  });

  it("marks Start Edit as submitted instead of silently doing nothing", () => {
    const withRegion = addLassoRegion(
      createBigImageEditState(),
      createLassoRegion(1, polygonPoints)
    );
    const withInstruction = setRegionInstruction(
      withRegion,
      "region-1",
      "Clean up this region"
    );
    const submitted = startEditDraft(withInstruction, false);

    expect(submitted.submitStatus).toBe("running");
  });

  it("shows an exit confirmation modal when drafts are present", () => {
    const withRegion = addLassoRegion(
      createBigImageEditState(),
      createLassoRegion(1, polygonPoints)
    );
    const exiting = requestExitEdit(withRegion);
    const markup = renderToStaticMarkup(
      createElement(BigImageEdit, {
        currentNodeId: "node-root",
        locked: false,
        initialState: exiting
      })
    );

    expect(exiting.showExitConfirm).toBe(true);
    expect(markup).toContain("放弃修改");
    expect(markup).toContain("继续编辑");
  });
});
