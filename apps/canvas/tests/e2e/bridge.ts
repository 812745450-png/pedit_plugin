import type { Page } from "@playwright/test";

interface BridgeTask {
  id: string;
  type: "region_edit" | "multi_node_merge" | "text_to_image";
  status: "pending" | "running" | "succeeded" | "failed";
  sourceNodeIds: string[];
  instruction: string;
  codexPrompt: string;
  resultNodeId?: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BridgeNode {
  id: string;
  name: string;
  kind: "source" | "edit" | "composite" | "text";
  imageUrl: string;
  parentIds: string[];
  hidden: boolean;
  deleted: boolean;
  position: { x: number; y: number };
  summary: string;
  edgeLabel?: string;
  createdByTaskId?: string;
  createdAt: string;
}

export interface BridgeState {
  mode: "big_image_view" | "big_image_edit" | "version";
  currentNodeId: string | null;
  selectedNodeIds: string[];
  showHiddenNodes: boolean;
  nodes: BridgeNode[];
  tasks: BridgeTask[];
}

export function createBridgeState(): BridgeState {
  return {
    mode: "big_image_view",
    currentNodeId: null,
    selectedNodeIds: [],
    showHiddenNodes: false,
    nodes: [
      {
        id: "person-source",
        name: "Portrait source",
        kind: "source",
        imageUrl: "/samples/person.jpg",
        parentIds: [],
        hidden: false,
        deleted: false,
        position: { x: 40, y: 160 },
        summary: "Actual portrait source image.",
        createdAt: "2026-06-30T00:00:00.000+08:00"
      },
      {
        id: "cat-source",
        name: "Cat source",
        kind: "source",
        imageUrl: "/samples/cat.jpg",
        parentIds: [],
        hidden: false,
        deleted: false,
        position: { x: 40, y: 360 },
        summary: "Actual cat source image.",
        createdAt: "2026-06-30T00:00:00.000+08:00"
      }
    ],
    tasks: []
  };
}

export async function setupBridgeApi(page: Page, state = createBridgeState()) {
  const bridgeStatus = {
    ok: true,
    mode: "mcp",
    status: "active",
    automationId: "pedit-mcp",
    workerName: "Codex MCP Bridge",
    maxClaimDelayMs: 60_000,
    concurrency: 1,
    canSpawnNativeWorker: false,
    handoffMode: "manual_handoff",
    lastHandoffRequestAt: null as string | null,
    lastHandoffTaskId: null as string | null,
    lastHandoffChannel: null as string | null,
    lastWakeRequestAt: null as string | null,
    lastWakeTaskId: null as string | null,
    lastMcpToolCallAt: "2026-07-01T11:59:00.000Z",
    lastMcpToolName: "pedit_get_canvas_state",
    message: "Codex MCP Bridge is connected.",
    setupInstructions: "Enable the Pedit MCP server in Codex."
  };

  await page.route("**/api/bridge/status", async (route) => {
    await route.fulfill({ json: bridgeStatus });
  });

  await page.route("**/api/bridge/request", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      taskId?: string;
    };
    const now = new Date().toISOString();
    bridgeStatus.lastHandoffRequestAt = now;
    bridgeStatus.lastHandoffTaskId = body.taskId ?? null;
    bridgeStatus.lastHandoffChannel = "manual_handoff";
    bridgeStatus.lastWakeRequestAt = now;
    bridgeStatus.lastWakeTaskId = body.taskId ?? null;
    await route.fulfill({ json: bridgeStatus });
  });

  await page.route("**/api/project", async (route) => {
    if (route.request().method() === "PUT") {
      Object.assign(state, JSON.parse(route.request().postData() ?? "{}"));
    }
    await route.fulfill({ json: state });
  });

  await page.route("**/api/tasks", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      task: BridgeTask;
    };
    state.tasks = [
      ...state.tasks.filter((task) => task.id !== body.task.id),
      body.task
    ];
    await route.fulfill({ json: state });
  });

  await page.route("**/api/results", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      taskId: string;
      resultNodeId: string;
      name: string;
      imageUrl: string;
      summary: string;
      edgeLabel: string;
    };
    const task = state.tasks.find((candidate) => candidate.id === body.taskId);

    if (!task) {
      await route.fulfill({ status: 404, json: { error: "Task not found" } });
      return;
    }

    const sourceNodes = task.sourceNodeIds
      .map((nodeId) => state.nodes.find((node) => node.id === nodeId))
      .filter((node): node is BridgeNode => Boolean(node));
    const kind = task.type === "multi_node_merge" ? "composite" : "edit";
    const resultNode: BridgeNode = {
      id: body.resultNodeId,
      name: body.name,
      kind,
      imageUrl: body.imageUrl,
      parentIds: task.sourceNodeIds,
      hidden: false,
      deleted: false,
      position: {
        x: Math.max(...sourceNodes.map((node) => node.position.x), 40) + 300,
        y:
          sourceNodes.reduce((sum, node) => sum + node.position.y, 0) /
            Math.max(sourceNodes.length, 1) || 160
      },
      summary: body.summary,
      edgeLabel: body.edgeLabel,
      createdByTaskId: task.id,
      createdAt: new Date().toISOString()
    };

    state.nodes = [...state.nodes, resultNode];
    state.tasks = state.tasks.map((candidate) =>
      candidate.id === task.id
        ? {
            ...candidate,
            status: "succeeded",
            resultNodeId: resultNode.id,
            updatedAt: new Date().toISOString()
          }
        : candidate
    );
    state.mode = "big_image_view";
    state.currentNodeId = resultNode.id;
    state.selectedNodeIds = [resultNode.id];

    await route.fulfill({ json: state });
  });

  return state;
}

export async function writeCodexResult(
  page: Page,
  taskId: string,
  resultNodeId: string,
  name: string,
  edgeLabel: string
) {
  await page.evaluate(
    async (input) => {
      await fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
    },
    {
      taskId,
      resultNodeId,
      name,
      imageUrl: createResultImage(name),
      summary: `${name} was produced by the Codex bridge worker.`,
      edgeLabel
    }
  );
}

function createResultImage(label: string) {
  const safeLabel = label.replace(/[<&>"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1525" viewBox="0 0 1280 1525"><rect width="1280" height="1525" fill="#d7ded6"/><image href="/samples/person.jpg" x="0" y="0" width="1280" height="1525" preserveAspectRatio="xMidYMid slice"/><rect x="88" y="1060" width="410" height="320" rx="24" fill="white" opacity=".86"/><image href="/samples/cat.jpg" x="108" y="1080" width="370" height="280" preserveAspectRatio="xMidYMid slice"/><rect width="1280" height="1525" fill="#315c50" opacity=".12"/><text x="88" y="116" font-family="Arial" font-size="48" font-weight="700" fill="#fff">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
