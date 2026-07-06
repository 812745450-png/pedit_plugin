import type { PeditId } from "./ids.js";

export type TaskStatus = "pending" | "running" | "succeeded" | "failed";

export interface RegionInstruction {
  id: PeditId;
  label: string;
  maskPath: string;
  instruction: string;
}

export interface RegionEditTask {
  id: PeditId;
  type: "region_edit";
  status: TaskStatus;
  error: string | null;
  sourceNodeId: PeditId;
  regions: RegionInstruction[];
  resultNodeId?: PeditId;
}

export interface MergeTask {
  id: PeditId;
  type: "multi_node_merge";
  status: TaskStatus;
  error: string | null;
  sourceNodeIds: PeditId[];
  instruction: string;
  resultNodeId?: PeditId;
}

export type PeditTask = RegionEditTask | MergeTask;

const hasInstruction = (region: RegionInstruction): boolean => region.instruction.trim().length > 0;

export const canStartRegionEdit = (regions: readonly RegionInstruction[]): boolean =>
  regions.some(hasInstruction);

export const createRegionEditTask = (
  id: PeditId,
  sourceNodeId: PeditId,
  regions: readonly RegionInstruction[]
): RegionEditTask => {
  const filteredRegions = regions.filter(hasInstruction).map((region) => ({ ...region }));

  if (filteredRegions.length === 0) {
    throw new Error("Region edit task requires at least one non-empty region instruction.");
  }

  return {
    id,
    type: "region_edit",
    status: "pending",
    error: null,
    sourceNodeId,
    regions: filteredRegions
  };
};

export const createMergeTask = (
  id: PeditId,
  sourceNodeIds: readonly PeditId[],
  instruction: string
): MergeTask => {
  if (sourceNodeIds.length < 2) {
    throw new Error("Merge task requires at least two source nodes.");
  }

  if (instruction.trim().length === 0) {
    throw new Error("Merge task instruction cannot be blank.");
  }

  return {
    id,
    type: "multi_node_merge",
    status: "pending",
    error: null,
    sourceNodeIds: [...sourceNodeIds],
    instruction
  };
};
