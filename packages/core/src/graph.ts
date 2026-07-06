import type { CreateId, PeditId } from "./ids.js";

export type NodeKind = "upload" | "edit" | "merge";

export interface PeditNode {
  id: PeditId;
  name: string;
  kind: NodeKind;
  imagePath: string;
  thumbnailPath: string;
  parentIds: PeditId[];
  hidden: boolean;
  deleted: boolean;
  createdByTaskId?: PeditId;
}

const cloneNode = (node: PeditNode): PeditNode => ({
  ...node,
  parentIds: [...node.parentIds]
});

const branchIds = (nodes: readonly PeditNode[], rootId: PeditId): Set<PeditId> => {
  const ids = new Set<PeditId>([rootId]);
  let changed = true;

  while (changed) {
    changed = false;

    for (const node of nodes) {
      if (ids.has(node.id)) {
        continue;
      }

      if (node.parentIds.some((parentId) => ids.has(parentId))) {
        ids.add(node.id);
        changed = true;
      }
    }
  }

  return ids;
};

const updateBranch = (
  nodes: readonly PeditNode[],
  rootId: PeditId,
  update: (node: PeditNode) => PeditNode
): PeditNode[] => {
  const ids = branchIds(nodes, rootId);
  return nodes.map((node) => {
    const clonedNode = cloneNode(node);
    return ids.has(node.id) ? update(clonedNode) : clonedNode;
  });
};

export const hideBranch = (nodes: readonly PeditNode[], rootId: PeditId): PeditNode[] =>
  updateBranch(nodes, rootId, (node) => ({ ...node, hidden: true }));

export const restoreBranch = (nodes: readonly PeditNode[], rootId: PeditId): PeditNode[] =>
  updateBranch(nodes, rootId, (node) => ({ ...node, hidden: false }));

export const cascadeDelete = (nodes: readonly PeditNode[], rootId: PeditId): PeditNode[] =>
  updateBranch(nodes, rootId, (node) => ({ ...node, deleted: true }));

export const visibleNodes = (nodes: readonly PeditNode[], showHidden: boolean): PeditNode[] =>
  nodes.filter((node) => !node.deleted && (showHidden || !node.hidden)).map(cloneNode);

export const copyBranch = (
  nodes: readonly PeditNode[],
  rootId: PeditId,
  createId: CreateId
): PeditNode[] => {
  const ids = branchIds(nodes, rootId);
  const idCopies = new Map<PeditId, PeditId>();

  for (const node of nodes) {
    if (ids.has(node.id)) {
      idCopies.set(node.id, createId(node.id));
    }
  }

  const copiedNodes = nodes
    .filter((node) => ids.has(node.id))
    .map((node) => ({
      ...node,
      id: idCopies.get(node.id) ?? createId(node.id),
      name: `${node.name} Copy`,
      parentIds: node.parentIds.map((parentId) => idCopies.get(parentId) ?? parentId),
      hidden: false,
      deleted: false
    }));

  return [...nodes.map(cloneNode), ...copiedNodes];
};
