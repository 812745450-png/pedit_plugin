import type { PeditNode, PeditTask } from "@pedit/core";
import type { ProjectMode } from "../storage/projectStore.js";

export interface PeditToolProjectState {
  mode: ProjectMode;
  currentNodeId: string | null;
  selectedNodeIds: string[];
  graph: {
    nodes: PeditNode[];
  };
  tasks: PeditTask[];
}

export const cloneNode = (node: PeditNode): PeditNode => ({
  ...node,
  parentIds: [...node.parentIds]
});

const unsupportedTaskTypeMessage = (task: PeditTask): string => {
  const type = (task as { type?: unknown }).type;
  return `Unsupported task type ${typeof type === "string" ? type : String(type)}.`;
};

export const assertKnownTaskType = (task: PeditTask): void => {
  if (task.type !== "region_edit" && task.type !== "multi_node_merge") {
    throw new Error(unsupportedTaskTypeMessage(task));
  }
};

export const cloneTask = (task: PeditTask): PeditTask => {
  assertKnownTaskType(task);

  if (task.type === "region_edit") {
    return {
      ...task,
      regions: task.regions.map((region) => ({ ...region }))
    };
  }

  if (task.type === "multi_node_merge") {
    return {
      ...task,
      sourceNodeIds: [...task.sourceNodeIds]
    };
  }

  throw new Error(unsupportedTaskTypeMessage(task));
};

export const replaceOrAppendTask = (tasks: readonly PeditTask[], updatedTask: PeditTask): PeditTask[] => {
  let replaced = false;
  const updatedTasks = tasks.map((task) => {
    if (task.id !== updatedTask.id) {
      return cloneTask(task);
    }

    replaced = true;
    return cloneTask(updatedTask);
  });

  return replaced ? updatedTasks : [...updatedTasks, cloneTask(updatedTask)];
};
