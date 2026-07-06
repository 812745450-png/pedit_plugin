import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runtimeDirPath } from "./runtimeAssets.js";

export type RuntimeBridgeMode = "mcp";
export type RuntimeBridgeStatusValue = "active" | "unavailable";
export type RuntimeHandoffChannel =
  | "manual_handoff"
  | "annotation_handoff"
  | "mcp_queue"
  | "codex_exec";

export interface RuntimeBridgeStatus {
  ok: true;
  mode: RuntimeBridgeMode;
  status: RuntimeBridgeStatusValue;
  automationId: string;
  workerName: string;
  maxClaimDelayMs: number;
  concurrency: number;
  canSpawnNativeWorker: boolean;
  nativeToolExposure: "observed" | "not_observed_in_current_thread";
  handoffMode: "manual_handoff";
  lastHandoffRequestAt: string | null;
  lastHandoffTaskId: string | null;
  lastHandoffChannel: RuntimeHandoffChannel | null;
  lastWakeRequestAt: string | null;
  lastWakeTaskId: string | null;
  lastMcpToolCallAt: string | null;
  lastMcpToolName: string | null;
  message: string;
  setupInstructions: string;
}

interface RuntimeBridgeState {
  lastHandoffRequestAt: string | null;
  lastHandoffTaskId: string | null;
  lastHandoffChannel: RuntimeHandoffChannel | null;
  lastWakeRequestAt: string | null;
  lastWakeTaskId: string | null;
  lastMcpToolCallAt: string | null;
  lastMcpToolName: string | null;
}

const bridgeStatePath = () => resolve(runtimeDirPath(), "bridge-state.json");

export const readRuntimeBridgeStatus = (): RuntimeBridgeStatus => {
  const state = readBridgeState();
  const status = state.lastMcpToolCallAt ? "active" : "unavailable";
  const maxClaimDelayMs = numberFromEnv(process.env.PEDIT_MCP_EXPECTED_CLAIM_DELAY_MS, 60_000);

  return {
    ok: true,
    mode: "mcp",
    status,
    automationId: "pedit-mcp",
    workerName: "Codex MCP Bridge",
    maxClaimDelayMs,
    concurrency: numberFromEnv(process.env.PEDIT_CODEX_WORKER_CONCURRENCY, 1),
    canSpawnNativeWorker: false,
    nativeToolExposure:
      status === "active" ? "observed" : "not_observed_in_current_thread",
    handoffMode: "manual_handoff",
    lastHandoffRequestAt: state.lastHandoffRequestAt,
    lastHandoffTaskId: state.lastHandoffTaskId,
    lastHandoffChannel: state.lastHandoffChannel,
    lastWakeRequestAt: state.lastWakeRequestAt,
    lastWakeTaskId: state.lastWakeTaskId,
    lastMcpToolCallAt: state.lastMcpToolCallAt,
    lastMcpToolName: state.lastMcpToolName,
    message:
      status === "active"
        ? `Codex MCP Bridge is connected. Codex can claim pending Pedit tasks through MCP tools.`
        : "当前未连接 Codex Bridge：Pedit MCP Server 可用，但当前 Codex 线程尚未暴露原生 pedit_* 工具。若 tool_search 搜不到 pedit_get_canvas_state，请新开 Codex 线程或重启 Codex；当前线程仍可用复制交接指令 + CLI fallback 完成任务。",
    setupInstructions:
      "请确认 Pedit 插件已启用，并在新 Codex 线程中检查是否暴露 pedit_get_canvas_state、pedit_claim_next_task、pedit_run_local_fast_path、pedit_export_current_image、pedit_write_generation_result。若当前线程未暴露这些原生工具，请新开线程或重启 Codex；在此之前可复制交接指令，由 Codex 使用 Pedit CLI fallback 处理任务。"
  };
};

export const recordRuntimeBridgeTaskRequest = (
  taskId: string | null,
  channel: RuntimeHandoffChannel = "manual_handoff"
) => {
  const requestedAt = new Date().toISOString();
  writeBridgeState({
    ...readBridgeState(),
    lastHandoffRequestAt: requestedAt,
    lastHandoffTaskId: taskId,
    lastHandoffChannel: channel,
    lastWakeRequestAt: requestedAt,
    lastWakeTaskId: taskId
  });
  return readRuntimeBridgeStatus();
};

export const recordRuntimeMcpToolCall = (toolName: string) => {
  writeBridgeState({
    ...readBridgeState(),
    lastMcpToolCallAt: new Date().toISOString(),
    lastMcpToolName: toolName
  });
};

const readBridgeState = (): RuntimeBridgeState => {
  const filePath = bridgeStatePath();

  if (!existsSync(filePath)) {
    return {
      lastHandoffRequestAt: null,
      lastHandoffTaskId: null,
      lastHandoffChannel: null,
      lastWakeRequestAt: null,
      lastWakeTaskId: null,
      lastMcpToolCallAt: null,
      lastMcpToolName: null
    };
  }

  try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<RuntimeBridgeState>;
    return {
      lastHandoffRequestAt: parsed.lastHandoffRequestAt ?? null,
      lastHandoffTaskId: parsed.lastHandoffTaskId ?? null,
      lastHandoffChannel: normalizeHandoffChannel(parsed.lastHandoffChannel),
      lastWakeRequestAt: parsed.lastWakeRequestAt ?? null,
      lastWakeTaskId: parsed.lastWakeTaskId ?? null,
      lastMcpToolCallAt: parsed.lastMcpToolCallAt ?? null,
      lastMcpToolName: parsed.lastMcpToolName ?? null
    };
  } catch {
    return {
      lastHandoffRequestAt: null,
      lastHandoffTaskId: null,
      lastHandoffChannel: null,
      lastWakeRequestAt: null,
      lastWakeTaskId: null,
      lastMcpToolCallAt: null,
      lastMcpToolName: null
    };
  }
};

export const isHandoffChannel = (value: unknown): value is RuntimeHandoffChannel =>
  value === "manual_handoff" ||
  value === "annotation_handoff" ||
  value === "mcp_queue" ||
  value === "codex_exec";

const normalizeHandoffChannel = (value: unknown): RuntimeHandoffChannel | null => {
  if (value === "annotation_handoff") {
    return "manual_handoff";
  }

  return isHandoffChannel(value) ? value : null;
};

const writeBridgeState = (state: RuntimeBridgeState) => {
  const filePath = bridgeStatePath();
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
};

const numberFromEnv = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
