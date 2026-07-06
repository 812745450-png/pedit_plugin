import type { PeditId } from "./ids.js";

export interface ValidationIssue {
  code: "duplicate_id" | "missing_parent";
  message: string;
  id: PeditId;
}

export interface ParentLinkedItem {
  id: PeditId;
  parentIds: readonly PeditId[];
}

export const duplicateIds = <T extends { id: PeditId }>(items: readonly T[]): PeditId[] => {
  const seen = new Set<PeditId>();
  const duplicates = new Set<PeditId>();

  for (const item of items) {
    if (seen.has(item.id)) {
      duplicates.add(item.id);
    } else {
      seen.add(item.id);
    }
  }

  return [...duplicates];
};

export const validateUniqueIds = <T extends { id: PeditId }>(items: readonly T[]): ValidationIssue[] =>
  duplicateIds(items).map((id) => ({
    code: "duplicate_id",
    message: `Duplicate id ${id}.`,
    id
  }));

export const validateParentLinks = (items: readonly ParentLinkedItem[]): ValidationIssue[] => {
  const ids = new Set(items.map((item) => item.id));

  return items.flatMap((item) =>
    item.parentIds
      .filter((parentId) => !ids.has(parentId))
      .map((parentId) => ({
        code: "missing_parent" as const,
        message: `Item ${item.id} references missing parent ${parentId}.`,
        id: item.id
      }))
  );
};
