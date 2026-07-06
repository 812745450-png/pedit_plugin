import type { PeditNode, PeditTask } from "@pedit/core";
import { cloneTask } from "./types.js";

export const PEDIT_CREATE_PENDING_TASK_TOOL_NAME = "pedit_create_pending_task" as const;

export interface PendingTaskProjectState {
  graph?: {
    nodes: PeditNode[];
  };
  tasks: PeditTask[];
}

export type ModelGenerationRequest =
  | {
      taskId: string;
      type: "region_edit";
      sourceNodeId: string;
      sourceImagePath: string;
      regions: Array<{
        id: string;
        label: string;
        maskPath: string;
        instruction: string;
      }>;
    }
  | {
      taskId: string;
      type: "multi_node_merge";
      sourceNodeIds: string[];
      sourceImagePaths: string[];
      instruction: string;
    };

export const createPendingTask = <Project extends PendingTaskProjectState>(project: Project, task: PeditTask): Project => {
  const pendingTask = {
    ...cloneTask(task),
    status: "pending",
    error: null
  } satisfies PeditTask;

  return {
    ...project,
    tasks: [...project.tasks.map(cloneTask), pendingTask]
  };
};

const requireNode = (nodes: readonly PeditNode[], nodeId: string): PeditNode => {
  const node = nodes.find((candidate) => candidate.id === nodeId && !candidate.deleted);

  if (!node) {
    throw new Error(`Source node ${nodeId} could not be found.`);
  }

  return node;
};

export const createModelGenerationRequest = (
  project: Required<Pick<PendingTaskProjectState, "graph">>,
  task: PeditTask
): ModelGenerationRequest => {
  if (task.type === "region_edit") {
    const sourceNode = requireNode(project.graph.nodes, task.sourceNodeId);

    return {
      taskId: task.id,
      type: task.type,
      sourceNodeId: task.sourceNodeId,
      sourceImagePath: sourceNode.imagePath,
      regions: task.regions.map((region) => ({
        id: region.id,
        label: region.label,
        maskPath: region.maskPath,
        instruction: region.instruction
      }))
    };
  }

  if (task.type === "multi_node_merge") {
    const sourceNodes = task.sourceNodeIds.map((nodeId) =>
      requireNode(project.graph.nodes, nodeId)
    );

    return {
      taskId: task.id,
      type: task.type,
      sourceNodeIds: [...task.sourceNodeIds],
      sourceImagePaths: sourceNodes.map((node) => node.imagePath),
      instruction: task.instruction
    };
  }

  throw new Error(`Unsupported task type ${(task as { type?: unknown }).type}.`);
};

export const listPendingModelRequests = (
  project: Required<Pick<PendingTaskProjectState, "graph" | "tasks">>
): ModelGenerationRequest[] =>
  project.tasks
    .filter((task) => task.status === "pending")
    .map((task) => createModelGenerationRequest(project, task));
