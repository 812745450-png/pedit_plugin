import type { PeditTask } from "@pedit/core";
import { cloneNode, cloneTask, type PeditToolProjectState } from "./types.js";

export const PEDIT_GET_CANVAS_STATE_TOOL_NAME = "pedit_get_canvas_state" as const;

export interface CanvasStateResult {
  toolName: typeof PEDIT_GET_CANVAS_STATE_TOOL_NAME;
  mode: PeditToolProjectState["mode"];
  currentNodeId: string | null;
  selectedNodeIds: string[];
  graph: PeditToolProjectState["graph"];
  tasks: PeditTask[];
  pendingTasks: PeditTask[];
  runningTasks: PeditTask[];
  requiresClarification: boolean;
  clarificationReason: string | null;
}

export const getCanvasState = (project: PeditToolProjectState): CanvasStateResult => {
  const tasks = project.tasks.map(cloneTask);
  const requiresClarification = project.mode === "version" && project.selectedNodeIds.length === 0;

  return {
    toolName: PEDIT_GET_CANVAS_STATE_TOOL_NAME,
    mode: project.mode,
    currentNodeId: project.currentNodeId,
    selectedNodeIds: [...project.selectedNodeIds],
    graph: {
      nodes: project.graph.nodes.map(cloneNode)
    },
    tasks,
    pendingTasks: tasks.filter((task) => task.status === "pending").map(cloneTask),
    runningTasks: tasks.filter((task) => task.status === "running").map(cloneTask),
    requiresClarification,
    clarificationReason: requiresClarification ? "Version mode requires at least one selected node." : null
  };
};
