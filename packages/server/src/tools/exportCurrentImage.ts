import { cloneNode, type PeditToolProjectState } from "./types.js";

export const PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME = "pedit_export_current_image" as const;

export interface ExportCurrentImageResult {
  toolName: typeof PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME;
  nodeId: string | null;
  imagePath: string | null;
  thumbnailPath: string | null;
  requiresClarification: boolean;
  clarificationReason: string | null;
}

export const exportCurrentImage = (
  project: Pick<PeditToolProjectState, "mode" | "currentNodeId" | "selectedNodeIds" | "graph">
): ExportCurrentImageResult => {
  if (project.mode !== "big_image_view") {
    return {
      toolName: PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME,
      nodeId: project.currentNodeId,
      imagePath: null,
      thumbnailPath: null,
      requiresClarification: true,
      clarificationReason: "Current image export is only available in big image view mode."
    };
  }

  if (!project.currentNodeId) {
    return {
      toolName: PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME,
      nodeId: null,
      imagePath: null,
      thumbnailPath: null,
      requiresClarification: true,
      clarificationReason: "No current image is selected."
    };
  }

  const currentNode = project.graph.nodes.find((node) => node.id === project.currentNodeId && !node.deleted);

  if (!currentNode) {
    return {
      toolName: PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME,
      nodeId: project.currentNodeId,
      imagePath: null,
      thumbnailPath: null,
      requiresClarification: true,
      clarificationReason: "Current image node could not be found or has been deleted."
    };
  }

  const exportNode = cloneNode(currentNode);

  return {
    toolName: PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME,
    nodeId: exportNode.id,
    imagePath: exportNode.imagePath,
    thumbnailPath: exportNode.thumbnailPath,
    requiresClarification: false,
    clarificationReason: null
  };
};
