import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  compactRuntimeText,
  persistRuntimeDataUrl,
  readRuntimeImageUrlBytesSync,
  readRuntimeImageDimensions,
  runtimeFilePath,
  validateRuntimeImageUrlSync
} from "./runtimeAssets.js";

export type RuntimeCanvasMode = "big_image_view" | "big_image_edit" | "version";
export type RuntimeImageNodeKind = "source" | "edit" | "composite" | "text";
export type RuntimeTaskType = "region_edit" | "multi_node_merge" | "text_to_image";
export type RuntimeTaskStatus = "pending" | "running" | "succeeded" | "failed";
export type RuntimeSelectionSemantics =
  | "strict_local"
  | "soft_local"
  | "contextual_inpaint"
  | "global_edit";
export type RuntimeHandoffChannel =
  | "manual_handoff"
  | "annotation_handoff"
  | "mcp_queue"
  | "codex_exec";

export interface RuntimeQualityGate {
  status?: "pending" | "passed" | "failed";
  minResultByteRatio?: number;
  notes?: string[];
}

export interface RuntimeReferenceImage {
  name: string;
  imageUrl: string;
}

export interface RuntimeRegionDraft {
  id: string;
  label: string;
  points: Array<{ x: number; y: number }>;
  bounds?: { x: number; y: number; width: number; height: number };
  maskUrl?: string;
  maskPath?: string;
  maskSize?: { width: number; height: number };
  maskStatus?: "ready" | "skipped_too_large" | "skipped_unsupported_source";
  maskReason?: string;
  instruction: string;
}

export interface RuntimeImageNode {
  id: string;
  name: string;
  kind: RuntimeImageNodeKind;
  imageUrl: string;
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

export interface RuntimeGenerationTask {
  id: string;
  type: RuntimeTaskType;
  status: RuntimeTaskStatus;
  sourceNodeIds: string[];
  regions?: RuntimeRegionDraft[];
  instruction: string;
  referenceImages?: RuntimeReferenceImage[];
  codexPrompt: string;
  selectionSemantics?: RuntimeSelectionSemantics;
  contextPaddingPercent?: number;
  qualityGate?: RuntimeQualityGate;
  handoffChannel?: RuntimeHandoffChannel;
  handoffPrompt?: string;
  resultNodeId?: string;
  error: string | null;
  workerStage?: "starting" | "processing" | "writing" | "validating" | "cancelling";
  workerMessage?: string;
  workerStartedAt?: string;
  lastWorkerLogAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeCanvasState {
  mode: RuntimeCanvasMode;
  currentNodeId: string | null;
  selectedNodeIds: string[];
  showHiddenNodes: boolean;
  nodes: RuntimeImageNode[];
  tasks: RuntimeGenerationTask[];
}

export const createDefaultRuntimeCanvasState = (): RuntimeCanvasState => ({
  mode: "big_image_view",
  currentNodeId: null,
  selectedNodeIds: [],
  showHiddenNodes: false,
  nodes: [],
  tasks: []
});

export const readRuntimeCanvasState = (): RuntimeCanvasState => {
  const filePath = runtimeFilePath();

  if (!existsSync(filePath)) {
    return createDefaultRuntimeCanvasState();
  }

  try {
    return normalizeRuntimeCanvasState(
      JSON.parse(readFileSync(filePath, "utf8")) as RuntimeCanvasState
    );
  } catch {
    return createDefaultRuntimeCanvasState();
  }
};

export const writeRuntimeCanvasState = (
  state: RuntimeCanvasState
): RuntimeCanvasState => {
  const filePath = runtimeFilePath();
  const normalizedState = normalizeRuntimeCanvasState(state);
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(normalizedState, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
  return normalizedState;
};

export const mergeRuntimeCanvasStateFromClient = (
  incomingState: RuntimeCanvasState
): RuntimeCanvasState => {
  const currentState = readRuntimeCanvasState();
  const incomingNodeIds = new Set(incomingState.nodes.map((node) => node.id));
  const incomingTaskIds = new Set(incomingState.tasks.map((task) => task.id));
  const preservedTasks = currentState.tasks.filter(
    (task) =>
      !incomingTaskIds.has(task.id) &&
      (task.status === "pending" ||
        task.status === "running" ||
        (task.status === "succeeded" && Boolean(task.resultNodeId)))
  );
  const protectedResultNodeIds = new Set(
    currentState.tasks
      .filter((task) => task.status === "succeeded" && task.resultNodeId)
      .map((task) => task.resultNodeId as string)
  );
  const preservedNodes = currentState.nodes.filter(
    (node) =>
      !incomingNodeIds.has(node.id) &&
      (protectedResultNodeIds.has(node.id) ||
        preservedTasks.some(
          (task) =>
            task.sourceNodeIds.includes(node.id) ||
            task.resultNodeId === node.id
        ))
  );
  const shouldKeepCurrentSelection =
    preservedNodes.some((node) => node.id === currentState.currentNodeId) ||
    preservedTasks.some((task) => task.resultNodeId === currentState.currentNodeId);

  return writeRuntimeCanvasState({
    ...incomingState,
    currentNodeId: shouldKeepCurrentSelection
      ? currentState.currentNodeId
      : incomingState.currentNodeId,
    selectedNodeIds: shouldKeepCurrentSelection && currentState.currentNodeId
      ? [currentState.currentNodeId]
      : incomingState.selectedNodeIds,
    nodes: [...incomingState.nodes, ...preservedNodes],
    tasks: [...incomingState.tasks, ...preservedTasks]
  });
};

export const resetRuntimeCanvasState = (): RuntimeCanvasState =>
  writeRuntimeCanvasState(createDefaultRuntimeCanvasState());

export const upsertRuntimeTask = (
  task: RuntimeGenerationTask
): RuntimeCanvasState => {
  const state = readRuntimeCanvasState();
  const existingIndex = state.tasks.findIndex((candidate) => candidate.id === task.id);
  const tasks =
    existingIndex === -1
      ? [...state.tasks, task]
      : state.tasks.map((candidate) =>
          candidate.id === task.id ? task : candidate
        );

  return writeRuntimeCanvasState({ ...state, tasks });
};

export interface RuntimeClaimNextTaskResult {
  ok: boolean;
  claimedTask: RuntimeGenerationTask | null;
  project: RuntimeCanvasState;
}

export const claimNextRuntimeTask = (): RuntimeClaimNextTaskResult => {
  const state = readRuntimeCanvasState();
  const pendingTask = state.tasks.find((task) => task.status === "pending");

  if (!pendingTask) {
    return {
      ok: false,
      claimedTask: null,
      project: state
    };
  }

  const claimedTask: RuntimeGenerationTask = {
    ...pendingTask,
    status: "running",
    error: null,
    updatedAt: new Date().toISOString()
  };
  const project = writeRuntimeCanvasState({
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === pendingTask.id ? claimedTask : task
    )
  });

  return {
    ok: true,
    claimedTask,
    project
  };
};

export const updateRuntimeTaskProgress = (
  taskId: string,
  progress: Partial<Pick<
    RuntimeGenerationTask,
    "workerStage" | "workerMessage" | "workerStartedAt" | "lastWorkerLogAt"
  >>
): RuntimeCanvasState => {
  const state = readRuntimeCanvasState();
  return writeRuntimeCanvasState({
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            ...progress,
            updatedAt: new Date().toISOString()
          }
        : task
    )
  });
};

export interface RuntimeResultInput {
  taskId: string;
  resultNodeId?: string;
  name?: string;
  imageUrl?: string;
  summary?: string;
  edgeLabel?: string;
  error?: string | null;
}

export const writeRuntimeGenerationResult = (
  input: RuntimeResultInput
): RuntimeCanvasState => {
  const state = readRuntimeCanvasState();
  const task = state.tasks.find((candidate) => candidate.id === input.taskId);

  if (!task) {
    throw new Error(`Task ${input.taskId} could not be found.`);
  }

  if (input.error?.trim()) {
    return writeRuntimeCanvasState({
      ...state,
      tasks: state.tasks.map((candidate) =>
        candidate.id === task.id
          ? {
              ...candidate,
              status: "failed",
              error: input.error?.trim() ?? "Generation failed.",
              workerStage: undefined,
              workerMessage: undefined,
              updatedAt: new Date().toISOString()
            }
          : candidate
      )
    });
  }

  if (!input.imageUrl) {
    throw new Error("Successful runtime generation results require imageUrl.");
  }

  const imageValidation = validateRuntimeImageUrlSync(input.imageUrl);
  if (!imageValidation.ok) {
    return writeRuntimeCanvasState({
      ...state,
      tasks: state.tasks.map((candidate) =>
        candidate.id === task.id
          ? {
              ...candidate,
              status: "failed",
              error: `Generated image could not be decoded: ${imageValidation.error}`,
              workerStage: undefined,
              workerMessage: undefined,
              updatedAt: new Date().toISOString()
            }
          : candidate
      )
    });
  }

  const resultNodeId = input.resultNodeId ?? `result-${Date.now()}`;
  if (state.nodes.some((node) => node.id === resultNodeId)) {
    throw new Error(`Result node ${resultNodeId} already exists.`);
  }

  const sourceNodes = task.sourceNodeIds
    .map((nodeId) => state.nodes.find((node) => node.id === nodeId))
    .filter((node): node is RuntimeImageNode => Boolean(node));

  if (task.type === "region_edit" && sourceNodes[0]) {
    const sourceDimensions = readRuntimeImageDimensions(sourceNodes[0].imageUrl);
    const resultDimensions = readRuntimeImageDimensions(input.imageUrl);

    if (
      sourceDimensions &&
      resultDimensions &&
      (sourceDimensions.width !== resultDimensions.width ||
        sourceDimensions.height !== resultDimensions.height)
    ) {
      return writeRuntimeCanvasState({
        ...state,
        tasks: state.tasks.map((candidate) =>
          candidate.id === task.id
            ? {
                ...candidate,
                status: "failed",
                error: `Region edit result dimensions ${resultDimensions.width}x${resultDimensions.height} do not match source dimensions ${sourceDimensions.width}x${sourceDimensions.height}. Refusing to write a lower-fidelity or resized edit result.`,
                workerStage: undefined,
                workerMessage: undefined,
                updatedAt: new Date().toISOString()
              }
            : candidate
        )
      });
    }
  }

  const qualityGateFailure = runRuntimeQualityGate(task, sourceNodes[0], input.imageUrl);
  if (qualityGateFailure) {
    return writeRuntimeCanvasState({
      ...state,
      tasks: state.tasks.map((candidate) =>
        candidate.id === task.id
          ? {
              ...candidate,
              status: "failed",
              error: qualityGateFailure,
              qualityGate: {
                ...candidate.qualityGate,
                status: "failed",
                notes: [
                  ...(candidate.qualityGate?.notes ?? []),
                  qualityGateFailure
                ]
              },
              workerStage: undefined,
              workerMessage: undefined,
              updatedAt: new Date().toISOString()
            }
          : candidate
      )
    });
  }

  const maxX = sourceNodes.length
    ? Math.max(...sourceNodes.map((node) => node.position.x))
    : 40;
  const avgY = sourceNodes.length
    ? sourceNodes.reduce((sum, node) => sum + node.position.y, 0) /
      sourceNodes.length
    : 160;
  const kind: RuntimeImageNodeKind =
    task.type === "multi_node_merge"
      ? "composite"
      : task.type === "text_to_image"
        ? "text"
        : "edit";
  const parentIds = task.type === "text_to_image" ? [] : [...task.sourceNodeIds];
  const resultNode: RuntimeImageNode = {
    id: resultNodeId,
    name: input.name ?? (kind === "composite" ? "Codex composite" : "Codex edit"),
    kind,
    imageUrl: input.imageUrl,
    parentIds,
    hidden: false,
    deleted: false,
    position: {
      x: maxX + 300,
      y: avgY + (kind === "edit" ? -80 : 0)
    },
    summary: input.summary ?? task.instruction,
    prompt: task.instruction,
    edgeLabel: input.edgeLabel ?? summarizeEdge(task),
    createdByTaskId: task.id,
    createdAt: new Date().toISOString()
  };

  return writeRuntimeCanvasState({
    ...state,
    mode: "big_image_view",
    currentNodeId: resultNode.id,
    selectedNodeIds: [resultNode.id],
    nodes: [...state.nodes, resultNode],
    tasks: state.tasks.map((candidate) =>
      candidate.id === task.id
        ? {
            ...candidate,
            status: "succeeded",
            resultNodeId: resultNode.id,
            error: null,
            qualityGate: {
              ...candidate.qualityGate,
              status: "passed",
              notes: candidate.qualityGate?.notes
            },
            workerStage: undefined,
            workerMessage: undefined,
            updatedAt: new Date().toISOString()
          }
        : candidate
    )
  });
};

const runRuntimeQualityGate = (
  task: RuntimeGenerationTask,
  sourceNode: RuntimeImageNode | undefined,
  resultImageUrl: string
): string | null => {
  const minResultByteRatio = task.qualityGate?.minResultByteRatio;
  if (!sourceNode || !minResultByteRatio || minResultByteRatio <= 0) {
    return null;
  }

  try {
    const sourceBytes = readRuntimeImageUrlBytesSync(sourceNode.imageUrl);
    const resultBytes = readRuntimeImageUrlBytesSync(resultImageUrl);
    const ratio = resultBytes.length / Math.max(1, sourceBytes.length);

    if (ratio < minResultByteRatio) {
      return `Result failed quality gate: output is too small relative to the source (${ratio.toFixed(2)}x, required >= ${minResultByteRatio.toFixed(2)}x), which may indicate heavy compression, low detail, or a degraded image.`;
    }
  } catch {
    return null;
  }

  return null;
};

const summarizeEdge = (task: RuntimeGenerationTask) => {
  if (task.type === "multi_node_merge") {
    return "Multi-image Codex merge";
  }

  if (task.type === "text_to_image") {
    return "Text-to-image root";
  }

  return `${task.regions?.length ?? 0} region Codex edit`;
};

const normalizeRuntimeCanvasState = (
  state: RuntimeCanvasState
): RuntimeCanvasState => ({
  ...state,
  nodes: state.nodes.map((node) => ({
    ...node,
    imageUrl: persistRuntimeDataUrl(node.imageUrl, node.id)
  })),
  tasks: state.tasks.map((task) => ({
    ...normalizeRuntimeHandoffTask(task),
    codexPrompt: compactRuntimeText(task.codexPrompt),
    referenceImages: normalizeRuntimeReferenceImages(task),
    regions: task.regions?.map((region) => ({
      ...region,
      maskUrl: region.maskUrl
        ? persistRuntimeDataUrl(region.maskUrl, `${task.id}-${region.id}-mask`)
        : region.maskUrl
    }))
  }))
});

const normalizeRuntimeReferenceImages = (
  task: RuntimeGenerationTask
): RuntimeReferenceImage[] | undefined => {
  const references = task.referenceImages
    ?.filter(
      (reference) =>
        reference &&
        typeof reference.name === "string" &&
        typeof reference.imageUrl === "string"
    )
    .map((reference, index) => ({
      name: compactRuntimeText(reference.name).slice(0, 180),
      imageUrl: persistRuntimeDataUrl(
        reference.imageUrl,
        `${task.id}-reference-${index + 1}`
      )
    }));

  return references?.length ? references : undefined;
};

const normalizeRuntimeHandoffTask = (
  task: RuntimeGenerationTask
): RuntimeGenerationTask => {
  if (task.handoffChannel !== "annotation_handoff") {
    return task;
  }

  return {
    ...task,
    handoffChannel: "manual_handoff",
    handoffPrompt: task.handoffPrompt?.startsWith("Pedit Annotation Handoff")
      ? buildRuntimeManualHandoffPrompt(task)
      : task.handoffPrompt
  };
};

const buildRuntimeManualHandoffPrompt = (task: RuntimeGenerationTask) =>
  [
    "Pedit Codex Handoff",
    `taskId=${task.id}`,
    `type=${task.type}`,
    task.selectionSemantics ? `selectionSemantics=${task.selectionSemantics}` : null,
    `hasRegions=${task.regions?.length ? "true" : "false"}`,
    `referenceCount=${task.referenceImages?.length ?? 0}`,
    handoffSelectionSemanticsInstruction(task.selectionSemantics),
    task.referenceImages?.length
      ? "本任务包含参考图：请在 claim 后读取 task.referenceImages[].imageUrl，不要只根据参考图文件名猜测内容。"
      : null,
    !task.regions?.length
      ? "本任务没有用户圈选区域：请按整图修图流程处理，不要把局部圈选当成限制，也不要为了处理而手工造 mask/选区。"
      : null,
    "请接手这个 Pedit 修图任务：先调用 pedit_get_canvas_state，再调用 pedit_claim_next_task。",
    task.regions?.length && task.selectionSemantics === "strict_local"
      ? "如果是 strict_local 局部改色任务，请先调用 pedit_run_local_fast_path；如果 ok=true，结果已写回，无需再调用 image2。"
      : "无选区或非 strict_local 任务不要先走局部 fast path；请直接按 sourceNodeIds 和 codexPrompt 使用整图 image2 编辑流程。",
    task.regions?.length
      ? "如果 pedit_run_local_fast_path 返回 unsupported，或任务不是可支持的局部改色，再按 sourceNodeIds、regions、maskPath/maskUrl、codexPrompt 调用 Codex image2 完成修图。"
      : "如果用户没有圈选区域，regions/maskPath/maskUrl 为空是正常情况；请不要因此退化成手工选区流程。",
    "image2 原始输出只能作为中间预览；如果你进行了放大、融合、裁剪、后处理或质量修复，必须把最终候选图重新展示/验收。",
    "最终写回 Pedit 的图片必须是你最终展示和验收的同一张图片，不要让 Codex 中的预览图和 Pedit 结果不一致。",
    "写回前请自检画质、尺寸、主体一致性、选区准确性和整体和谐度；不合格不要写入版本树。",
    "完成后调用 pedit_write_generation_result 写回结果，Pedit 会自动监听并生成新版本节点。"
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

const handoffSelectionSemanticsInstruction = (
  selectionSemantics: RuntimeSelectionSemantics | undefined
) => {
  if (selectionSemantics === "strict_local") {
    return "strict_local 表示选区是高精度硬边界，只改目标像素，尽量保持选区外完全不变。";
  }

  if (selectionSemantics === "contextual_inpaint") {
    return "contextual_inpaint 表示选区是问题锚点，不是硬边界；移除/补全类任务必须利用周边上下文做自然过渡，并以整图和谐度为验收标准。";
  }

  if (selectionSemantics === "global_edit") {
    return "global_edit 表示选区只是注意力锚点，允许为满足用户目标进行必要的整图一致性调整。";
  }

  if (selectionSemantics === "soft_local") {
    return "soft_local 表示选区是主要目标，可在必要时做少量周边融合以获得自然结果。";
  }

  return null;
};
