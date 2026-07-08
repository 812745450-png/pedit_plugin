import type { ImageProjectNode } from "./imageProject";

export type CanvasGenerationTaskType =
  | "region_edit"
  | "multi_node_merge"
  | "text_to_image";
export type CanvasGenerationTaskStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed";
export type CanvasSelectionSemantics =
  | "strict_local"
  | "soft_local"
  | "contextual_inpaint"
  | "global_edit";
export type CanvasHandoffChannel =
  | "manual_handoff"
  | "annotation_handoff"
  | "mcp_queue"
  | "codex_exec";

export interface CanvasQualityGate {
  status?: "pending" | "passed" | "failed";
  minResultByteRatio?: number;
  notes?: string[];
}

export interface CanvasReferenceImage {
  name: string;
  imageUrl: string;
}

export interface CanvasGenerationTask {
  id: string;
  type: CanvasGenerationTaskType;
  status: CanvasGenerationTaskStatus;
  sourceNodeIds: string[];
  regions?: Array<{
    id: string;
    label: string;
    points: Array<{ x: number; y: number }>;
    bounds?: RegionBounds;
    maskUrl?: string;
    maskPath?: string;
    maskSize?: { width: number; height: number };
    maskStatus?: "ready" | "skipped_too_large" | "skipped_unsupported_source";
    maskReason?: string;
    instruction: string;
  }>;
  instruction: string;
  referenceImages?: CanvasReferenceImage[];
  codexPrompt: string;
  selectionSemantics?: CanvasSelectionSemantics;
  contextPaddingPercent?: number;
  qualityGate?: CanvasQualityGate;
  handoffChannel?: CanvasHandoffChannel;
  handoffPrompt?: string;
  handoffCopiedAt?: string;
  resultNodeId?: string;
  error: string | null;
  workerStage?: "starting" | "processing" | "writing" | "validating" | "cancelling";
  workerMessage?: string;
  workerStartedAt?: string;
  lastWorkerLogAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteCanvasProject {
  mode: "big_image_view" | "big_image_edit" | "version";
  currentNodeId: string | null;
  selectedNodeIds: string[];
  showHiddenNodes: boolean;
  nodes: ImageProjectNode[];
  tasks: CanvasGenerationTask[];
}

export interface RemoteProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentNodeId: string | null;
  thumbnailUrl: string | null;
  nodeCount: number;
  taskCount: number;
}

export interface RemoteProjectLibrary {
  ok: true;
  activeProjectId: string | null;
  projects: RemoteProjectSummary[];
  project: RemoteCanvasProject;
}

export interface CodexBridgeStatus {
  ok: true;
  mode: "mcp";
  status: "active" | "unavailable";
  automationId: string;
  workerName: string;
  maxClaimDelayMs: number;
  concurrency: number;
  canSpawnNativeWorker: boolean;
  nativeToolExposure?: "observed" | "not_observed_in_current_thread";
  handoffMode: "manual_handoff";
  lastHandoffRequestAt: string | null;
  lastHandoffTaskId: string | null;
  lastHandoffChannel: CanvasHandoffChannel | null;
  lastWakeRequestAt: string | null;
  lastWakeTaskId: string | null;
  lastMcpToolCallAt: string | null;
  lastMcpToolName: string | null;
  message: string;
  setupInstructions: string;
}

export interface CodexWorkerStartResult {
  ok: boolean;
  taskId: string;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  project: RemoteCanvasProject;
}

export interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function inferSelectionSemantics(
  instruction: string,
  type: CanvasGenerationTaskType = "region_edit"
): CanvasSelectionSemantics {
  const text = instruction.toLowerCase();

  if (type === "multi_node_merge" || type === "text_to_image") {
    return "global_edit";
  }

  if (/(背景|沙发|场景|环境|整体|风格|姿态|动作|合成|融合|换成白色|换成绿色)/i.test(text)) {
    return "global_edit";
  }

  if (/(删除|移除|去除|消除|抹掉|擦除|补全|修补|inpaint|remove|erase)/i.test(text)) {
    return "contextual_inpaint";
  }

  if (/(换成|变成|改成|颜色|蓝色|绿色|红色|黄色|色相|亮度|对比|清晰|锐化|饱和)/i.test(text)) {
    return "strict_local";
  }

  return "soft_local";
}

export function getRegionBounds(points: Array<{ x: number; y: number }>): RegionBounds {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.max(0, Math.min(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxX = Math.min(100, Math.max(...xs));
  const maxY = Math.min(100, Math.max(...ys));

  return {
    x: roundPercent(minX),
    y: roundPercent(minY),
    width: roundPercent(Math.max(0, maxX - minX)),
    height: roundPercent(Math.max(0, maxY - minY))
  };
}

export function describeRegionGeometry(region: {
  label: string;
  points: Array<{ x: number; y: number }>;
  bounds?: RegionBounds;
}) {
  const bounds = region.bounds ?? getRegionBounds(region.points);
  const center = {
    x: roundPercent(bounds.x + bounds.width / 2),
    y: roundPercent(bounds.y + bounds.height / 2)
  };
  const points = region.points
    .map((point) => `(${roundPercent(point.x)},${roundPercent(point.y)})`)
    .join(" ");

  return `${region.label}: bbox x=${bounds.x}%, y=${bounds.y}%, w=${bounds.width}%, h=${bounds.height}%; center=(${center.x}%,${center.y}%); polygon=${points}`;
}

export type RemoteProjectFetchResult =
  | { available: true; project: RemoteCanvasProject | null }
  | { available: false; project: null; error: string };

export async function fetchRemoteProjectStatus(): Promise<RemoteProjectFetchResult> {
  try {
    const response = await fetch("/api/project", { cache: "no-store" });
    if (!response.ok) {
      return {
        available: false,
        project: null,
        error: `HTTP ${response.status}`
      };
    }
    return {
      available: true,
      project: (await response.json()) as RemoteCanvasProject | null
    };
  } catch (error) {
    return {
      available: false,
      project: null,
      error: error instanceof Error ? error.message : "Pedit backend unavailable"
    };
  }
}

export async function fetchRemoteProject(): Promise<RemoteCanvasProject | null> {
  return (await fetchRemoteProjectStatus()).project;
}

export async function saveRemoteProject(
  project: RemoteCanvasProject
): Promise<boolean> {
  try {
    const response = await fetch("/api/project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function resetRemoteProject(): Promise<RemoteCanvasProject | null> {
  try {
    const response = await fetch("/api/reset", { method: "POST" });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as RemoteCanvasProject;
  } catch {
    return null;
  }
}

export async function fetchRemoteProjectLibrary(): Promise<RemoteProjectLibrary | null> {
  try {
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return parseRemoteProjectLibrary(await response.json());
  } catch {
    return null;
  }
}

export async function createRemoteProjectSlot(
  name: string
): Promise<RemoteProjectLibrary | null> {
  try {
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    if (!response.ok) {
      return null;
    }
    return parseRemoteProjectLibrary(await response.json());
  } catch {
    return null;
  }
}

export async function openRemoteProjectSlot(
  projectId: string
): Promise<RemoteProjectLibrary | null> {
  try {
    const response = await fetch("/api/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId })
    });
    if (!response.ok) {
      return null;
    }
    return parseRemoteProjectLibrary(await response.json());
  } catch {
    return null;
  }
}

export async function renameRemoteProjectSlot(
  projectId: string | null,
  name: string
): Promise<RemoteProjectLibrary | null> {
  try {
    const response = await fetch("/api/projects/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name })
    });
    if (!response.ok) {
      return null;
    }
    return parseRemoteProjectLibrary(await response.json());
  } catch {
    return null;
  }
}

export async function deleteRemoteProjectSlot(
  projectId: string
): Promise<RemoteProjectLibrary | null> {
  try {
    const response = await fetch("/api/projects/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId })
    });
    if (!response.ok) {
      return null;
    }
    return parseRemoteProjectLibrary(await response.json());
  } catch {
    return null;
  }
}

const parseRemoteProjectLibrary = (value: unknown): RemoteProjectLibrary | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const library = value as Partial<RemoteProjectLibrary>;
  const project = library.project;
  const valid =
    library.ok === true &&
    (typeof library.activeProjectId === "string" || library.activeProjectId === null) &&
    Array.isArray(library.projects) &&
    Boolean(project) &&
    typeof project === "object" &&
    Array.isArray((project as RemoteCanvasProject).nodes) &&
    Array.isArray((project as RemoteCanvasProject).tasks);

  return valid ? (library as RemoteProjectLibrary) : null;
};

export async function createRemoteTask(
  task: CanvasGenerationTask
): Promise<RemoteCanvasProject | null> {
  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task })
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as RemoteCanvasProject;
  } catch {
    return null;
  }
}

export async function fetchCodexBridgeStatus(): Promise<CodexBridgeStatus | null> {
  try {
    const response = await fetch("/api/bridge/status", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return parseCodexBridgeStatus(await response.json());
  } catch {
    return null;
  }
}

export async function recordCodexBridgeTaskRequest(
  taskId: string,
  channel: CanvasHandoffChannel = "manual_handoff"
): Promise<CodexBridgeStatus | null> {
  try {
    const response = await fetch("/api/bridge/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, channel })
    });
    if (!response.ok) {
      return null;
    }
    return parseCodexBridgeStatus(await response.json());
  } catch {
    return null;
  }
}

export async function startCodexWorkerTask(
  taskId: string
): Promise<CodexWorkerStartResult | null> {
  try {
    const response = await fetch("/api/codex-worker/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId })
    });
    if (!response.ok) {
      return null;
    }
    return parseCodexWorkerStartResult(await response.json());
  } catch {
    return null;
  }
}

export async function cancelCodexWorkerTask(
  taskId: string,
  reason = "用户已取消此任务。"
): Promise<CodexWorkerStartResult | null> {
  try {
    const response = await fetch("/api/codex-worker/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, reason })
    });
    if (!response.ok) {
      return null;
    }
    return parseCodexWorkerStartResult(await response.json());
  } catch {
    return null;
  }
}

const parseCodexBridgeStatus = (value: unknown): CodexBridgeStatus | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const status = value as Partial<CodexBridgeStatus>;
  const valid =
    status.ok === true &&
    status.mode === "mcp" &&
    (status.status === "active" || status.status === "unavailable") &&
    typeof status.automationId === "string" &&
    typeof status.workerName === "string" &&
    typeof status.maxClaimDelayMs === "number" &&
    typeof status.concurrency === "number" &&
    typeof status.canSpawnNativeWorker === "boolean" &&
    (status.nativeToolExposure === undefined ||
      status.nativeToolExposure === "observed" ||
      status.nativeToolExposure === "not_observed_in_current_thread") &&
    (status.handoffMode === "manual_handoff" ||
      status.handoffMode === "annotation_handoff") &&
    (typeof status.lastHandoffRequestAt === "string" || status.lastHandoffRequestAt === null) &&
    (typeof status.lastHandoffTaskId === "string" || status.lastHandoffTaskId === null) &&
    (status.lastHandoffChannel === "manual_handoff" ||
      status.lastHandoffChannel === "annotation_handoff" ||
      status.lastHandoffChannel === "mcp_queue" ||
      status.lastHandoffChannel === "codex_exec" ||
      status.lastHandoffChannel === null) &&
    (typeof status.lastWakeRequestAt === "string" || status.lastWakeRequestAt === null) &&
    (typeof status.lastWakeTaskId === "string" || status.lastWakeTaskId === null) &&
    (typeof status.lastMcpToolCallAt === "string" || status.lastMcpToolCallAt === null) &&
    (typeof status.lastMcpToolName === "string" || status.lastMcpToolName === null) &&
    typeof status.message === "string" &&
    typeof status.setupInstructions === "string";

  return valid ? (status as CodexBridgeStatus) : null;
};

const parseCodexWorkerStartResult = (
  value: unknown
): CodexWorkerStartResult | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const result = value as Partial<CodexWorkerStartResult>;
  const project = result.project;
  const valid =
    typeof result.ok === "boolean" &&
    typeof result.taskId === "string" &&
    (result.status === "running" || result.status === "succeeded" || result.status === "failed") &&
    (typeof result.error === "string" || result.error === null) &&
    Boolean(project) &&
    typeof project === "object" &&
    Array.isArray((project as RemoteCanvasProject).nodes) &&
    Array.isArray((project as RemoteCanvasProject).tasks);

  return valid ? (result as CodexWorkerStartResult) : null;
};

export async function exportImageToPath(input: {
  nodeId: string;
  imageUrl: string;
  filePath: string;
}): Promise<{ ok: true; filePath: string } | { ok: false; error: string }> {
  try {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const result = (await response.json()) as
      | { ok: true; filePath: string }
      | { ok: false; error?: string };

    if (!response.ok || !result.ok) {
      return {
        ok: false,
        error: !result.ok && result.error ? result.error : "导出失败。"
      };
    }

    return result;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "导出失败。"
    };
  }
}

export function buildCodexPrompt(input: {
  taskId: string;
  type: CanvasGenerationTaskType;
  sourceNodes: ImageProjectNode[];
  instruction: string;
  referenceImages?: CanvasReferenceImage[];
  regions?: CanvasGenerationTask["regions"];
  selectionSemantics?: CanvasSelectionSemantics;
  contextPaddingPercent?: number;
}) {
  const selectionSemantics =
    input.selectionSemantics ?? inferSelectionSemantics(input.instruction, input.type);
  const hasRegions = Boolean(input.regions?.length);
  const imageLines = input.sourceNodes
    .map(
      (node, index) =>
        `${index + 1}. id=${node.id}; name=${node.name}; kind=${node.kind}; summary=${node.summary || "(none)"}`
    )
    .join("\n");
  const regionLines =
    input.regions?.map((region) => `- ${region.label}: ${region.instruction}`).join("\n") ??
    "";
  const regionGeometryLines =
    input.regions
      ?.map((region) => `- ${describeRegionGeometry(region)}`)
      .join("\n") ??
    "";
  const referenceLines =
    input.referenceImages
      ?.map((reference, index) => `${index + 1}. name=${reference.name}`)
      .join("\n") ?? "";

  return [
    `Pedit task ${input.taskId}`,
    `Type: ${input.type}`,
    `Selection semantics: ${selectionSemantics}`,
    hasRegions && selectionSemantics === "strict_local"
      ? "After claiming the task, first call pedit_run_local_fast_path for supported strict-local selected-region color edits. If it returns ok=true, the result is already written. If it returns unsupported, continue with Codex image2."
      : "",
    !hasRegions
      ? "No user region was selected. Treat this as a whole-image edit instruction, not a mask-limited operation. Do not create a synthetic selection or hand-built local mask as the primary workflow; use the image edit model on the full source image and let the model understand the requested subject from the prompt."
      : "",
    "Before generating, reason about the source image contents and the user's intent. Prefer a coherent, aesthetic image editing plan that preserves the source image's identity, composition, camera perspective, resolution, sharpness, lighting, texture, and photographic style.",
    "This is an edit request, not a full redraw. Make the smallest sufficient change that satisfies the user. Do not stylize, beautify, repaint, smooth fur/skin/fabric, change background, alter pose, change camera angle, crop, upscale/downscale, or modify unrelated details.",
    "If the intent is underspecified, ask the user to clarify and offer 2-3 viable directions.",
    "Source images:",
    imageLines,
    "Source image binary data is intentionally not embedded in this prompt. Use the task sourceNodeIds, canvas state, pedit_export_current_image, or /api/export to obtain local image files when needed.",
    referenceLines ? "Reference images:" : "",
    referenceLines,
    referenceLines
      ? "Reference image binary data is intentionally not embedded in this prompt. Use task.referenceImages[].imageUrl from the claimed task; runtime asset URLs can be read from the Pedit runtime assets directory or fetched from the running canvas server."
      : "",
    regionGeometryLines ? "Precision region geometry:" : "",
    regionGeometryLines ? regionSemanticsInstruction(selectionSemantics, input.contextPaddingPercent) : "",
    regionGeometryLines,
    regionGeometryLines ? "Mask assets:" : "",
    regionGeometryLines
      ? maskAssetsInstruction(selectionSemantics)
      : "",
    regionGeometryLines
      ? maskFallbackInstruction(selectionSemantics)
      : "",
    regionLines ? "Region instructions:" : "",
    regionLines,
    "Overall instruction:",
    input.instruction,
    "Quality gate before writing the result: compare against the edit target. Reject/regenerate instead of writing if the output is blurrier, more painterly, lower fidelity, heavily compressed, differently cropped, differently lit, semantically incoherent, or visually disconnected from the whole image.",
    "When done, write the result back to Pedit with pedit_write_generation_result or POST /api/results.",
    "Required result fields: taskId, imageUrl, name, summary, edgeLabel."
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildManualHandoffPrompt(input: {
  taskId: string;
  type: CanvasGenerationTaskType;
  instruction: string;
  projectName?: string;
  currentVersionId?: string;
  sourceNodes?: ImageProjectNode[];
  selectionSemantics?: CanvasSelectionSemantics;
  hasRegions?: boolean;
  regions?: CanvasGenerationTask["regions"];
  referenceImages?: CanvasReferenceImage[];
  referenceCount?: number;
}) {
  const selectionSemantics =
    input.selectionSemantics ?? inferSelectionSemantics(input.instruction, input.type);
  const hasRegions = Boolean(input.hasRegions);
  const referenceImages = input.referenceImages ?? [];
  const referenceCount = input.referenceCount ?? referenceImages.length;
  const sourceNodes = input.sourceNodes ?? [];
  const currentVersionId =
    input.currentVersionId ??
    (sourceNodes.length === 1
      ? sourceNodes[0].id
      : sourceNodes.length > 1
        ? sourceNodes.map((node) => node.id).join(", ")
        : "(claim task to resolve)");
  const regionLines =
    input.regions?.map(
      (region, index) =>
        `${index + 1}. id=${region.id}; label=${region.label}; ${describeRegionGeometry(region)}; instruction=${region.instruction || "(empty)"}; mask=${region.maskPath || region.maskUrl || region.maskStatus || "not_ready"}`
    ) ?? [];
  const sourceLines = sourceNodes.length
    ? sourceNodes.map(
        (node, index) =>
          `${index + 1}. id=${node.id}; name=${node.name}; kind=${node.kind}; image_ref=${handoffImageReference(node.imageUrl)}`
      )
    : [
        "1. sourceNodeIds are stored on the claimed task. Use pedit_get_canvas_state, pedit_claim_next_task, or pedit_export_current_image to resolve the active image."
      ];
  const referenceLines = referenceImages.length
    ? referenceImages.map(
        (reference, index) =>
          `${index + 1}. name=${reference.name}; image_ref=${handoffImageReference(reference.imageUrl)}; read task.referenceImages[${index}].imageUrl for the actual binary.`
      )
    : ["无参考图。"];
  const preserveRequirements = [
    "保留源图主体身份、构图、相机视角、分辨率、清晰度、光照、材质和照片风格。",
    selectionPreserveRequirement(selectionSemantics, hasRegions),
    referenceCount > 0
      ? "参考图只用于用户要求的维度；不要因为参考图改变无关主体、构图或背景。"
      : ""
  ].filter(Boolean);
  const outputRequirements = [
    "这是图片编辑任务，不是整张重绘；做满足用户目标的最小充分修改。",
    input.type === "region_edit"
      ? "局部/整图编辑结果应保持与源图一致的画布尺寸；不要裁剪、拉伸、降采样或额外加边框。"
      : "多图合成结果应自然、统一、无明显拼贴感，并保留任务要求的主体关系。",
    "image2 原始输出只能作为中间预览；如果你进行了放大、融合、裁剪、后处理或质量修复，必须把最终候选图重新展示/验收。",
    "最终写回 Pedit 的图片必须是你最终展示和验收的同一张图片，不要让 Codex 中的预览图和 Pedit 结果不一致。",
    "写回前请自检画质、尺寸、主体一致性、选区准确性和整体和谐度；不合格不要写入版本树。"
  ];
  const writebackRequirements = [
    "先调用 pedit_get_canvas_state，再调用 pedit_claim_next_task，确认 claimed task.id 与下方 task_id 一致。",
    hasRegions && selectionSemantics === "strict_local"
      ? "strict_local 局部改色任务请先调用 pedit_run_local_fast_path；如果 ok=true，结果已写回，无需再调用 image2。"
      : "无选区或非 strict_local 任务不要先走局部 fast path；请直接按 sourceNodeIds 和 codexPrompt 使用整图 image2 编辑流程。",
    hasRegions
      ? "如果 fast path unsupported，或任务不是可支持的局部改色，再按 sourceNodeIds、regions、maskPath/maskUrl、codexPrompt 调用 Codex image2 完成修图。"
      : "如果用户没有圈选区域，regions/maskPath/maskUrl 为空是正常情况；请不要因此退化成手工选区流程。",
    "完成后调用 pedit_write_generation_result 写回结果；必填字段：taskId、imageUrl、name、summary、edgeLabel。",
    "如果缺少 task_id、找不到源图、图片保存失败或结果不合格，请写入 failed/error，不要创建结果版本节点。"
  ];

  return [
    "Pedit Codex Handoff",
    "",
    "## 1. 任务索引",
    `task_id: ${input.taskId}`,
    `taskId=${input.taskId}`,
    `project_name: ${input.projectName || "未命名项目"}`,
    `current_version_id: ${currentVersionId}`,
    `task_type: ${input.type}`,
    `type=${input.type}`,
    `executor_type: codex_handoff`,
    `selection_semantics: ${selectionSemantics}`,
    `selectionSemantics=${selectionSemantics}`,
    `has_regions: ${hasRegions ? "true" : "false"}`,
    `hasRegions=${hasRegions ? "true" : "false"}`,
    `reference_count: ${referenceCount}`,
    `referenceCount=${referenceCount}`,
    "",
    "## 2. 当前图片",
    sourceLines.join("\n"),
    "source image binary data is not embedded in this handoff. Resolve it from the claimed task or export endpoint.",
    "",
    "## 3. 用户原始指令",
    input.instruction,
    "",
    "## 4. 选区信息",
    handoffSelectionSemanticsInstruction(selectionSemantics),
    hasRegions
      ? regionLines.join("\n")
      : "本任务没有用户圈选区域：请按整图修图流程处理，不要把局部圈选当成限制，也不要为了处理而手工造 mask/选区。",
    "",
    "## 5. 参考图信息",
    referenceLines.join("\n"),
    referenceCount > 0
      ? "本任务包含参考图：请在 claim 后读取 task.referenceImages[].imageUrl，不要只根据参考图文件名猜测内容。"
      : "无参考图时，不要臆造参考风格或参考主体。",
    "",
    "## 6. 需要保留的内容",
    preserveRequirements.map((item) => `- ${item}`).join("\n"),
    "",
    "## 7. 输出要求",
    outputRequirements.map((item) => `- ${item}`).join("\n"),
    "",
    "## 8. 结果回写要求",
    writebackRequirements.map((item) => `- ${item}`).join("\n"),
    "",
    "## 9. 异常处理",
    "- Handoff 内容不完整时，先通过 pedit_get_canvas_state/claimed task 补齐上下文；仍无法补齐则标记任务失败并说明原因。",
    "- 结果没有 task_id、task_id 不匹配、图片不可读、尺寸/质量不合格时，不要写入版本树。",
    !hasRegions
      ? "本任务没有用户圈选区域：请按整图修图流程处理，不要把局部圈选当成限制，也不要为了处理而手工造 mask/选区。"
      : "",
  ].filter(Boolean).join("\n");
}

const handoffImageReference = (imageUrl: string) => {
  if (!imageUrl) {
    return "(missing)";
  }

  if (imageUrl.startsWith("data:")) {
    return "(data URL stored in Pedit task; omitted from handoff)";
  }

  return imageUrl;
};

const selectionPreserveRequirement = (
  selectionSemantics: CanvasSelectionSemantics,
  hasRegions: boolean
) => {
  if (!hasRegions || selectionSemantics === "global_edit") {
    return "没有硬性局部选区时，按整图编辑理解用户意图，但仍保留无关细节。";
  }

  if (selectionSemantics === "strict_local") {
    return "选区外内容必须尽量保持完全不变；仅修改用户指定目标像素。";
  }

  if (selectionSemantics === "contextual_inpaint") {
    return "选区是问题锚点，允许为自然修复调整窄范围过渡区，但不能破坏无关主体和整体构图。";
  }

  return "选区是主要目标，可做少量周边融合以获得自然结果，但无关区域应保持稳定。";
};

const maskAssetsInstruction = (selectionSemantics: CanvasSelectionSemantics) => {
  if (selectionSemantics === "strict_local") {
    return "When a region includes task.regions[].maskPath or task.regions[].maskUrl, it is an RGBA PNG mask for the first source image: fully transparent pixels are the editable area and opaque pixels must be preserved. Prefer the mask for image-edit APIs that support masks; use polygon/bbox as the audit fallback.";
  }

  if (selectionSemantics === "contextual_inpaint") {
    return "When a region includes task.regions[].maskPath or task.regions[].maskUrl, it is an RGBA PNG mask for the first source image. For contextual inpaint tasks, use the mask as the primary problem area and use polygon/bbox plus surrounding image context as the audit fallback; outside pixels are preservation targets, not an absolute hard boundary, so a narrow transition area may be adjusted when required to remove seams and keep texture, lighting, shadows, and physical structure coherent.";
  }

  if (selectionSemantics === "global_edit") {
    return "When a region includes task.regions[].maskPath or task.regions[].maskUrl, it is an RGBA PNG attention mask for the first source image. Use it to locate the user's focus while preserving identity, composition, resolution, and unrelated details across the whole image.";
  }

  return "When a region includes task.regions[].maskPath or task.regions[].maskUrl, it is an RGBA PNG mask for the first source image. Use the selected area as the main target and allow only subtle nearby blending when required for a natural photographic result.";
};

const handoffSelectionSemanticsInstruction = (selectionSemantics: CanvasSelectionSemantics) => {
  if (selectionSemantics === "strict_local") {
    return "strict_local 表示选区是高精度硬边界，只改目标像素，尽量保持选区外完全不变。";
  }

  if (selectionSemantics === "contextual_inpaint") {
    return "contextual_inpaint 表示选区是问题锚点，不是硬边界；移除/补全类任务必须利用周边上下文做自然过渡，并以整图和谐度为验收标准。";
  }

  if (selectionSemantics === "global_edit") {
    return "global_edit 表示选区只是注意力锚点，允许为满足用户目标进行必要的整图一致性调整。";
  }

  return "soft_local 表示选区是主要目标，可在必要时做少量周边融合以获得自然结果。";
};

const regionSemanticsInstruction = (
  selectionSemantics: CanvasSelectionSemantics,
  contextPaddingPercent = 18
) => {
  if (selectionSemantics === "strict_local") {
    return "Coordinates are percentages of the full source image, measured from the top-left corner. Strict local edit: only edit the selected target pixels and preserve surrounding pixels. Use this for color/brightness/detail edits where hard locality protects fidelity.";
  }

  if (selectionSemantics === "contextual_inpaint") {
    return `Coordinates are percentages of the full source image, measured from the top-left corner. The selected region marks the primary object/problem area, not a hard final pixel boundary. Use the surrounding context area to reconstruct a coherent final image. You may adjust a narrow surrounding transition area of about ${contextPaddingPercent}% of the target bounds when needed for natural blending, lighting, shadows, texture direction, and physical logic. Reject visible seams, pasted texture, broken shadows, illogical reconstruction, heavy compression, blur, or low-fidelity output.`;
  }

  if (selectionSemantics === "global_edit") {
    return "Coordinates are percentages of the full source image, measured from the top-left corner. The selected region is an attention anchor inside a broader image edit. Preserve identity, composition, camera perspective, resolution, and unrelated details while allowing coherent whole-image adjustments required by the user's request.";
  }

  return "Coordinates are percentages of the full source image, measured from the top-left corner. Treat the selected region as the main target and allow only subtle nearby blending if it is necessary for a natural photographic result.";
};

const maskFallbackInstruction = (selectionSemantics: CanvasSelectionSemantics) => {
  if (selectionSemantics === "strict_local") {
    return "If maskStatus is skipped_too_large or skipped_unsupported_source, do not treat that as a failed task. Continue with polygon/bounds and preserve everything outside the target region as strictly as the active image tool allows.";
  }

  return "If maskStatus is skipped_too_large or skipped_unsupported_source, do not treat that as a failed task. Continue with polygon/bounds, using the selection as the target anchor and preserving everything outside the contextual edit area.";
};

const roundPercent = (value: number) => Math.round(value * 100) / 100;
