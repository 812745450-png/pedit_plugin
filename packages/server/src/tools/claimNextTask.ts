import type { PeditTask } from "@pedit/core";
import {
  createModelGenerationRequest,
  type ModelGenerationRequest,
  type PendingTaskProjectState
} from "./createPendingTask.js";
import { cloneTask } from "./types.js";

export const PEDIT_CLAIM_NEXT_TASK_TOOL_NAME = "pedit_claim_next_task" as const;

export interface ClaimNextTaskResult<Project extends PendingTaskProjectState> {
  toolName: typeof PEDIT_CLAIM_NEXT_TASK_TOOL_NAME;
  ok: boolean;
  claimedTask: PeditTask | null;
  modelRequest: ModelGenerationRequest | null;
  project: Project;
}

export const claimNextPendingTask = <Project extends PendingTaskProjectState & {
  graph: NonNullable<PendingTaskProjectState["graph"]>;
}>(
  project: Project
): ClaimNextTaskResult<Project> => {
  const pendingTask = project.tasks.find((task) => task.status === "pending");

  if (!pendingTask) {
    return {
      toolName: PEDIT_CLAIM_NEXT_TASK_TOOL_NAME,
      ok: false,
      claimedTask: null,
      modelRequest: null,
      project: {
        ...project,
        tasks: project.tasks.map(cloneTask)
      }
    };
  }

  const claimedTask = {
    ...cloneTask(pendingTask),
    status: "running",
    error: null
  } satisfies PeditTask;
  const updatedProject = {
    ...project,
    tasks: project.tasks.map((task) =>
      task.id === pendingTask.id ? claimedTask : cloneTask(task)
    )
  };

  return {
    toolName: PEDIT_CLAIM_NEXT_TASK_TOOL_NAME,
    ok: true,
    claimedTask,
    modelRequest: createModelGenerationRequest(project, pendingTask),
    project: updatedProject
  };
};
