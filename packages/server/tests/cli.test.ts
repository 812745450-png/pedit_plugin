import { describe, expect, it } from "vitest";
import { parseServeCanvasOptions, summarizeCliOutput } from "../src/index.js";

describe("server CLI options", () => {
  it("uses default host and port when serve-canvas options are omitted", () => {
    expect(parseServeCanvasOptions(["node", "dist/index.js", "--serve-canvas"])).toEqual({
      host: "127.0.0.1",
      port: 5173
    });
  });

  it("parses serve-canvas options independently of option order", () => {
    expect(
      parseServeCanvasOptions([
        "node",
        "dist/index.js",
        "--serve-canvas",
        "--port",
        "6200",
        "--host",
        "0.0.0.0"
      ])
    ).toEqual({
      host: "0.0.0.0",
      port: 6200
    });
  });

  it("summarizes runtime graph output without printing image data", () => {
    expect(
      summarizeCliOutput({
        toolName: "pedit_write_generation_result",
        mode: "big_image_view",
        currentNodeId: "result-a",
        nodes: [
          {
            id: "result-a",
            name: "Edited",
            kind: "edit",
            parentIds: ["source-a"],
            createdByTaskId: "task-a",
            imageUrl: "data:image/png;base64,large-image-payload"
          }
        ],
        tasks: [
          {
            id: "task-a",
            status: "succeeded",
            type: "region_edit",
            resultNodeId: "result-a",
            error: null,
            updatedAt: "2026-07-01T00:00:00.000Z"
          }
        ]
      })
    ).toEqual({
      toolName: "pedit_write_generation_result",
      ok: undefined,
      mode: "big_image_view",
      currentNodeId: "result-a",
      nodeCount: 1,
      taskCount: 1,
      claimedTask: undefined,
      currentNode: {
        id: "result-a",
        name: "Edited",
        kind: "edit",
        parentIds: ["source-a"],
        createdByTaskId: "task-a",
        hasImageUrl: true,
        imageUrlChars: 41
      },
      tasks: [
        {
          id: "task-a",
          status: "succeeded",
          type: "region_edit",
          resultNodeId: "result-a",
          error: null,
          updatedAt: "2026-07-01T00:00:00.000Z"
        }
      ]
    });
  });

  it("summarizes nested runtime project output from claim results", () => {
    expect(
      summarizeCliOutput({
        toolName: "pedit_claim_next_task",
        ok: true,
        claimedTask: {
          id: "task-a",
          status: "running",
          type: "region_edit",
          instruction: "Change eye color"
        },
        project: {
          mode: "big_image_edit",
          currentNodeId: "source-a",
          nodes: [
            {
              id: "source-a",
              name: "Source",
              kind: "source",
              imageUrl: "data:image/png;base64,large-source-payload"
            }
          ],
          tasks: [
            {
              id: "task-a",
              status: "running",
              type: "region_edit",
              error: null,
              updatedAt: "2026-07-01T00:01:00.000Z"
            }
          ]
        }
      })
    ).toEqual({
      toolName: "pedit_claim_next_task",
      ok: true,
      mode: "big_image_edit",
      currentNodeId: "source-a",
      nodeCount: 1,
      taskCount: 1,
      claimedTask: {
        id: "task-a",
        status: "running",
        type: "region_edit",
        instruction: "Change eye color"
      },
      currentNode: {
        id: "source-a",
        name: "Source",
        kind: "source",
        parentIds: undefined,
        createdByTaskId: undefined,
        hasImageUrl: true,
        imageUrlChars: 42
      },
      tasks: [
        {
          id: "task-a",
          status: "running",
          type: "region_edit",
          resultNodeId: undefined,
          error: null,
          updatedAt: "2026-07-01T00:01:00.000Z"
        }
      ]
    });
  });
});
