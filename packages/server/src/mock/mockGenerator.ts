import type { PeditTask } from "@pedit/core";
import { assertKnownTaskType } from "../tools/types.js";

export interface MockGenerationResultMetadata {
  resultNodeId: string;
  imagePath: string;
  thumbnailPath: string;
  summary: string;
}

const safeTaskId = (taskId: string): string => taskId.replace(/[^a-zA-Z0-9_-]+/g, "_");

export const createMockGenerationResult = (task: PeditTask): MockGenerationResultMetadata => {
  assertKnownTaskType(task);

  const resultNodeId = `mock_${safeTaskId(task.id)}_result`;
  const summary =
    task.type === "region_edit"
      ? `Mock region edit result for ${task.sourceNodeId}`
      : `Mock merge result for ${task.sourceNodeIds.join("_")}`;

  return {
    resultNodeId,
    imagePath: `images/${resultNodeId}.png`,
    thumbnailPath: `thumbs/${resultNodeId}.png`,
    summary
  };
};
