// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { LassoCanvas } from "../src/components/LassoCanvas";
import {
  BigImageEdit,
  createLassoRegion
} from "../src/modes/BigImageEdit";
import { createSampleProjectSnapshot } from "../src/state/imageProject";
import type {
  CodexBridgeStatus,
  RemoteCanvasProject
} from "../src/state/peditClient";

const pointerBox = {
  left: 0,
  top: 0,
  width: 1000,
  height: 625,
  right: 1000,
  bottom: 625,
  x: 0,
  y: 0,
  toJSON: () => undefined
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockSvgLayout() {
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue(
    pointerBox
  );
  SVGElement.prototype.setPointerCapture = vi.fn();
  SVGElement.prototype.releasePointerCapture = vi.fn();
}

function mockElementLayout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    pointerBox
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
}

function drawTriangle(target: Element) {
  fireEvent.pointerDown(target, {
    pointerId: 1,
    button: 0,
    clientX: 100,
    clientY: 100
  });
  fireEvent.pointerMove(target, {
    pointerId: 1,
    clientX: 260,
    clientY: 120
  });
  fireEvent.pointerMove(target, {
    pointerId: 1,
    clientX: 200,
    clientY: 280
  });
  fireEvent.pointerUp(target, {
    pointerId: 1,
    clientX: 100,
    clientY: 100
  });
}

const activeBridgeStatus = (
  overrides: Partial<CodexBridgeStatus> = {}
): CodexBridgeStatus => ({
  ok: true,
  mode: "mcp",
  status: "active",
  automationId: "pedit-mcp",
  workerName: "Codex MCP Bridge",
  maxClaimDelayMs: 60_000,
  concurrency: 1,
  canSpawnNativeWorker: false,
  handoffMode: "manual_handoff",
  lastHandoffRequestAt: null,
  lastHandoffTaskId: null,
  lastHandoffChannel: null,
  lastWakeRequestAt: null,
  lastWakeTaskId: null,
  lastMcpToolCallAt: "2026-07-01T11:59:00.000Z",
  lastMcpToolName: "pedit_get_canvas_state",
  message: "Codex MCP Bridge is connected.",
  setupInstructions: "Enable the Pedit MCP server in Codex.",
  ...overrides
});

describe("big image edit interactions", () => {
  async function uploadLocalProject(
    files: File | File[] = new File(["person-bytes"], "person-real.png", {
      type: "image/png"
    })
  ) {
    const input = screen.getByLabelText("选择本地图片") as HTMLInputElement;
    await userEvent.upload(input, Array.isArray(files) ? files : files);
  }

  it("warns when the local Pedit backend is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    render(<App />);

    expect(await screen.findByText("Pedit 后端未连接")).toBeTruthy();
    expect(screen.getByText(/刷新或重启 127.0.0.1:5173/)).toBeTruthy();
  });

  it("starts empty and does not expose a reset action", () => {
    render(<App />);

    expect(screen.getByText("从图片开始编辑。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重置当前项目" })).toBeNull();
    expect(screen.queryByRole("menu", { name: "项目管理" })).toBeNull();
  });

  it("uploads multiple local image files into one image-group root", async () => {
    render(<App />);

    const input = screen.getByLabelText("选择本地图片") as HTMLInputElement;
    const person = new File(["person-bytes"], "person-real.png", {
      type: "image/png"
    });
    const cat = new File(["cat-bytes"], "cat-real.png", {
      type: "image/png"
    });

    await userEvent.upload(input, [person, cat]);

    expect(await screen.findAllByText("图片组 Root")).not.toHaveLength(0);
    expect(screen.getAllByText("person-real.png")).not.toHaveLength(0);
    expect(screen.getAllByText("cat-real.png")).not.toHaveLength(0);
    expect(screen.getByLabelText("图片详情 - 编辑模式")).toBeTruthy();
  });

  it("clears the remote runtime before saving a newly uploaded project", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    let remoteProject: RemoteCanvasProject = {
      mode: "version",
      currentNodeId: "old-result",
      selectedNodeIds: ["old-result"],
      showHiddenNodes: false,
      nodes: [
          {
            id: "old-result",
            name: "旧结果",
            kind: "edit",
          imageUrl: "/old.png",
          parentIds: ["root-image-group"],
          hidden: false,
          deleted: false,
          position: { x: 0, y: 0 },
          summary: "",
          createdAt: "2026-07-01T00:00:00.000Z"
        }
      ],
      tasks: [
        {
          id: "task-old",
          type: "region_edit",
          status: "succeeded",
          sourceNodeIds: ["root-image-group"],
          instruction: "旧任务",
          codexPrompt: "old",
          resultNodeId: "old-result",
          error: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z"
        }
      ]
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        calls.push({ url, method });

        if (url.includes("/api/project") && method === "GET") {
          return Response.json(remoteProject);
        }

        if (url.includes("/api/reset") && method === "POST") {
          remoteProject = {
            mode: "big_image_view",
            currentNodeId: null,
            selectedNodeIds: [],
            showHiddenNodes: false,
            nodes: [],
            tasks: []
          };
          return Response.json(remoteProject);
        }

        if (url.includes("/api/project") && method === "PUT") {
          remoteProject = JSON.parse(String(init?.body));
          return Response.json(remoteProject);
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    expect(await screen.findAllByText("旧结果")).not.toHaveLength(0);
    await userEvent.click(
      screen
        .getAllByRole("button", { name: /旧结果/ })
        .find((button) => button.classList.contains("project-switcher-button")) as HTMLElement
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "重置当前项目" }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "重置当前项目？" })).getByRole(
        "button",
        { name: "重置项目" }
      )
    );
    expect(await screen.findByText("从图片开始编辑。")).toBeTruthy();

    const callCountBeforeUpload = calls.length;
    const input = screen.getByLabelText("选择本地图片") as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(["new-bytes"], "new-project.png", { type: "image/png" })
    );

    expect(await screen.findAllByText("new-project.png")).not.toHaveLength(0);
    await waitFor(() =>
      expect(
        calls.some((call) => call.url.includes("/api/project") && call.method === "PUT")
      ).toBe(true)
    );

    const createProjectIndex = calls.findIndex(
      (call, index) =>
        index >= callCountBeforeUpload &&
        call.url.includes("/api/projects") &&
        call.method === "POST"
    );
    const saveIndex = calls.findIndex(
      (call, index) =>
        index >= callCountBeforeUpload &&
        call.url.includes("/api/project") &&
        call.method === "PUT"
    );
    expect(createProjectIndex).toBeGreaterThan(-1);
    expect(saveIndex).toBeGreaterThan(createProjectIndex);
    expect(String((vi.mocked(fetch).mock.calls[saveIndex][1] as RequestInit).body)).toContain(
      "new-project.png"
    );
  });

  it("manages the active project from the topbar menu", async () => {
    render(<App />);

    const input = screen.getByLabelText("选择本地图片") as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(["person-bytes"], "person-real.png", { type: "image/png" })
    );

    const projectButton = () =>
      screen
        .getAllByRole("button", { name: /person-real.png|封面项目/ })
        .find((button) => button.classList.contains("project-switcher-button"));
    await waitFor(() => expect(projectButton()).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Pedit 项目菜单" }));
    expect(screen.getByRole("menu", { name: "Pedit 项目菜单" })).toBeTruthy();

    const newProjectInput = screen.getByLabelText("选择新项目图片") as HTMLInputElement;
    const clickSpy = vi.spyOn(newProjectInput, "click");
    await userEvent.click(screen.getByRole("menuitem", { name: "从本地图片新建" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    await userEvent.click(projectButton() as HTMLElement);
    expect(screen.getByRole("menu", { name: "项目管理" })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名项目" }));
    const renameDialog = screen.getByRole("dialog", { name: "重命名项目" });
    const nameInput = within(renameDialog).getByLabelText("项目名称");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "封面项目");
    await userEvent.click(within(renameDialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(projectButton()).toBeTruthy());

    await userEvent.click(projectButton() as HTMLElement);
    await userEvent.click(screen.getByRole("menuitem", { name: "重置当前项目" }));
    const dialog = screen.getByRole("dialog", { name: "重置当前项目？" });
    expect(within(dialog).getByText(/清空当前项目的版本树/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "重置项目" }));

    expect(await screen.findByText("从图片开始编辑。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /封面项目/ })).toBeNull();
  });

  it("opens the system picker and uploads selected reference images", async () => {
    render(<App />);

    await uploadLocalProject();
    const referenceInput = screen.getByLabelText("选择参考图片") as HTMLInputElement;
    const clickSpy = vi.spyOn(referenceInput, "click");

    await userEvent.click(screen.getByRole("button", { name: "上传参考图" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    await userEvent.upload(
      referenceInput,
      new File(["reference-bytes"], "style-reference.png", { type: "image/png" })
    );

    expect(await screen.findByText("style-reference.png")).toBeTruthy();
    expect(await screen.findByText("已上传 1 张参考图。")).toBeTruthy();
  });

  it("submits uploaded reference images with the generation task", async () => {
    const createdTasks: Array<{
      task: {
        referenceImages?: Array<{ name: string; imageUrl: string }>;
        handoffPrompt: string;
        codexPrompt: string;
      };
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/project") && !init?.method) {
          return Response.json(null);
        }

        if (url.includes("/api/tasks") && init?.method === "POST") {
          createdTasks.push(JSON.parse(String(init.body)));
          return Response.json(null);
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    const sourceInput = screen.getByLabelText("选择本地图片") as HTMLInputElement;
    await userEvent.upload(
      sourceInput,
      new File(["person-bytes"], "person-real.png", { type: "image/png" })
    );
    const referenceInput = screen.getByLabelText("选择参考图片") as HTMLInputElement;
    await userEvent.upload(
      referenceInput,
      new File(["reference-bytes"], "style-reference.png", { type: "image/png" })
    );
    await userEvent.type(
      await screen.findByPlaceholderText("例如：把背景处理得更干净，保留人物主体。"),
      "把背景换成参考图中的背景"
    );
    await userEvent.click(screen.getByRole("button", { name: "开始优化" }));

    await waitFor(() => expect(createdTasks).toHaveLength(1));
    expect(createdTasks[0].task.referenceImages).toHaveLength(1);
    expect(createdTasks[0].task.referenceImages?.[0]).toMatchObject({
      name: "style-reference.png"
    });
    expect(createdTasks[0].task.referenceImages?.[0].imageUrl).toMatch(
      /^data:image\/png;base64,/
    );
    expect(createdTasks[0].task.handoffPrompt).toContain("referenceCount=1");
    expect(createdTasks[0].task.codexPrompt).toContain(
      "task.referenceImages[].imageUrl"
    );
  });

  it("submits image-group root generation as a multi-node merge task", async () => {
    const createdTasks: Array<{ task: { type: string; sourceNodeIds: string[] } }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/project") && !init?.method) {
          return Response.json(null);
        }

        if (url.includes("/api/tasks") && init?.method === "POST") {
          createdTasks.push(JSON.parse(String(init.body)));
          return Response.json(null);
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    await uploadLocalProject([
      new File(["person-bytes"], "person-real.png", { type: "image/png" }),
      new File(["cat-bytes"], "cat-real.png", { type: "image/png" })
    ]);
    await userEvent.type(
      screen.getByPlaceholderText("例如：让人物抱着小猫坐在沙发上看电视，画面自然真实。"),
      "让人物自然抱着小猫"
    );
    await userEvent.click(screen.getByRole("button", { name: "开始优化" }));

    await waitFor(() => expect(createdTasks).toHaveLength(1));
    expect(createdTasks[0].task.type).toBe("multi_node_merge");
    expect(createdTasks[0].task.sourceNodeIds).toEqual(["root-image-group"]);
  });

  it("submits no-region image edits as whole-image tasks", async () => {
    const createdTasks: Array<{
      task: {
        type: string;
        sourceNodeIds: string[];
        regions?: unknown[];
        selectionSemantics?: string;
        handoffPrompt: string;
        codexPrompt: string;
      };
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/project") && !init?.method) {
          return Response.json(null);
        }

        if (url.includes("/api/tasks") && init?.method === "POST") {
          createdTasks.push(JSON.parse(String(init.body)));
          return Response.json(null);
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    const input = screen.getByLabelText("选择本地图片") as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(["person-bytes"], "person-real.png", { type: "image/png" })
    );
    await userEvent.type(
      await screen.findByPlaceholderText("例如：把背景处理得更干净，保留人物主体。"),
      "把人物的头发换成黑色"
    );
    await userEvent.click(screen.getByRole("button", { name: "开始优化" }));

    await waitFor(() => expect(createdTasks).toHaveLength(1));
    expect(createdTasks[0].task.type).toBe("region_edit");
    expect(createdTasks[0].task.sourceNodeIds).toEqual(["root-image-group"]);
    expect(createdTasks[0].task.regions).toBeUndefined();
    expect(createdTasks[0].task.selectionSemantics).toBe("global_edit");
    expect(createdTasks[0].task.handoffPrompt).toContain("hasRegions=false");
    expect(createdTasks[0].task.handoffPrompt).toContain("本任务没有用户圈选区域");
    expect(createdTasks[0].task.handoffPrompt).not.toContain("请先调用 pedit_run_local_fast_path");
    expect(createdTasks[0].task.codexPrompt).toContain("No user region was selected");
  });

  it("keeps a visible processing status after submitting a generation task", async () => {
    const snapshot = createSampleProjectSnapshot();
    const bridgeRequests: Array<{ taskId: string; channel: string }> = [];
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/bridge/status") && !init?.method) {
          return Response.json(activeBridgeStatus());
        }

        if (url.includes("/api/bridge/request") && init?.method === "POST") {
          const { taskId, channel } = JSON.parse(String(init.body));
          bridgeRequests.push({ taskId, channel });
          return Response.json(
            activeBridgeStatus({
              lastHandoffRequestAt: "2026-07-01T12:00:00.000Z",
              lastHandoffTaskId: taskId,
              lastHandoffChannel: channel,
              lastWakeRequestAt: "2026-07-01T12:00:00.000Z",
              lastWakeTaskId: taskId
            })
          );
        }

        if (url.includes("/api/project") && !init?.method) {
          return Response.json(null);
        }

        if (url.includes("/api/tasks") && init?.method === "POST") {
          const { task } = JSON.parse(String(init.body));

          return Response.json({
            mode: "big_image_edit",
            currentNodeId: "root-image-group",
            selectedNodeIds: ["root-image-group"],
            showHiddenNodes: false,
            nodes: snapshot.nodes,
            tasks: [task]
          });
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    await uploadLocalProject([
      new File(["person-bytes"], "person-real.png", { type: "image/png" }),
      new File(["cat-bytes"], "cat-real.png", { type: "image/png" })
    ]);
    await userEvent.type(
      screen.getByPlaceholderText("例如：让人物抱着小猫坐在沙发上看电视，画面自然真实。"),
      "让人物自然抱着小猫"
    );
    await userEvent.click(screen.getByRole("button", { name: "开始优化" }));

    expect(await screen.findByText("等待你复制并发送给 Codex")).toBeTruthy();
    expect(screen.getByText("把交接指令发送给 Codex")).toBeTruthy();
    expect(screen.getByText("粘贴到 Codex 输入框")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "复制交接指令" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toContain("Pedit Codex Handoff");
    expect(await screen.findByText("交接指令已复制。请切回 Codex 输入框，粘贴并发送。")).toBeTruthy();
    expect(screen.getByText(/Pedit Codex Handoff/)).toBeTruthy();
    expect(screen.queryByText(/Annotation Handoff 已发送/)).toBeNull();
    expect(screen.getByText(/Pedit 会自动监听写回结果/)).toBeTruthy();
    expect(screen.getByText(/pedit-mcp/)).toBeTruthy();
    expect(bridgeRequests).toEqual([
      expect.objectContaining({ channel: "manual_handoff" })
    ]);
    expect(document.querySelector(".panel .processing-status")).not.toBeNull();
    expect(document.querySelector(".app > .processing-status")).toBeNull();
  });

  it("uses manual Codex handoff as the main flow instead of starting Codex Exec", async () => {
    const snapshot = createSampleProjectSnapshot();
    const workerStarts: string[] = [];
    const bridgeRequests: Array<{ taskId: string; channel: string }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/bridge/status") && !init?.method) {
          return Response.json(activeBridgeStatus());
        }

        if (url.includes("/api/project") && !init?.method) {
          return Response.json(null);
        }

        if (url.includes("/api/tasks") && init?.method === "POST") {
          const { task } = JSON.parse(String(init.body));

          expect(task.handoffChannel).toBe("manual_handoff");
          expect(task.handoffPrompt).toContain("Pedit Codex Handoff");
          expect(task.handoffPrompt).toContain(task.id);
          return Response.json({
            mode: "big_image_edit",
            currentNodeId: "root-image-group",
            selectedNodeIds: ["root-image-group"],
            showHiddenNodes: false,
            nodes: snapshot.nodes,
            tasks: [task]
          });
        }

        if (url.includes("/api/codex-worker/start") && init?.method === "POST") {
          const { taskId } = JSON.parse(String(init.body));
          workerStarts.push(taskId);

          return Response.json({
            ok: true,
            taskId,
            status: "running",
            error: null,
            project: {
              mode: "big_image_edit",
              currentNodeId: "root-image-group",
              selectedNodeIds: ["root-image-group"],
              showHiddenNodes: false,
              nodes: snapshot.nodes,
              tasks: [
                {
                  id: taskId,
                  type: "multi_node_merge",
                  status: "running",
                  sourceNodeIds: ["root-image-group"],
                  instruction: "让人物自然抱着小猫",
                  codexPrompt: "prompt",
                  error: null,
                  createdAt: "2026-07-01T12:00:00.000Z",
                  updatedAt: "2026-07-01T12:00:01.000Z"
                }
              ]
            }
          });
        }

        if (url.includes("/api/bridge/request") && init?.method === "POST") {
          const { taskId, channel } = JSON.parse(String(init.body));
          bridgeRequests.push({ taskId, channel });
          return Response.json(
            activeBridgeStatus({
              lastHandoffRequestAt: "2026-07-01T12:00:00.000Z",
              lastHandoffTaskId: taskId,
              lastHandoffChannel: channel
            })
          );
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    await uploadLocalProject([
      new File(["person-bytes"], "person-real.png", { type: "image/png" }),
      new File(["cat-bytes"], "cat-real.png", { type: "image/png" })
    ]);
    await userEvent.type(
      screen.getByPlaceholderText("例如：让人物抱着小猫坐在沙发上看电视，画面自然真实。"),
      "让人物自然抱着小猫"
    );
    await userEvent.click(screen.getByRole("button", { name: "开始优化" }));

    await waitFor(() => expect(bridgeRequests).toHaveLength(1));
    expect(workerStarts).toHaveLength(0);
    expect(bridgeRequests[0]).toMatchObject({ channel: "manual_handoff" });
    expect(await screen.findByText("等待你复制并发送给 Codex")).toBeTruthy();
    expect(screen.getByText("把交接指令发送给 Codex")).toBeTruthy();
    expect(screen.getByText("粘贴到 Codex 输入框")).toBeTruthy();
    expect(screen.getByText(/复制交接指令/)).toBeTruthy();
  });

  it("cancels an active same-source task before starting a replacement edit", async () => {
    const snapshot = createSampleProjectSnapshot();
    const calls: string[] = [];
    let remoteProject = {
      mode: "big_image_edit" as const,
      currentNodeId: "root-image-group",
      selectedNodeIds: ["root-image-group"],
      showHiddenNodes: false,
      nodes: snapshot.nodes,
      tasks: [
        {
          id: "task-old",
          type: "region_edit",
          status: "running",
          sourceNodeIds: ["root-image-group"],
          instruction: "旧需求",
          codexPrompt: "old prompt",
          error: null,
          createdAt: "2026-07-01T12:00:00.000Z",
          updatedAt: "2026-07-01T12:00:01.000Z"
        }
      ]
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/bridge/status") && !init?.method) {
          return Response.json(activeBridgeStatus());
        }

        if (url.includes("/api/project") && !init?.method) {
          return Response.json(remoteProject);
        }

        if (url.includes("/api/codex-worker/cancel") && init?.method === "POST") {
          const { taskId, reason } = JSON.parse(String(init.body));
          calls.push(`cancel:${taskId}:${reason}`);
          remoteProject = {
            ...remoteProject,
            tasks: remoteProject.tasks.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    status: "failed",
                    error: reason,
                    updatedAt: "2026-07-01T12:00:02.000Z"
                  }
                : task
            )
          };
          return Response.json({
            ok: true,
            taskId,
            status: "failed",
            error: reason,
            project: remoteProject
          });
        }

        if (url.includes("/api/tasks") && init?.method === "POST") {
          const { task } = JSON.parse(String(init.body));
          calls.push(`create:${task.id}`);
          remoteProject = {
            ...remoteProject,
            tasks: [...remoteProject.tasks, task]
          };
          return Response.json(remoteProject);
        }

        if (url.includes("/api/bridge/request") && init?.method === "POST") {
          const { taskId, channel } = JSON.parse(String(init.body));
          calls.push(`handoff:${taskId}:${channel}`);
          return Response.json(
            activeBridgeStatus({
              lastHandoffRequestAt: "2026-07-01T12:00:00.000Z",
              lastHandoffTaskId: taskId,
              lastHandoffChannel: channel
            })
          );
        }

        if (url.includes("/api/codex-worker/start") && init?.method === "POST") {
          const { taskId } = JSON.parse(String(init.body));
          calls.push(`start:${taskId}`);
          remoteProject = {
            ...remoteProject,
            tasks: remoteProject.tasks.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    status: "running",
                    updatedAt: "2026-07-01T12:00:03.000Z"
                  }
                : task
            )
          };
          return Response.json({
            ok: true,
            taskId,
            status: "running",
            error: null,
            project: remoteProject
          });
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    await userEvent.type(
      await screen.findByPlaceholderText("例如：让人物抱着小猫坐在沙发上看电视，画面自然真实。"),
      "使用新的修图要求"
    );
    await userEvent.click(screen.getByRole("button", { name: "开始优化" }));

    await waitFor(() => expect(calls.some((call) => call.startsWith("handoff:"))).toBe(true));
    expect(calls[0]).toBe("cancel:task-old:已被新的编辑任务取代。");
    expect(calls[1]).toMatch(/^create:task-/);
    expect(calls[2]).toMatch(/^handoff:task-.*:manual_handoff$/);
    expect(calls.some((call) => call.startsWith("start:"))).toBe(false);
    expect(remoteProject.tasks[0]).toMatchObject({
      id: "task-old",
      status: "failed",
      error: "已被新的编辑任务取代。"
    });
  });

  it("shows processing status on the DAG node that is being generated", async () => {
    const snapshot = createSampleProjectSnapshot();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/project") && !init?.method) {
          return Response.json({
            mode: "version",
            currentNodeId: "root-image-group",
            selectedNodeIds: ["root-image-group"],
            showHiddenNodes: false,
            nodes: snapshot.nodes,
            tasks: [
              {
                id: "task-active",
                type: "region_edit",
                status: "pending",
                sourceNodeIds: ["root-image-group"],
                instruction: "清理背景",
                codexPrompt: "Use Codex image2.",
                error: null,
                createdAt: "2026-07-01T10:00:00.000+08:00",
                updatedAt: "2026-07-01T10:00:00.000+08:00"
              }
            ]
          });
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    await screen.findAllByText("图片组 Root");
    const graphNode = document.querySelector(".graph-node.root-node");
    expect(graphNode).not.toBeNull();
    expect(within(graphNode as HTMLElement).getByText("处理中")).toBeTruthy();
  });

  it("explains when a pending generation task has waited too long for Codex", async () => {
    const snapshot = createSampleProjectSnapshot();
    const staleTaskTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/project") && !init?.method) {
          return Response.json({
            mode: "big_image_view",
            currentNodeId: "root-image-group",
            selectedNodeIds: ["root-image-group"],
            showHiddenNodes: false,
            nodes: snapshot.nodes,
            tasks: [
              {
                id: "task-stale",
                type: "region_edit",
                status: "pending",
                sourceNodeIds: ["root-image-group"],
                instruction: "清理背景",
                codexPrompt: "Use Codex image2.",
                error: null,
                createdAt: staleTaskTime,
                updatedAt: staleTaskTime
              }
            ]
          });
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    expect(await screen.findByText("等待你复制并发送给 Codex")).toBeTruthy();
    expect(screen.getByText(/当前未连接 Codex Bridge/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新准备交接" })).toBeTruthy();
  });

  it("requeues a stale pending task and persists a fresh waiting timestamp", async () => {
    const snapshot = createSampleProjectSnapshot();
    const staleTaskTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const savedProjects: Array<{ tasks: Array<{ id: string; status: string; updatedAt: string }> }> =
      [];
    const bridgeRequests: Array<{ taskId: string; channel: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/bridge/status") && !init?.method) {
          return Response.json(activeBridgeStatus());
        }

        if (url.includes("/api/bridge/request") && init?.method === "POST") {
          const { taskId, channel } = JSON.parse(String(init.body));
          bridgeRequests.push({ taskId, channel });
          return Response.json(
            activeBridgeStatus({
              lastHandoffRequestAt: "2026-07-01T12:00:00.000Z",
              lastHandoffTaskId: taskId,
              lastHandoffChannel: channel,
              lastWakeRequestAt: "2026-07-01T12:00:00.000Z",
              lastWakeTaskId: taskId
            })
          );
        }

        if (url.includes("/api/project") && !init?.method) {
          return Response.json({
            mode: "big_image_view",
            currentNodeId: "root-image-group",
            selectedNodeIds: ["root-image-group"],
            showHiddenNodes: false,
            nodes: snapshot.nodes,
            tasks: [
              {
                id: "task-stale",
                type: "region_edit",
                status: "pending",
                sourceNodeIds: ["root-image-group"],
                instruction: "清理背景",
                codexPrompt: "Use Codex image2.",
                error: null,
                createdAt: staleTaskTime,
                updatedAt: staleTaskTime
              }
            ]
          });
        }

        if (url.includes("/api/project") && init?.method === "PUT") {
          savedProjects.push(JSON.parse(String(init.body)));
          return Response.json({ ok: true });
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "重新准备交接" }));

    await waitFor(() => expect(savedProjects).toHaveLength(1));
    await waitFor(() =>
      expect(bridgeRequests).toEqual([
        { taskId: "task-stale", channel: "manual_handoff" }
      ])
    );
    expect(savedProjects[0].tasks[0].status).toBe("pending");
    expect(Date.parse(savedProjects[0].tasks[0].updatedAt)).toBeGreaterThan(
      Date.parse(staleTaskTime)
    );
  });

  it("tells the user when Codex has claimed a task and is processing the image", async () => {
    const snapshot = createSampleProjectSnapshot();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/project") && !init?.method) {
          return Response.json({
            mode: "big_image_view",
            currentNodeId: "root-image-group",
            selectedNodeIds: ["root-image-group"],
            showHiddenNodes: false,
            nodes: snapshot.nodes,
            tasks: [
              {
                id: "task-running",
                type: "multi_node_merge",
                status: "running",
                sourceNodeIds: ["root-image-group"],
                instruction: "让人物自然抱着小猫",
                codexPrompt: "Use Codex image2.",
                error: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            ]
          });
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    expect(await screen.findByText("Codex 正在处理图片")).toBeTruthy();
    expect(screen.getByText(/Codex 已接手任务/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消任务" })).toBeTruthy();
  });

  it("lets the user retry a failed generation task and clears its error", async () => {
    const snapshot = createSampleProjectSnapshot();
    const savedProjects: Array<{
      tasks: Array<{ id: string; status: string; error: string | null; resultNodeId?: string }>;
    }> = [];
    const bridgeRequests: Array<{ taskId: string; channel: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/project") && !init?.method) {
          return Response.json({
            mode: "big_image_view",
            currentNodeId: "root-image-group",
            selectedNodeIds: ["root-image-group"],
            showHiddenNodes: false,
            nodes: snapshot.nodes,
            tasks: [
              {
                id: "task-failed",
                type: "region_edit",
                status: "failed",
                sourceNodeIds: ["root-image-group"],
                instruction: "把眼睛改成绿色",
                codexPrompt: "Use Codex image2.",
                resultNodeId: undefined,
                error: "生成结果未通过质量检查。",
                createdAt: "2026-07-01T10:00:00.000+08:00",
                updatedAt: "2026-07-01T10:03:00.000+08:00"
              }
            ]
          });
        }

        if (url.includes("/api/project") && init?.method === "PUT") {
          savedProjects.push(JSON.parse(String(init.body)));
          return Response.json({ ok: true });
        }

        if (url.includes("/api/bridge/request") && init?.method === "POST") {
          const { taskId, channel } = JSON.parse(String(init.body));
          bridgeRequests.push({ taskId, channel });
          return Response.json(
            activeBridgeStatus({
              lastHandoffRequestAt: "2026-07-01T12:00:00.000Z",
              lastHandoffTaskId: taskId,
              lastHandoffChannel: channel
            })
          );
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    expect(await screen.findByText("任务未完成")).toBeTruthy();
    expect(screen.getByText("生成结果未通过质量检查。")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "重试任务" }));

    await waitFor(() => expect(savedProjects).toHaveLength(1));
    await waitFor(() =>
      expect(bridgeRequests).toEqual([
        { taskId: "task-failed", channel: "manual_handoff" }
      ])
    );
    expect(savedProjects[0].tasks[0]).toMatchObject({
      id: "task-failed",
      status: "pending",
      error: null
    });
    expect(savedProjects[0].tasks[0]).not.toHaveProperty("resultNodeId");
  });

  it("does not show an old source-node failure while viewing a successful result node", async () => {
    const snapshot = createSampleProjectSnapshot();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes("/api/project")) {
          return Response.json({
            mode: "big_image_view",
            currentNodeId: "result-mcp-proof",
            selectedNodeIds: ["result-mcp-proof"],
            showHiddenNodes: false,
            nodes: [
              ...snapshot.nodes,
              {
                id: "result-mcp-proof",
                name: "MCP 桥接验证结果",
                kind: "edit",
                imageUrl: "/samples/person.jpg",
                parentIds: ["root-image-group"],
                hidden: false,
                deleted: false,
                position: { x: 720, y: 260 },
                summary: "MCP 写回成功。",
                edgeLabel: "MCP 验证",
                createdByTaskId: "task-succeeded",
                createdAt: "2026-07-01T10:05:00.000+08:00"
              }
            ],
            tasks: [
              {
                id: "task-old-failed",
                type: "region_edit",
                status: "failed",
                sourceNodeIds: ["root-image-group"],
                instruction: "旧任务",
                codexPrompt: "Old worker task.",
                resultNodeId: undefined,
                error: "旧 CLI worker 失败。",
                createdAt: "2026-07-01T10:00:00.000+08:00",
                updatedAt: "2026-07-01T10:01:00.000+08:00"
              },
              {
                id: "task-succeeded",
                type: "region_edit",
                status: "succeeded",
                sourceNodeIds: ["root-image-group"],
                instruction: "MCP 验证",
                codexPrompt: "MCP task.",
                resultNodeId: "result-mcp-proof",
                error: null,
                createdAt: "2026-07-01T10:02:00.000+08:00",
                updatedAt: "2026-07-01T10:05:00.000+08:00"
              }
            ]
          });
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "MCP 桥接验证结果" })).toBeTruthy();
    expect(screen.queryByText("任务未完成")).toBeNull();
    expect(screen.queryByText("旧 CLI worker 失败。")).toBeNull();
  });

  it("lets the user cancel an active task instead of leaving it stuck", async () => {
    const snapshot = createSampleProjectSnapshot();
    const savedProjects: Array<{ tasks: Array<{ id: string; status: string; error: string | null }> }> =
      [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/project") && !init?.method) {
          return Response.json({
            mode: "big_image_view",
            currentNodeId: "root-image-group",
            selectedNodeIds: ["root-image-group"],
            showHiddenNodes: false,
            nodes: snapshot.nodes,
            tasks: [
              {
                id: "task-running",
                type: "multi_node_merge",
                status: "running",
                sourceNodeIds: ["root-image-group"],
                instruction: "让人物自然抱着小猫",
                codexPrompt: "Use Codex image2.",
                error: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            ]
          });
        }

        if (url.includes("/api/project") && init?.method === "PUT") {
          savedProjects.push(JSON.parse(String(init.body)));
          return Response.json({ ok: true });
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "取消任务" }));

    await waitFor(() => expect(savedProjects).toHaveLength(1));
    expect(savedProjects[0].tasks[0]).toMatchObject({
      id: "task-running",
      status: "failed",
      error: "用户已取消此任务。"
    });
  });

  it("submits manually drawn lasso points instead of a rectangular selection", async () => {
    mockElementLayout();
    const createdTasks: Array<{
      task: {
        regions: Array<{
          points: Array<{ x: number; y: number }>;
          bounds: { x: number; y: number; width: number; height: number };
        }>;
      };
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/project") && !init?.method) {
          return Response.json(null);
        }

        if (url.includes("/api/tasks") && init?.method === "POST") {
          createdTasks.push(JSON.parse(String(init.body)));
          return Response.json(null);
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    const input = screen.getByLabelText("选择本地图片") as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(["person-bytes"], "person-real.png", { type: "image/png" })
    );
    const lassoTarget = screen.getByLabelText("套索圈选画布");

    fireEvent.pointerDown(lassoTarget, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100
    });
    fireEvent.pointerMove(lassoTarget, {
      pointerId: 1,
      clientX: 260,
      clientY: 120
    });
    fireEvent.pointerMove(lassoTarget, {
      pointerId: 1,
      clientX: 200,
      clientY: 280
    });
    fireEvent.pointerUp(lassoTarget, {
      pointerId: 1,
      clientX: 200,
      clientY: 280
    });

    await userEvent.type(
      screen.getByPlaceholderText("描述这个区域要怎么改"),
      "把选中区域改成绿色"
    );
    await userEvent.click(screen.getByRole("button", { name: "开始优化" }));

    await waitFor(() => expect(createdTasks).toHaveLength(1));
    expect(createdTasks[0].task.regions[0].points).toEqual([
      { x: 10, y: 16 },
      { x: 26, y: 19.2 },
      { x: 20, y: 44.800000000000004 },
      { x: 10, y: 16 }
    ]);
    expect(createdTasks[0].task.regions[0].bounds).toEqual({
      x: 10,
      y: 16,
      width: 16,
      height: 28.8
    });
  });

  it("LassoCanvas emits a complete region draft after pointer drawing", () => {
    mockSvgLayout();
    const handleRegionCreate = vi.fn();
    render(
      <LassoCanvas
        locked={false}
        regions={[]}
        selectedRegionId={null}
        createRegion={(points) => createLassoRegion(1, points)}
        onRegionCreate={handleRegionCreate}
        onSelectRegion={() => undefined}
      />
    );

    drawTriangle(screen.getByLabelText("套索圈选画布"));

    expect(handleRegionCreate).toHaveBeenCalledWith({
      id: "region-1",
      label: "区域 1",
      points: [
        { x: 100, y: 100 },
        { x: 260, y: 120 },
        { x: 200, y: 280 },
        { x: 100, y: 100 }
      ],
      color: "#55f0c2",
      instruction: ""
    });
  });

  it("drawing a lasso creates a region input and delete removes it", async () => {
    mockSvgLayout();
    render(<BigImageEdit currentNodeId="node-root" locked={false} />);

    drawTriangle(screen.getByLabelText("套索圈选画布"));

    expect(
      screen.getByPlaceholderText("描述这个区域要如何修改")
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "删除区域" }));

    expect(
      screen.queryByPlaceholderText("描述这个区域要如何修改")
    ).toBeNull();
  });

  it("locked edit mode blocks drawing and disables edit controls", () => {
    mockSvgLayout();
    render(<BigImageEdit currentNodeId="node-root" locked={true} />);

    drawTriangle(screen.getByLabelText("套索圈选画布"));

    expect(
      screen.queryByPlaceholderText("描述这个区域要如何修改")
    ).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "撤销" }).disabled).toBe(
      true
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "开始优化" })
        .disabled
    ).toBe(true);
  });

  it("App exit discard returns edit mode to view mode", async () => {
    mockSvgLayout();
    render(<App />);

    await uploadLocalProject();
    await userEvent.type(
      screen.getByPlaceholderText("例如：把背景处理得更干净，保留人物主体。"),
      "把背景处理得更干净"
    );
    await userEvent.click(screen.getByRole("button", { name: "退出编辑" }));

    const dialog = screen.getByRole("dialog", {
      name: "放弃当前编辑？"
    });
    expect(dialog).toBeTruthy();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "放弃修改" })
    );

    expect(screen.getByLabelText("图片详情 - 查看模式")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("App exit dialog focuses cancel, traps Tab, handles Escape, and restores focus", async () => {
    const user = userEvent.setup();
    mockSvgLayout();
    render(<App />);

    await uploadLocalProject();
    await user.type(
      screen.getByPlaceholderText("例如：把背景处理得更干净，保留人物主体。"),
      "把背景处理得更干净"
    );
    const exitButton = screen.getByRole("button", { name: "退出编辑" });
    await user.click(exitButton);

    const dialog = screen.getByRole("dialog", {
      name: "放弃当前编辑？"
    });
    const continueButton = within(dialog).getByRole("button", {
      name: "继续编辑"
    });
    const discardButton = within(dialog).getByRole("button", {
      name: "放弃修改"
    });

    expect(document.activeElement).toBe(continueButton);

    await user.tab();
    expect(document.activeElement).toBe(discardButton);

    await user.tab();
    expect(document.activeElement).toBe(continueButton);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(exitButton);
    expect(screen.getByLabelText("图片详情 - 编辑模式")).toBeTruthy();
  });

  it("BigImageEdit exit dialog handles Escape as continue editing", async () => {
    const user = userEvent.setup();
    mockSvgLayout();
    render(<BigImageEdit currentNodeId="node-root" locked={false} />);

    drawTriangle(screen.getByLabelText("套索圈选画布"));

    const exitButton = screen.getByRole("button", { name: "退出编辑" });
    await user.click(exitButton);

    const dialog = screen.getByRole("dialog", {
      name: "放弃当前编辑？"
    });

    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "继续编辑" })
    );

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(exitButton);
  });

  it("keeps the topbar from opening a second confirmation while edit dialog is open", async () => {
    const user = userEvent.setup();
    mockSvgLayout();
    render(<App />);

    await uploadLocalProject();
    await user.type(
      screen.getByPlaceholderText("例如：把背景处理得更干净，保留人物主体。"),
      "把背景处理得更干净"
    );
    const viewTab = screen.getByRole<HTMLButtonElement>("button", {
      name: "图片详情"
    });
    await user.click(screen.getByRole("button", { name: "退出编辑" }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      (document.querySelector(".canvas-app") as HTMLElement & {
        inert?: boolean;
      })?.inert ?? (document.querySelector(".app") as HTMLElement & {
        inert?: boolean;
      }).inert
    ).toBe(true);

    fireEvent.click(viewTab);

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(viewTab.getAttribute("aria-pressed")).toBe("true");
  });

  it("focuses a newly completed Codex result from the remote canvas state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/project") && !init?.method) {
          return Response.json({
            mode: "version",
            currentNodeId: "cat-source",
            selectedNodeIds: ["cat-source"],
            showHiddenNodes: false,
            nodes: [
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
              },
              {
                id: "codex-cat-at-marker-1",
                name: "小猫放到标记位置",
                kind: "edit",
                imageUrl: "data:image/svg+xml,%3Csvg/%3E",
                parentIds: ["cat-source"],
                hidden: false,
                deleted: false,
                position: { x: 340, y: 280 },
                summary: "已按标记位置把小猫合成到左下角石栏旁。",
                edgeLabel: "把小猫 P 到标记位置",
                createdByTaskId: "task-1",
                createdAt: "2026-06-30T01:00:00.000+08:00"
              }
            ],
            tasks: [
              {
                id: "task-1",
                type: "region_edit",
                status: "succeeded",
                sourceNodeIds: ["cat-source"],
                instruction: "把小猫 P 到标记位置",
                codexPrompt: "Use Codex image editing capability.",
                resultNodeId: "codex-cat-at-marker-1",
                error: null,
                createdAt: "2026-06-30T01:00:00.000+08:00",
                updatedAt: "2026-06-30T01:01:00.000+08:00"
              }
            ]
          });
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    expect(await screen.findAllByText("小猫放到标记位置")).not.toHaveLength(0);
    expect(screen.getByLabelText("图片详情 - 查看模式")).toBeTruthy();
    expect(screen.getByText("已按标记位置把小猫合成到左下角石栏旁。")).toBeTruthy();
  });

  it("opens the system save picker before exporting the current image", async () => {
    const write = vi.fn(async (_data: Blob) => undefined);
    const close = vi.fn(async () => undefined);
    const showSaveFilePicker = vi.fn(async () => ({
      name: "封面图.png",
      createWritable: vi.fn(async () => ({ write, close }))
    }));
    vi.stubGlobal("showSaveFilePicker", showSaveFilePicker);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/project") && !init?.method) {
          return Response.json({
            mode: "big_image_view",
            currentNodeId: "export-node",
            selectedNodeIds: ["export-node"],
            showHiddenNodes: false,
            nodes: [
              {
                id: "export-node",
                name: "封面图",
                kind: "edit",
                imageUrl: "data:image/png;base64,aW1hZ2U=",
                parentIds: [],
                hidden: false,
                deleted: false,
                position: { x: 360, y: 40 },
                summary: "可导出的图片。",
                createdAt: "2026-07-01T10:00:00.000+08:00"
              }
            ],
            tasks: []
          });
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    await screen.findByLabelText("图片详情 - 查看模式");
    await userEvent.click(screen.getByRole("button", { name: "导出当前图片" }));

    await waitFor(() => expect(showSaveFilePicker).toHaveBeenCalledTimes(1));
    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: "封面图.png",
      types: [
        {
          description: "图片",
          accept: {
            "image/png": [".png"],
            "image/jpeg": [".jpg", ".jpeg"],
            "image/webp": [".webp"]
          }
        }
      ]
    });
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith(expect.any(Blob));
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "导出当前图片" })).toBeNull();
    expect(screen.getByText("已导出到 封面图.png")).toBeTruthy();
  });

  it("falls back to a local export path when the system picker is unavailable", async () => {
    const exportRequests: Array<{
      nodeId: string;
      imageUrl: string;
      filePath: string;
    }> = [];
    vi.stubGlobal("showSaveFilePicker", undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/project") && !init?.method) {
          return Response.json({
            mode: "big_image_view",
            currentNodeId: "export-node",
            selectedNodeIds: ["export-node"],
            showHiddenNodes: false,
            nodes: [
              {
                id: "export-node",
                name: "封面图",
                kind: "edit",
                imageUrl: "data:image/png;base64,aW1hZ2U=",
                parentIds: [],
                hidden: false,
                deleted: false,
                position: { x: 360, y: 40 },
                summary: "可导出的图片。",
                createdAt: "2026-07-01T10:00:00.000+08:00"
              }
            ],
            tasks: []
          });
        }

        if (url.includes("/api/export") && init?.method === "POST") {
          exportRequests.push(JSON.parse(String(init.body)));
          return Response.json({
            ok: true,
            filePath: "/Users/kwee/Downloads/cover.png"
          });
        }

        return Response.json({ ok: true });
      })
    );

    render(<App />);

    await screen.findByLabelText("图片详情 - 查看模式");
    await userEvent.click(screen.getByRole("button", { name: "导出当前图片" }));

    const dialog = screen.getByRole("dialog", { name: "导出当前图片" });
    const pathInput = within(dialog).getByLabelText("本地路径") as HTMLInputElement;

    expect(pathInput.value).toBe("~/Downloads/封面图.png");

    await userEvent.clear(pathInput);
    await userEvent.type(pathInput, "/Users/kwee/Downloads/cover.png");
    await userEvent.click(within(dialog).getByRole("button", { name: "导出" }));

    await waitFor(() => expect(exportRequests).toHaveLength(1));
    expect(exportRequests[0]).toEqual({
      nodeId: "export-node",
      imageUrl: "data:image/png;base64,aW1hZ2U=",
      filePath: "/Users/kwee/Downloads/cover.png"
    });
    expect(screen.getByText("已导出到 /Users/kwee/Downloads/cover.png")).toBeTruthy();
  });

  it("Start Edit click shows a running placeholder state", async () => {
    mockSvgLayout();
    render(<BigImageEdit currentNodeId="node-root" locked={false} />);

    drawTriangle(screen.getByLabelText("套索圈选画布"));
    await userEvent.type(
      screen.getByPlaceholderText("描述这个区域要如何修改"),
      "Remove the background distraction"
    );
    await userEvent.click(screen.getByRole("button", { name: "开始优化" }));

    expect(screen.getByText("编辑请求已排队")).toBeTruthy();
    expect(screen.getByText(/优先尝试本地高保真处理，必要时再调用 image2/)).toBeTruthy();
  });
});
