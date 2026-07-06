import type { NodeKind, PeditNode, PeditTask } from "@pedit/core";
import { assertKnownTaskType, cloneNode, cloneTask, replaceOrAppendTask } from "./types.js";

export const PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME = "pedit_write_generation_result" as const;

export interface WriteGenerationResultInput {
  nodes: readonly PeditNode[];
  taskId?: string;
  task?: PeditTask;
  tasks?: readonly PeditTask[];
  resultNodeId?: string;
  imagePath?: string;
  thumbnailPath?: string;
  name?: string;
  summary?: string;
  error?: string | null;
}

export interface WriteGenerationResultOutput {
  toolName: typeof PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME;
  nodes: PeditNode[];
  tasks: PeditTask[];
  task: PeditTask;
  resultNode: PeditNode | null;
  summary: string | null;
}

const getResultParentIds = (task: PeditTask): string[] => {
  assertKnownTaskType(task);

  if (task.type === "region_edit") {
    return [task.sourceNodeId];
  }

  if (task.type === "multi_node_merge") {
    return [...task.sourceNodeIds];
  }

  throw new Error(`Unsupported task type ${(task as { type?: unknown }).type}.`);
};

const getResultKind = (task: PeditTask): NodeKind => {
  assertKnownTaskType(task);

  if (task.type === "region_edit") {
    return "edit";
  }

  if (task.type === "multi_node_merge") {
    return "merge";
  }

  throw new Error(`Unsupported task type ${(task as { type?: unknown }).type}.`);
};

const withTaskResult = (task: PeditTask, resultNodeId: string): PeditTask => {
  assertKnownTaskType(task);

  if (task.type === "region_edit") {
    return {
      ...cloneTask(task),
      status: "succeeded",
      error: null,
      resultNodeId
    };
  }

  return {
    ...cloneTask(task),
    status: "succeeded",
    error: null,
    resultNodeId
  };
};

const withTaskFailure = (task: PeditTask, error: string): PeditTask => {
  assertKnownTaskType(task);

  if (task.type === "region_edit") {
    const { resultNodeId: _resultNodeId, ...rest } = cloneTask(task);
    return {
      ...rest,
      status: "failed",
      error
    };
  }

  const { resultNodeId: _resultNodeId, ...rest } = cloneTask(task);
  return {
    ...rest,
    status: "failed",
    error
  };
};

const resolveTask = (input: WriteGenerationResultInput): { task: PeditTask; tasks: readonly PeditTask[] } => {
  const taskId = input.taskId ?? input.task?.id;

  if (!taskId) {
    throw new Error("Generation result requires taskId.");
  }

  if (input.tasks) {
    const task = input.tasks.find((candidate) => candidate.id === taskId);

    if (!task) {
      throw new Error(`Task ${taskId} could not be found in provided tasks.`);
    }

    return {
      task,
      tasks: input.tasks
    };
  }

  if (!input.task || input.task.id !== taskId) {
    throw new Error(`Task ${taskId} could not be found in provided tasks.`);
  }

  return {
    task: input.task,
    tasks: [input.task]
  };
};

const assertRunningTask = (task: PeditTask): void => {
  if (task.status !== "running") {
    throw new Error(`Task ${task.id} is already ${task.status} and cannot be written.`);
  }
};

export const writeGenerationResult = (input: WriteGenerationResultInput): WriteGenerationResultOutput => {
  const nodes = input.nodes.map(cloneNode);
  const { task, tasks: existingTasks } = resolveTask(input);
  assertKnownTaskType(task);
  assertRunningTask(task);

  const error = input.error?.trim();

  if (error) {
    const failedTask = withTaskFailure(task, error);

    return {
      toolName: PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME,
      nodes,
      tasks: replaceOrAppendTask(existingTasks, failedTask),
      task: failedTask,
      resultNode: null,
      summary: null
    };
  }

  if (!input.resultNodeId || !input.imagePath || !input.thumbnailPath) {
    throw new Error("Successful generation results require resultNodeId, imagePath, and thumbnailPath.");
  }

  if (nodes.some((node) => node.id === input.resultNodeId)) {
    throw new Error(`Result node ${input.resultNodeId} already exists.`);
  }

  const resultNode: PeditNode = {
    id: input.resultNodeId,
    name: input.name ?? input.summary ?? `Generated ${input.resultNodeId}`,
    kind: getResultKind(task),
    imagePath: input.imagePath,
    thumbnailPath: input.thumbnailPath,
    parentIds: getResultParentIds(task),
    hidden: false,
    deleted: false,
    createdByTaskId: task.id
  };
  const succeededTask = withTaskResult(task, input.resultNodeId);

  return {
    toolName: PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME,
    nodes: [...nodes, resultNode],
    tasks: replaceOrAppendTask(existingTasks, succeededTask),
    task: succeededTask,
    resultNode,
    summary: input.summary ?? null
  };
};
