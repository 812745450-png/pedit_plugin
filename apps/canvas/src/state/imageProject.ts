export type ImageNodeKind = "source" | "edit" | "composite" | "text";

export interface ImageProjectNode {
  id: string;
  name: string;
  kind: ImageNodeKind;
  imageUrl: string;
  referenceImageUrls?: string[];
  referenceImageNames?: string[];
  parentIds: string[];
  hidden: boolean;
  deleted: boolean;
  position: { x: number; y: number };
  summary: string;
  prompt?: string;
  edgeLabel?: string;
  createdByTaskId?: string;
  createdAt: string;
}

export interface ImageProjectSnapshot {
  nodes: ImageProjectNode[];
}

export const projectStorageKey = "pedit.canvas.image-project";

const now = "2026-06-30T00:00:00.000+08:00";

export const sampleProjectNodes: ImageProjectNode[] = [
  {
    id: "root-image-group",
    name: "图片组 Root",
    kind: "source",
    imageUrl: "/samples/person.jpg",
    referenceImageUrls: ["/samples/person.jpg", "/samples/cat.jpg"],
    parentIds: [],
    hidden: false,
    deleted: false,
    position: { x: 360, y: 40 },
    summary: "项目 root，由一组参考图片组成。",
    createdAt: now
  },
  {
    id: "portrait-with-cat",
    name: "人物抱猫方案",
    kind: "composite",
    imageUrl: "/samples/person.jpg",
    parentIds: ["root-image-group"],
    hidden: false,
    deleted: false,
    position: { x: 80, y: 260 },
    prompt: "让人物自然抱着小猫，保持照片质感。",
    summary: "基于图片组生成更自然的人物与小猫组合方案。",
    edgeLabel: "组合生成",
    createdAt: now
  },
  {
    id: "living-room-tv",
    name: "客厅看电视",
    kind: "composite",
    imageUrl: "/samples/person.jpg",
    parentIds: ["root-image-group"],
    hidden: false,
    deleted: false,
    position: { x: 360, y: 260 },
    prompt: "人物抱着小猫坐在客厅看电视。",
    summary: "保留主体身份，生成生活化的客厅场景。",
    edgeLabel: "场景生成",
    createdAt: now
  },
  {
    id: "cover-crop",
    name: "封面构图",
    kind: "edit",
    imageUrl: "/samples/cat.jpg",
    parentIds: ["root-image-group"],
    hidden: false,
    deleted: false,
    position: { x: 640, y: 260 },
    prompt: "调整为更适合封面的构图。",
    summary: "探索封面比例和主体位置。",
    edgeLabel: "构图优化",
    createdAt: now
  },
  {
    id: "clean-background",
    name: "背景更干净",
    kind: "edit",
    imageUrl: "/samples/person.jpg",
    parentIds: ["portrait-with-cat"],
    hidden: false,
    deleted: false,
    position: { x: 0, y: 500 },
    prompt: "清理背景杂物，保持自然光。",
    summary: "减少背景干扰，让主体更突出。",
    edgeLabel: "局部优化",
    createdAt: now
  },
  {
    id: "warm-film",
    name: "暖色胶片",
    kind: "edit",
    imageUrl: "/samples/person.jpg",
    parentIds: ["portrait-with-cat"],
    hidden: false,
    deleted: false,
    position: { x: 240, y: 500 },
    prompt: "做成温暖胶片质感。",
    summary: "加强暖色调和轻微颗粒质感。",
    edgeLabel: "风格化",
    createdAt: now
  },
  {
    id: "merged-result",
    name: "合并精选",
    kind: "composite",
    imageUrl: "/samples/person.jpg",
    parentIds: ["portrait-with-cat", "living-room-tv", "cover-crop"],
    hidden: false,
    deleted: false,
    position: { x: 500, y: 500 },
    prompt: "综合人物抱猫、客厅场景与封面构图，生成一张完整新图。",
    summary: "合并多个版本的优点，形成新的分支节点。",
    edgeLabel: "多图合并",
    createdAt: now
  }
];

export function createSampleProjectSnapshot(): ImageProjectSnapshot {
  return {
    nodes: sampleProjectNodes.map((node) => ({ ...node, position: { ...node.position } }))
  };
}

export function findImageNode(nodes: ImageProjectNode[], nodeId: string | null) {
  if (!nodeId) {
    return null;
  }

  return nodes.find((node) => node.id === nodeId && !node.deleted) ?? null;
}

export function findPrimaryParent(
  nodes: ImageProjectNode[],
  node: ImageProjectNode | null
) {
  if (!node || node.parentIds.length === 0) {
    return null;
  }

  return findImageNode(nodes, node.parentIds[0]);
}

export function createEditedImageNode(input: {
  parent: ImageProjectNode;
  imageUrl: string;
  regionCount: number;
  instructions: string[];
  index: number;
}): ImageProjectNode {
  const name = input.index === 1 ? "Warm portrait edit" : `Portrait edit ${input.index}`;
  const id = `edit-${input.index}-${Date.now()}`;

  return {
    id,
    name,
    kind: "edit",
    imageUrl: input.imageUrl,
    parentIds: [input.parent.id],
    hidden: false,
    deleted: false,
    position: {
      x: input.parent.position.x + 280,
      y: input.parent.position.y + (input.index % 2 === 0 ? 120 : -80)
    },
    prompt: input.instructions.join("; "),
    summary: `Generated edit from ${input.regionCount} lasso region${
      input.regionCount === 1 ? "" : "s"
    }.`,
    createdAt: new Date().toISOString()
  };
}

export function createCompositeImageNode(input: {
  parents: ImageProjectNode[];
  imageUrl: string;
  prompt: string;
  index: number;
}): ImageProjectNode {
  const orderedParents = orderCompositeParents(input.parents);
  const maxX = Math.max(...input.parents.map((node) => node.position.x));
  const avgY =
    input.parents.reduce((sum, node) => sum + node.position.y, 0) /
    input.parents.length;

  return {
    id: `composite-${input.index}-${Date.now()}`,
    name: "Portrait + cat composite",
    kind: "composite",
    imageUrl: input.imageUrl,
    parentIds: orderedParents.map((node) => node.id),
    hidden: false,
    deleted: false,
    position: { x: maxX + 300, y: avgY },
    prompt: input.prompt,
    summary: `Merged ${input.parents.length} real image nodes into a composite output.`,
    createdAt: new Date().toISOString()
  };
}

function orderCompositeParents(parents: ImageProjectNode[]) {
  const cat = parents.find((node) => node.id.includes("cat"));
  const primary =
    parents.find((node) => node.id !== cat?.id && node.kind !== "source") ??
    parents.find((node) => node.id !== cat?.id) ??
    parents[0];
  const rest = parents.filter((node) => node.id !== primary.id);

  return [primary, ...rest];
}

export function findBranchIds(nodes: ImageProjectNode[], rootId: string) {
  const branchIds = new Set<string>([rootId]);
  let changed = true;

  while (changed) {
    changed = false;

    for (const node of nodes) {
      if (
        !branchIds.has(node.id) &&
        node.parentIds.some((parentId) => branchIds.has(parentId))
      ) {
        branchIds.add(node.id);
        changed = true;
      }
    }
  }

  return branchIds;
}

export function loadStoredProjectSnapshot(): ImageProjectSnapshot {
  if (typeof window === "undefined") {
    return { nodes: [] };
  }

  try {
    const stored = window.localStorage.getItem(projectStorageKey);

    if (!stored) {
      return { nodes: [] };
    }

    const parsed = JSON.parse(stored) as Partial<ImageProjectSnapshot>;

    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
      return { nodes: [] };
    }

    const isLegacySample =
      parsed.nodes.length === 2 &&
      parsed.nodes.some((node) => node.id === "person-source") &&
      parsed.nodes.some((node) => node.id === "cat-source");

    if (isLegacySample) {
      return { nodes: [] };
    }

    return { nodes: parsed.nodes };
  } catch {
    return { nodes: [] };
  }
}

export function saveProjectSnapshot(snapshot: ImageProjectSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(projectStorageKey, JSON.stringify(snapshot));
  } catch {
    // Large image data URLs can exceed browser storage quota; remote state remains authoritative.
  }
}
