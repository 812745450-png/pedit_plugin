import {
  ChangeEvent,
  FormEvent,
  MouseEvent,
  PointerEvent,
  WheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import {
  applyCanvasStateSnapshot,
  CanvasMode,
  CanvasStateSnapshot,
  CanvasUiState,
  createCanvasUiState,
  selectNode,
  setCanvasMode
} from "./state/canvasStore";
import {
  findBranchIds,
  findImageNode,
  ImageProjectNode,
  loadStoredProjectSnapshot,
  saveProjectSnapshot
} from "./state/imageProject";
import {
  buildManualHandoffPrompt,
  buildCodexPrompt,
  CanvasGenerationTask,
  cancelCodexWorkerTask,
  CodexBridgeStatus,
  createRemoteProjectSlot,
  createRemoteTask,
  deleteRemoteProjectSlot,
  exportImageToPath,
  fetchCodexBridgeStatus,
  fetchRemoteProjectLibrary,
  fetchRemoteProjectStatus,
  getRegionBounds,
  inferSelectionSemantics,
  openRemoteProjectSlot,
  RemoteCanvasProject,
  RemoteProjectLibrary,
  RemoteProjectSummary,
  recordCodexBridgeTaskRequest,
  renameRemoteProjectSlot,
  resetRemoteProject,
  saveRemoteProject
} from "./state/peditClient";

const canvasStateStorageKey = "pedit.canvas.ui-state";
const rootNodeId = "root-image-group";
const fallbackImageUrl = "/samples/person.jpg";

type CanvasKey = "detail" | "graph";
type RemoteConnection = "checking" | "connected" | "unavailable";

interface CanvasTransform {
  x: number;
  y: number;
  scale: number;
}

interface EditRegion {
  id: string;
  name: string;
  points: Array<{ x: number; y: number }>;
  prompt: string;
}

interface ReferenceImage {
  name: string;
  url: string;
}

interface EditDraft {
  wholePrompt: string;
  regions: EditRegion[];
  references: ReferenceImage[];
}

interface LassoDraft {
  points: EditRegion["points"];
}

interface NodeMenu {
  id: string;
  x: number;
  y: number;
}

type PendingProjectAction = "new" | "reset";
type PendingProjectDelete = RemoteProjectSummary;

interface ExportTarget {
  nodeId: string;
  name: string;
  imageUrl: string;
  filePath: string;
}

interface SaveFilePickerHandle {
  name: string;
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
}

interface SaveFilePickerOptions {
  suggestedName: string;
  types: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}

type SaveFilePicker = (options: SaveFilePickerOptions) => Promise<SaveFilePickerHandle>;

const defaultCanvas = (): CanvasTransform => ({ x: 150, y: 80, scale: 1 });

const emptyDraft = (): EditDraft => ({
  wholePrompt: "",
  regions: [],
  references: []
});

export function App() {
  const [uiState, setUiState] = useState<CanvasUiState>(() =>
    loadStoredCanvasState()
  );
  const [projectNodes, setProjectNodes] = useState<ImageProjectNode[]>(
    () => loadStoredProjectSnapshot().nodes
  );
  const [tasks, setTasks] = useState<CanvasGenerationTask[]>([]);
  const [remoteReady, setRemoteReady] = useState(false);
  const [remoteConnection, setRemoteConnection] =
    useState<RemoteConnection>("checking");
  const [bridgeStatus, setBridgeStatus] = useState<CodexBridgeStatus | null>(null);
  const [draft, setDraft] = useState<EditDraft>(() => emptyDraft());
  const [detailCanvas, setDetailCanvas] = useState<CanvasTransform>(() =>
    defaultCanvas()
  );
  const [graphCanvas, setGraphCanvas] = useState<CanvasTransform>(() => ({
    x: 120,
    y: 96,
    scale: 1
  }));
  const [compareMode, setCompareMode] = useState<"image" | "slider" | "split">(
    "image"
  );
  const [compareValue, setCompareValue] = useState(52);
  const [lassoActive, setLassoActive] = useState(true);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [lassoDraft, setLassoDraft] = useState<LassoDraft | null>(null);
  const [mergePrompt, setMergePrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState("");
  const [menu, setMenu] = useState<NodeMenu | null>(null);
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectLibrary, setProjectLibrary] = useState<RemoteProjectLibrary | null>(null);
  const [projectLibraryOpen, setProjectLibraryOpen] = useState(false);
  const [projectRenameDraft, setProjectRenameDraft] = useState<string | null>(null);
  const [pendingProjectAction, setPendingProjectAction] =
    useState<PendingProjectAction | null>(null);
  const [pendingProjectDelete, setPendingProjectDelete] =
    useState<PendingProjectDelete | null>(null);
  const [pendingExit, setPendingExit] = useState(false);
  const [exportTarget, setExportTarget] = useState<ExportTarget | null>(null);
  const [exporting, setExporting] = useState(false);
  const tasksRef = useRef<CanvasGenerationTask[]>([]);
  const projectFileInputRef = useRef<HTMLInputElement | null>(null);
  const referenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const lassoDraftPointsRef = useRef<EditRegion["points"]>([]);
  const detailStageRef = useRef<HTMLDivElement | null>(null);
  const graphStageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    key: CanvasKey;
    startX: number;
    startY: number;
    origin: CanvasTransform;
  } | null>(null);
  const ignoreRemoteUntilRef = useRef(0);

  const fallbackCurrentNode = useMemo(
    () => projectNodes.find((node) => !node.deleted) ?? null,
    [projectNodes]
  );
  const currentNode =
    findImageNode(projectNodes, uiState.currentNodeId) ?? fallbackCurrentNode;
  const rootProjectNode =
    findImageNode(projectNodes, rootNodeId) ?? fallbackCurrentNode;
  const currentProjectName = rootProjectNode?.name ?? "未命名项目";
  const hasProject = Boolean(currentNode);
  const detailState = uiState.mode === "big_image_edit" ? "edit" : "view";
  const pageMode = uiState.mode === "version" ? "manage" : "detail";
  const currentParent = useMemo(
    () => findPrimaryParent(projectNodes, currentNode),
    [projectNodes, currentNode]
  );
  const visibleNodes = useMemo(
    () => projectNodes.filter((node) => !node.deleted),
    [projectNodes]
  );
  const graphNodes = useMemo(() => layoutProjectNodes(visibleNodes), [visibleNodes]);
  const adjacent = useMemo(
    () => adjacentNodes(projectNodes, currentNode),
    [projectNodes, currentNode]
  );
  const activeTasks = useMemo(
    () =>
      tasks.filter(
        (task) => task.status === "pending" || task.status === "running"
      ),
    [tasks]
  );
  const taskPanelTasks = useMemo(
    () => {
      const relevantTasks = currentNode
        ? tasks.filter((task) => {
            if (task.resultNodeId === currentNode.id) {
              return true;
            }

            if (task.status === "pending" || task.status === "running") {
              return task.sourceNodeIds.includes(currentNode.id);
            }

            return (
              task.status === "failed" &&
              !task.resultNodeId &&
              !currentNode.createdByTaskId &&
              task.sourceNodeIds.includes(currentNode.id)
            );
          })
        : tasks;

      return relevantTasks
        .filter(
          (task) =>
            task.status === "pending" ||
            task.status === "running" ||
            (task.status === "failed" && !task.resultNodeId)
        )
        .slice(-3);
    },
    [currentNode, tasks]
  );
  const processingNodeIds = useMemo(() => {
    const nodeIds = new Set<string>();

    activeTasks.forEach((task) => {
      task.sourceNodeIds.forEach((nodeId) => nodeIds.add(nodeId));
      if (task.resultNodeId) {
        nodeIds.add(task.resultNodeId);
      }
    });

    return nodeIds;
  }, [activeTasks]);
  const activeCanvas = pageMode === "manage" ? graphCanvas : detailCanvas;

  useEffect(() => {
    if (!currentNode || pageMode !== "detail") {
      return;
    }

    const frame = window.requestAnimationFrame(() => fitView("detail"));
    return () => window.cancelAnimationFrame(frame);
  }, [currentNode?.id, pageMode]);

  useEffect(() => {
    if (!fallbackCurrentNode) {
      return;
    }

    if (findImageNode(projectNodes, uiState.currentNodeId)) {
      return;
    }

    setUiState((state) =>
      selectNode(state, fallbackCurrentNode.id, [fallbackCurrentNode.id])
    );
  }, [fallbackCurrentNode?.id, projectNodes, uiState.currentNodeId]);

  useEffect(() => {
    let cancelled = false;

    void fetchCodexBridgeStatus().then((status) => {
      setBridgeStatus(status);
    });

    fetchRemoteProjectStatus().then((result) => {
      if (cancelled) {
        return;
      }

      setRemoteConnection(result.available ? "connected" : "unavailable");
      if (result.project) {
        applyRemoteProject(result.project);
      }
      setRemoteReady(true);
    });

    fetchRemoteProjectLibrary().then((library) => {
      if (!cancelled && library) {
        setProjectLibrary(library);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!remoteReady || activeTasks.length === 0) {
      return;
    }

    const id = window.setInterval(async () => {
      const result = await fetchRemoteProjectStatus();
      const bridge = await fetchCodexBridgeStatus();
      setBridgeStatus(bridge);
      setRemoteConnection(result.available ? "connected" : "unavailable");
      if (result.project) {
        applyRemoteProject(result.project);
      }
      const library = await fetchRemoteProjectLibrary();
      if (library) {
        setProjectLibrary(library);
      }
    }, 1000);

    return () => window.clearInterval(id);
  }, [activeTasks.length, remoteReady]);

  useEffect(() => {
    saveStoredCanvasState(uiState);
  }, [uiState]);

  useEffect(() => {
    saveProjectSnapshot({ nodes: projectNodes });
  }, [projectNodes]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const id = window.setTimeout(() => setToast(""), 2200);

    return () => window.clearTimeout(id);
  }, [toast]);

  const applyRemoteProject = (
    project: RemoteCanvasProject,
    options: { force?: boolean } = {}
  ) => {
    if (!options.force && Date.now() < ignoreRemoteUntilRef.current) {
      return;
    }

    const newlyCompletedResultNodeId = findNewlyCompletedResultNodeId(
      tasksRef.current,
      project
    );
    const fallbackNodeId =
      newlyCompletedResultNodeId ??
      project.currentNodeId ??
      project.selectedNodeIds.find((nodeId) =>
        project.nodes.some((node) => node.id === nodeId && !node.deleted)
      ) ??
      project.nodes.find((node) => !node.deleted)?.id ??
      null;
    tasksRef.current = project.tasks;

    setProjectNodes(project.nodes);
    setTasks(project.tasks);
    setUiState((state) => ({
      ...state,
      mode: newlyCompletedResultNodeId ? "big_image_view" : project.mode,
      currentNodeId: fallbackNodeId ?? state.currentNodeId,
      selectedNodeIds: newlyCompletedResultNodeId
        ? [newlyCompletedResultNodeId]
        : project.selectedNodeIds.length
          ? project.selectedNodeIds
          : fallbackNodeId
            ? [fallbackNodeId]
            : [],
      showHiddenNodes: project.showHiddenNodes
    }));

    if (newlyCompletedResultNodeId) {
      setDraft(emptyDraft());
      setCompareMode("image");
      void saveRemoteProject({
        ...project,
        mode: "big_image_view",
        currentNodeId: newlyCompletedResultNodeId,
        selectedNodeIds: [newlyCompletedResultNodeId]
      });
    }
  };

  const persistProject = async (
    nodes = projectNodes,
    nextUiState = uiState,
    nextTasks = tasks
  ) => {
    ignoreRemoteUntilRef.current = Date.now() + 1500;
    const saved = await saveRemoteProject({
      mode: nextUiState.mode,
      currentNodeId: nextUiState.currentNodeId,
      selectedNodeIds: nextUiState.selectedNodeIds,
      showHiddenNodes: nextUiState.showHiddenNodes,
      nodes,
      tasks: nextTasks
    });
    setRemoteConnection(saved ? "connected" : "unavailable");
  };

  const resetRemoteRuntime = async () => {
    ignoreRemoteUntilRef.current = Date.now() + 1500;
    const resetProject = await resetRemoteProject();
    setRemoteConnection(resetProject ? "connected" : "unavailable");
    return Boolean(resetProject);
  };

  const refreshProjectLibrary = async () => {
    const library = await fetchRemoteProjectLibrary();
    if (library) {
      setProjectLibrary(library);
    }
    return library;
  };

  const applyProjectLibrary = (
    library: RemoteProjectLibrary,
    options: { force?: boolean } = { force: true }
  ) => {
    setProjectLibrary(library);
    applyRemoteProject(library.project, options);
  };

  const createRemoteProjectLibrarySlot = async (
    name: string,
    options: { applyProject?: boolean } = {}
  ) => {
    ignoreRemoteUntilRef.current = Date.now() + 1500;
    const library = await createRemoteProjectSlot(name);
    if (library) {
      if (options.applyProject) {
        applyProjectLibrary(library, { force: true });
      } else {
        setProjectLibrary(library);
      }
      setRemoteConnection("connected");
      return true;
    }

    setRemoteConnection("unavailable");
    return false;
  };

  const createEmptyProject = (message = "已新建空项目，请上传图片开始编辑。") => {
    ignoreRemoteUntilRef.current = Date.now() + 1500;
    const nextState = createCanvasUiState();
    setProjectNodes([]);
    setTasks([]);
    tasksRef.current = [];
    setDraft(emptyDraft());
    setSelectedRegionId(null);
    setLassoDraft(null);
    setCompareMode("image");
    setMenu(null);
    setProjectMenuOpen(false);
    setPendingProjectAction(null);
    setUiState(nextState);
    setDetailCanvas(defaultCanvas());
    setGraphCanvas({ x: 120, y: 96, scale: 1 });
    setToast(message);
    void (async () => {
      await createRemoteProjectLibrarySlot("未命名项目", { applyProject: true });
      await refreshProjectLibrary();
    })();
  };

  const createProjectFromFiles = async (files: File[]) => {
    if (!files.length) {
      return;
    }
    ignoreRemoteUntilRef.current = Date.now() + 1500;

    const uploadedImages = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        url: await readFileAsDataUrl(file)
      }))
    );
    const now = new Date().toISOString();
    const rootNode: ImageProjectNode =
      uploadedImages.length === 1
        ? {
            id: rootNodeId,
            name: uploadedImages[0].name,
            kind: "source",
            imageUrl: uploadedImages[0].url,
            parentIds: [],
            hidden: false,
            deleted: false,
            position: { x: 360, y: 40 },
            summary: "用户上传的原始图片。",
            createdAt: now
          }
        : {
            id: rootNodeId,
            name: "图片组 Root",
            kind: "source",
            imageUrl: uploadedImages[0].url,
            referenceImageUrls: uploadedImages.map((image) => image.url),
            referenceImageNames: uploadedImages.map((image) => image.name),
            parentIds: [],
            hidden: false,
            deleted: false,
            position: { x: 360, y: 40 },
            summary: "用户上传的一组图片，可根据自然语言组合生成新图。",
            createdAt: now
          };
    const nextState = setCanvasMode(
      selectNode(uiState, rootNode.id, [rootNode.id]),
      "big_image_edit"
    );

    setProjectNodes([rootNode]);
    setTasks([]);
    setDraft(emptyDraft());
    setSelectedRegionId(null);
    setLassoDraft(null);
    setCompareMode("image");
    setUiState(nextState);
    setToast(
      uploadedImages.length === 1
        ? "已上传图片并进入编辑。"
        : "已上传图片组并进入编辑。"
    );
    void (async () => {
      await createRemoteProjectLibrarySlot(rootNode.name);
      await persistProject([rootNode], nextState, []);
      await refreshProjectLibrary();
    })();
    window.requestAnimationFrame(() => fitView("detail"));
  };

  const handleProjectFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length) {
      setProjectMenuOpen(false);
      void createProjectFromFiles(files);
    }
  };

  const requestProjectAction = (action: PendingProjectAction) => {
    setAppMenuOpen(false);
    setProjectMenuOpen(false);
    setPendingProjectAction(action);
  };

  const confirmProjectAction = () => {
    if (pendingProjectAction === "new") {
      createEmptyProject();
      return;
    }

    if (pendingProjectAction === "reset") {
      createEmptyProject("已重置当前项目，请上传图片重新开始。");
    }
  };

  const requestRenameProject = () => {
    setProjectMenuOpen(false);
    setProjectRenameDraft(currentProjectName);
  };

  const renameProject = (name: string) => {
    if (!name.trim() || !rootProjectNode) {
      return;
    }

    const nextName = name.trim();
    const nextNodes = projectNodes.map((node) =>
      node.id === rootProjectNode.id ? { ...node, name: nextName } : node
    );
    setProjectNodes(nextNodes);
    setProjectMenuOpen(false);
    setProjectRenameDraft(null);
    setToast("项目已重命名。");
    void (async () => {
      const library = await renameRemoteProjectSlot(
        projectLibrary?.activeProjectId ?? null,
        nextName
      );

      if (library) {
        applyProjectLibrary(library, { force: true });
        setToast("项目已重命名。");
        return;
      }

      await persistProject(nextNodes);
      await refreshProjectLibrary();
    })();
  };

  const openProjectFromLibrary = (projectId: string) =>
    void (async () => {
      ignoreRemoteUntilRef.current = Date.now() + 1500;
      const library = await openRemoteProjectSlot(projectId);
      if (!library) {
        setToast("打开项目失败。");
        return;
      }

      applyProjectLibrary(library, { force: true });
      setProjectLibraryOpen(false);
      setProjectMenuOpen(false);
      setPendingProjectDelete(null);
      setDraft(emptyDraft());
      setSelectedRegionId(null);
      setLassoDraft(null);
      setCompareMode("image");
      setToast("已打开项目。");
      window.requestAnimationFrame(() => fitView("detail"));
    })();

  const requestDeleteProject = (project: RemoteProjectSummary) => {
    setPendingProjectDelete(project);
  };

  const confirmDeleteProject = () =>
    void (async () => {
      const project = pendingProjectDelete;
      if (!project) {
        return;
      }

      ignoreRemoteUntilRef.current = Date.now() + 1500;
      const library = await deleteRemoteProjectSlot(project.id);
      setPendingProjectDelete(null);
      if (!library) {
        setToast("删除项目失败。");
        return;
      }

      applyProjectLibrary(library, { force: true });
      setProjectLibraryOpen(true);
      setDraft(emptyDraft());
      setSelectedRegionId(null);
      setLassoDraft(null);
      setToast("项目已删除。");
    })();

  const switchMode = (mode: "detail" | "manage") => {
    if (!hasProject) {
      return;
    }

    if (mode === "manage") {
      const nextState = setCanvasMode(uiState, "version");
      setUiState(nextState);
      void persistProject(projectNodes, nextState);
      window.requestAnimationFrame(() => fitView("graph"));
      return;
    }

    const nextState = setCanvasMode(uiState, detailState === "edit" ? "big_image_edit" : "big_image_view");
    setUiState(nextState);
    void persistProject(projectNodes, nextState);
    window.requestAnimationFrame(() => fitView("detail"));
  };

  const enterEdit = () => {
    const nextState = setCanvasMode(uiState, "big_image_edit");
    setUiState(nextState);
    void persistProject(projectNodes, nextState);
    window.requestAnimationFrame(() => fitView("detail"));
  };

  const requestExitEdit = () => {
    if (hasDraftChanges(draft)) {
      setPendingExit(true);
      return;
    }

    exitEdit(true);
  };

  const exitEdit = (discard: boolean) => {
    if (discard) {
      setDraft(emptyDraft());
      setSelectedRegionId(null);
      setLassoDraft(null);
    }

    const nextState = setCanvasMode(uiState, "big_image_view");
    setUiState(nextState);
    setPendingExit(false);
    void persistProject(projectNodes, nextState);
    window.requestAnimationFrame(() => fitView("detail"));
  };

  const updateWholePrompt = (wholePrompt: string) => {
    setDraft((state) => ({ ...state, wholePrompt }));
  };

  const updateRegionPrompt = (id: string, prompt: string) => {
    setDraft((state) => ({
      ...state,
      regions: state.regions.map((region) =>
        region.id === id ? { ...region, prompt } : region
      )
    }));
  };

  const requestReferenceUpload = () => {
    referenceFileInputRef.current?.click();
  };

  const addReferenceFiles = async (files: File[]) => {
    if (!files.length) {
      return;
    }

    try {
      const uploadedReferences = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          url: await readFileAsDataUrl(file)
        }))
      );

      setDraft((state) => ({
        ...state,
        references: [
          ...state.references,
          ...uploadedReferences.filter(
            (reference) =>
              !state.references.some((existing) => existing.url === reference.url)
          )
        ]
      }));
      setToast(
        uploadedReferences.length === 1
          ? "已上传 1 张参考图。"
          : `已上传 ${uploadedReferences.length} 张参考图。`
      );
    } catch {
      setToast("参考图上传失败，请重新选择图片文件。");
    }
  };

  const handleReferenceFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void addReferenceFiles(files);
  };

  const startOptimize = async (type: "edit" | "group" | "merge") => {
    const sources =
      type === "merge"
        ? uiState.selectedNodeIds
            .map((nodeId) => findImageNode(projectNodes, nodeId))
            .filter((node): node is ImageProjectNode => Boolean(node))
        : currentNode
          ? [currentNode]
          : [];

    if (sources.length === 0) {
      return;
    }

    setGenerating(true);
    setMenu(null);

    const sourceIds = new Set(sources.map((source) => source.id));
    const supersededTasks = tasksRef.current.filter(
      (task) =>
        (task.status === "pending" || task.status === "running") &&
        task.sourceNodeIds.some((nodeId) => sourceIds.has(nodeId))
    );
    let baseTasks = tasksRef.current;

    if (supersededTasks.length > 0) {
      const cancelResults = await Promise.all(
        supersededTasks.map((task) =>
          cancelCodexWorkerTask(task.id, "已被新的编辑任务取代。")
        )
      );
      const remoteProject = cancelResults
        .map((result) => result?.project)
        .filter((project): project is RemoteCanvasProject => Boolean(project))
        .at(-1);

      if (remoteProject) {
        applyRemoteProject(remoteProject, { force: true });
        baseTasks = remoteProject.tasks;
      } else {
        const supersededIds = new Set(supersededTasks.map((task) => task.id));
        const updatedAt = new Date().toISOString();
        baseTasks = baseTasks.map((task) =>
          supersededIds.has(task.id)
            ? {
                ...task,
                status: "failed",
                error: "已被新的编辑任务取代。",
                workerStage: undefined,
                workerMessage: undefined,
                updatedAt
              }
            : task
        );
        setTasks(baseTasks);
        tasksRef.current = baseTasks;
        void persistProject(projectNodes, uiState, baseTasks);
      }
    }

    const regions =
      type === "edit" && draft.regions.length
        ? draft.regions.map((region) => ({
            id: region.id,
            label: region.name,
            points: region.points,
            bounds: getRegionBounds(region.points),
            instruction: region.prompt
          }))
        : undefined;
    const instruction =
      type === "merge"
        ? mergePrompt.trim()
        : [
            draft.wholePrompt.trim()
              ? `整图要求: ${draft.wholePrompt.trim()}`
              : null,
            ...(draft.regions
              .filter((region) => region.prompt.trim())
              .map((region) => `${region.name}: ${region.prompt.trim()}`)),
            draft.references.length
              ? `参考图: ${draft.references.map((ref) => ref.name).join(", ")}`
              : null
          ]
            .filter((item): item is string => Boolean(item))
            .join("; ");
    const task = createCanvasTask({
      type: type === "merge" || type === "group" ? "multi_node_merge" : "region_edit",
      sourceNodes: sources,
      instruction,
      regions,
      referenceImages:
        type !== "merge" && draft.references.length
          ? draft.references.map((reference) => ({
              name: reference.name,
              imageUrl: reference.url
            }))
          : undefined
    });
    const remoteProject = await createRemoteTask(task);
    const nextTasks = [...baseTasks.filter((item) => item.id !== task.id), task];
    setTasks(nextTasks);
    tasksRef.current = nextTasks;

    let toastMessage = "后端任务创建失败，已保留本地任务状态。";

    if (remoteProject) {
      const bridge = await recordCodexBridgeTaskRequest(
        task.id,
        task.handoffChannel ?? "manual_handoff"
      );
      setBridgeStatus(bridge);
      toastMessage =
        bridge?.status === "active"
          ? "已创建交接指令，请发送给当前 Codex 对话。"
          : "已创建交接指令；请启用 Pedit MCP Bridge 后发送给 Codex。";

      applyRemoteProject(remoteProject, { force: true });
    } else {
      const nextState = setCanvasMode(
        selectNode(uiState, sources[0].id, sources.map((source) => source.id)),
        "version"
      );
      setUiState(nextState);
      void persistProject(projectNodes, nextState, nextTasks);
    }

    setGenerating(false);
    setMergePrompt("");
    setToast(toastMessage);
    if (type !== "merge") {
      setDraft(emptyDraft());
      setSelectedRegionId(null);
    }
    window.requestAnimationFrame(() => fitView("graph"));
  };

  const createCanvasTask = (input: {
    type: CanvasGenerationTask["type"];
    sourceNodes: ImageProjectNode[];
    instruction: string;
    regions?: CanvasGenerationTask["regions"];
    referenceImages?: CanvasGenerationTask["referenceImages"];
  }): CanvasGenerationTask => {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const createdAt = new Date().toISOString();
    const hasRegions = Boolean(input.regions?.length);
    const selectionSemantics =
      input.type === "region_edit" && !hasRegions
        ? "global_edit"
        : inferSelectionSemantics(input.instruction, input.type);
    const contextPaddingPercent =
      hasRegions && selectionSemantics === "contextual_inpaint" ? 22 : 0;

    return {
      id,
      type: input.type,
      status: "pending",
      sourceNodeIds: input.sourceNodes.map((node) => node.id),
      regions: input.regions,
      instruction: input.instruction,
      referenceImages: input.referenceImages,
      selectionSemantics,
      contextPaddingPercent,
      qualityGate: {
        status: "pending",
        minResultByteRatio:
          input.type === "region_edit" && selectionSemantics !== "global_edit"
            ? 0.35
            : 0.2
      },
      handoffChannel: "manual_handoff",
      handoffPrompt: buildManualHandoffPrompt({
        taskId: id,
        type: input.type,
        instruction: input.instruction,
        projectName: currentProjectName,
        currentVersionId:
          input.sourceNodes.length === 1
            ? input.sourceNodes[0].id
            : input.sourceNodes.map((node) => node.id).join(", "),
        sourceNodes: input.sourceNodes,
        selectionSemantics,
        hasRegions,
        regions: input.regions,
        referenceImages: input.referenceImages,
        referenceCount: input.referenceImages?.length ?? 0
      }),
      codexPrompt: buildCodexPrompt({
        taskId: id,
        type: input.type,
        sourceNodes: input.sourceNodes,
        instruction: input.instruction,
        referenceImages: input.referenceImages,
        regions: input.regions,
        selectionSemantics,
        contextPaddingPercent
      }),
      error: null,
      createdAt,
      updatedAt: createdAt
    };
  };

  const updateTaskLifecycle = async (
    taskId: string,
    update: (task: CanvasGenerationTask) => CanvasGenerationTask,
    message: string
  ) => {
    const nextTasks = tasks.map((task) =>
      task.id === taskId ? update(task) : task
    );
    setTasks(nextTasks);
    tasksRef.current = nextTasks;
    setToast(message);
    await persistProject(projectNodes, uiState, nextTasks);
  };

  const retryTask = (taskId: string) =>
    void (async () => {
      await updateTaskLifecycle(
        taskId,
        (task) => {
          const updatedAt = new Date().toISOString();
          return {
            ...task,
            status: "pending",
            error: null,
            resultNodeId: undefined,
            handoffCopiedAt: undefined,
            updatedAt
          };
        },
        "已重新准备交接指令，等待发送给 Codex。"
      );

      const task = tasksRef.current.find((candidate) => candidate.id === taskId);
      const bridge = await recordCodexBridgeTaskRequest(
        taskId,
        task?.handoffChannel ?? "manual_handoff"
      );
      setBridgeStatus(bridge);
      setToast(
        bridge?.status === "active"
          ? "已重新准备交接指令，请发送给当前 Codex 对话。"
          : "已重新准备交接指令；请启用 Pedit MCP Bridge 后发送给 Codex。"
      );
    })();

  const copyHandoffPrompt = (taskId: string) =>
    void (async () => {
      const task = tasksRef.current.find((candidate) => candidate.id === taskId);
      if (!task?.handoffPrompt) {
        setToast("当前任务没有可复制的交接指令。");
        return;
      }

      try {
        await navigator.clipboard.writeText(task.handoffPrompt);
        const copiedAt = new Date().toISOString();
        const nextTasks = tasksRef.current.map((candidate) =>
          candidate.id === taskId
            ? {
                ...candidate,
                handoffCopiedAt: copiedAt,
                updatedAt: copiedAt
              }
            : candidate
        );
        setTasks(nextTasks);
        tasksRef.current = nextTasks;
        await persistProject(projectNodes, uiState, nextTasks);
        setToast("交接指令已复制。请切回 Codex 输入框，粘贴并发送。");
      } catch {
        setToast("复制失败。请展开交接指令后手动选中复制。");
      }
    })();

  const cancelTask = (taskId: string) =>
    void (async () => {
      const remoteCancel = await cancelCodexWorkerTask(taskId);
      if (remoteCancel?.project) {
        applyRemoteProject(remoteCancel.project, { force: true });
        setToast("已取消任务，并停止本机 Codex Exec。");
        return;
      }

      await updateTaskLifecycle(
        taskId,
        (task) => ({
          ...task,
          status: "failed",
          error: "用户已取消此任务。",
          updatedAt: new Date().toISOString()
        }),
        "已取消任务。"
      );
    })();

  const exportCurrent = async () => {
    if (!currentNode) {
      return;
    }

    const fileName = safeExportFileName(currentNode.name || currentNode.id);
    const saveFilePicker = (window as Window & {
      showSaveFilePicker?: SaveFilePicker;
    }).showSaveFilePicker;

    if (typeof saveFilePicker === "function") {
      setExporting(true);

      try {
        const handle = await saveFilePicker({
          suggestedName: fileName,
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
        const writable = await handle.createWritable();
        await writable.write(await imageUrlToBlob(currentNode.imageUrl));
        await writable.close();
        setToast(`已导出到 ${handle.name}`);
        return;
      } catch (error) {
        if (isSavePickerAbort(error)) {
          return;
        }

        setToast("系统保存面板不可用，请改用本地路径导出。");
      } finally {
        setExporting(false);
      }
    }

    setExportTarget({
      nodeId: currentNode.id,
      name: currentNode.name,
      imageUrl: currentNode.imageUrl,
      filePath: `~/Downloads/${fileName}`
    });
  };

  const confirmExport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!exportTarget || exporting) {
      return;
    }

    setExporting(true);
    const result = await exportImageToPath({
      nodeId: exportTarget.nodeId,
      imageUrl: exportTarget.imageUrl,
      filePath: exportTarget.filePath
    });
    setExporting(false);

    if (result.ok) {
      setExportTarget(null);
      setToast(`已导出到 ${result.filePath}`);
      return;
    }

    setToast(`导出失败：${result.error}`);
  };

  const selectGraphNode = (event: MouseEvent<HTMLDivElement>, id: string) => {
    event.stopPropagation();
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const selected = new Set(additive ? uiState.selectedNodeIds : []);
    if (additive && selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
    const selectedIds = Array.from(selected);
    const nextState = selectNode(uiState, id, selectedIds);
    setUiState(nextState);
    setMenu(null);
    void persistProject(projectNodes, nextState);
  };

  const openNode = (id: string) => {
    const nextState = setCanvasMode(selectNode(uiState, id, [id]), "big_image_view");
    setUiState(nextState);
    setCompareMode("image");
    setMenu(null);
    void persistProject(projectNodes, nextState);
    window.requestAnimationFrame(() => fitView("detail"));
  };

  const openNodeMenu = (
    event: MouseEvent<HTMLDivElement>,
    id: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ id, x: event.clientX, y: event.clientY });
  };

  const toggleSelectFromMenu = (id: string) => {
    const selected = new Set(uiState.selectedNodeIds);
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
    const nextState = selectNode(uiState, id, Array.from(selected));
    setUiState(nextState);
    setMenu(null);
    void persistProject(projectNodes, nextState);
  };

  const renameNode = (id: string) => {
    const node = projectNodes.find((item) => item.id === id);
    const name = window.prompt("重命名节点", node?.name ?? "");
    if (!name?.trim()) {
      return;
    }

    const nextNodes = projectNodes.map((item) =>
      item.id === id ? { ...item, name: name.trim() } : item
    );
    setProjectNodes(nextNodes);
    setMenu(null);
    void persistProject(nextNodes);
  };

  const deleteCascade = (id: string) => {
    const branchIds = findBranchIds(projectNodes, id);
    if (!window.confirm(`将级联删除 ${branchIds.size} 个节点。是否继续？`)) {
      return;
    }

    const nextNodes = projectNodes.map((node) =>
      branchIds.has(node.id) ? { ...node, deleted: true } : node
    );
    const remaining = nextNodes.find((node) => !node.deleted) ?? null;
    const nextState = remaining
      ? selectNode(uiState, remaining.id, [remaining.id])
      : createCanvasUiState();
    setProjectNodes(nextNodes);
    setUiState(nextState);
    setMenu(null);
    setToast("已级联删除节点。");
    void persistProject(nextNodes, nextState);
  };

  const copyBranch = (id: string) => {
    const branchIds = findBranchIds(projectNodes, id);
    const copiedIds = new Map<string, string>();
    const stamp = Date.now();
    projectNodes.forEach((node) => {
      if (branchIds.has(node.id)) {
        copiedIds.set(node.id, `${node.id}-copy-${stamp}`);
      }
    });
    const copiedNodes = projectNodes
      .filter((node) => branchIds.has(node.id))
      .map((node) => ({
        ...node,
        id: copiedIds.get(node.id) ?? `${node.id}-copy-${stamp}`,
        name: `${node.name} Copy`,
        parentIds: node.parentIds.map((parentId) => copiedIds.get(parentId) ?? parentId),
        hidden: false,
        deleted: false,
        position: {
          x: node.position.x + 120,
          y: node.position.y + 120
        }
      }));
    const nextNodes = [...projectNodes, ...copiedNodes];
    setProjectNodes(nextNodes);
    setMenu(null);
    void persistProject(nextNodes);
  };

  const startLasso = (event: PointerEvent<HTMLDivElement>) => {
    if (!lassoActive || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    const pointerId = event.pointerId;
    const start = pointFromClient(event.clientX, event.clientY, box);
    const target = event.currentTarget;
    target.setPointerCapture?.(pointerId);
    lassoDraftPointsRef.current = [start];
    setLassoDraft({ points: [start] });

    const updateDraft = (moveEvent: globalThis.PointerEvent) => {
      const point = pointFromClient(moveEvent.clientX, moveEvent.clientY, box);
      const lastPoint = lassoDraftPointsRef.current.at(-1);

      if (
        lastPoint &&
        Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 1
      ) {
        return;
      }

      const nextPoints = [...lassoDraftPointsRef.current, point];
      lassoDraftPointsRef.current = nextPoints;
      setLassoDraft({ points: nextPoints });
    };
    const finishDraft = (upEvent: globalThis.PointerEvent) => {
      window.removeEventListener("pointermove", updateDraft);
      window.removeEventListener("pointerup", finishDraft);
      target.releasePointerCapture?.(pointerId);
      const point = pointFromClient(upEvent.clientX, upEvent.clientY, box);
      const lastPoint = lassoDraftPointsRef.current.at(-1);
      const drawnPoints =
        lastPoint && Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 1
          ? lassoDraftPointsRef.current
          : [...lassoDraftPointsRef.current, point];
      const closedPoints = closeLassoPoints(drawnPoints);
      lassoDraftPointsRef.current = [];
      setLassoDraft(null);
      if (!isUsableLasso(closedPoints)) {
        return;
      }

      setDraft((state) => {
        const index = state.regions.length + 1;
        const region = {
          id: `region-${Date.now()}`,
          name: `区域 ${index}`,
          points: closedPoints,
          prompt: ""
        };
        setSelectedRegionId(region.id);
        return { ...state, regions: [...state.regions, region] };
      });
    };
    window.addEventListener("pointermove", updateDraft);
    window.addEventListener("pointerup", finishDraft);
  };

  const deleteRegion = (id: string) => {
    setDraft((state) => ({
      ...state,
      regions: state.regions.filter((region) => region.id !== id)
    }));
    setSelectedRegionId(null);
  };

  const deleteSelectedRegion = () => {
    if (selectedRegionId) {
      deleteRegion(selectedRegionId);
    }
  };

  const undoRegion = () => {
    setDraft((state) => ({ ...state, regions: state.regions.slice(0, -1) }));
    setSelectedRegionId(null);
  };

  const onStageWheel = (event: WheelEvent<HTMLDivElement>, key: CanvasKey) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    updateCanvas(key, (canvas) => ({
      ...canvas,
      scale: clamp(canvas.scale * factor, 0.35, 2.2)
    }));
  };

  const onStagePointerDown = (
    event: PointerEvent<HTMLDivElement>,
    key: CanvasKey
  ) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("button,textarea,input,.graph-node,.mask")) {
      return;
    }
    if (target.closest(".editable-image") && lassoActive) {
      return;
    }

    event.preventDefault();
    dragRef.current = {
      key,
      startX: event.clientX,
      startY: event.clientY,
      origin: key === "graph" ? graphCanvas : detailCanvas
    };
    event.currentTarget.dataset.grabbing = "true";
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", onStagePointerMove);
    window.addEventListener("pointerup", onStagePointerUp, { once: true });
  };

  const onStagePointerMove = (event: globalThis.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }

    updateCanvas(drag.key, () => ({
      ...drag.origin,
      x: drag.origin.x + event.clientX - drag.startX,
      y: drag.origin.y + event.clientY - drag.startY
    }));
  };

  const onStagePointerUp = () => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onStagePointerMove);
    document
      .querySelectorAll<HTMLElement>(".stage")
      .forEach((stage) => delete stage.dataset.grabbing);
  };

  const updateCanvas = (
    key: CanvasKey,
    update: (canvas: CanvasTransform) => CanvasTransform
  ) => {
    if (key === "graph") {
      setGraphCanvas((canvas) => update(canvas));
      return;
    }

    setDetailCanvas((canvas) => update(canvas));
  };

  const zoomCanvas = (factor: number) => {
    const key = pageMode === "manage" ? "graph" : "detail";
    updateCanvas(key, (canvas) => ({
      ...canvas,
      scale: clamp(canvas.scale * factor, 0.35, 2.2)
    }));
  };

  const fitView = (key: CanvasKey = pageMode === "manage" ? "graph" : "detail") => {
    if (key === "graph") {
      setGraphCanvas(fitGraphCanvas(graphStageRef.current, graphNodes));
      return;
    }

    setDetailCanvas(fitDetailCanvas(detailStageRef.current, detailContentMetrics()));
  };

  const setSliderMode = (mode: "image" | "slider" | "split") => {
    setCompareMode(mode);
    window.requestAnimationFrame(() => fitView("detail"));
  };

  const stateLabel = () => {
    if (!hasProject) {
      return "空项目";
    }

    if (pageMode === "manage") {
      return "图片管理";
    }

    return detailState === "edit" ? "图片详情 - 编辑" : "图片详情 - 查看";
  };

  const canStartEdit = hasValidEdit(draft);
  const currentReferences = currentNode
    ? imageReferences(currentNode)
    : [];

  return (
    <div className="app">
      <input
        ref={projectFileInputRef}
        className="visually-hidden-file"
        type="file"
        accept="image/*"
        multiple
        aria-label="选择新项目图片"
        onChange={handleProjectFileChange}
      />
      <input
        ref={referenceFileInputRef}
        className="visually-hidden-file"
        type="file"
        accept="image/*"
        multiple
        aria-label="选择参考图片"
        onChange={handleReferenceFileChange}
      />
      <header className="topbar">
        <div className="brand">
          <div className="app-switcher">
            <button
              className="brand-button"
              type="button"
              aria-label="Pedit 项目菜单"
              aria-haspopup="menu"
              aria-expanded={appMenuOpen}
              onClick={() => {
                setAppMenuOpen((open) => !open);
                setProjectMenuOpen(false);
              }}
            >
              <div className="mark">
                <img src="/assets/pedit-icon.png" alt="" />
              </div>
              <div className="brand-copy">
                <div className="brand-title">Pedit</div>
                <div className="brand-subtitle">{stateLabel()}</div>
              </div>
            </button>
            {appMenuOpen ? (
              <div className="project-menu app-menu" role="menu" aria-label="Pedit 项目菜单">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAppMenuOpen(false);
                    setProjectLibraryOpen(true);
                    void refreshProjectLibrary();
                  }}
                >
                  项目库
                </button>
                <button type="button" role="menuitem" onClick={() => requestProjectAction("new")}>
                  新建空项目
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAppMenuOpen(false);
                    projectFileInputRef.current?.click();
                  }}
                >
                  从本地图片新建
                </button>
              </div>
            ) : null}
          </div>
          {hasProject ? (
            <div className="project-switcher">
              <button
                className="project-switcher-button"
                type="button"
                aria-haspopup="menu"
                aria-expanded={projectMenuOpen}
                onClick={() => {
                  setProjectMenuOpen((open) => !open);
                  setAppMenuOpen(false);
                }}
              >
                <span>{currentProjectName}</span>
                <span aria-hidden="true">v</span>
              </button>
              {projectMenuOpen ? (
                <div className="project-menu" role="menu" aria-label="项目管理">
                  <button type="button" role="menuitem" onClick={requestRenameProject}>
                    重命名项目
                  </button>
                  <button type="button" role="menuitem" onClick={() => requestProjectAction("reset")}>
                    重置当前项目
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <nav className="tabs" aria-label="模式切换">
          <button
            className={`tab ${pageMode === "detail" ? "active" : ""}`}
            type="button"
            aria-pressed={pageMode === "detail"}
            disabled={!hasProject}
            onClick={() => switchMode("detail")}
          >
            图片详情
          </button>
          <button
            className={`tab ${pageMode === "manage" ? "active" : ""}`}
            type="button"
            aria-pressed={pageMode === "manage"}
            disabled={!hasProject}
            onClick={() => switchMode("manage")}
          >
            图片管理
          </button>
        </nav>
        <div className="top-actions">
          <span className="status-pill">无限画布 {Math.round(activeCanvas.scale * 100)}%</span>
        </div>
      </header>

      {remoteConnection === "unavailable" ? <BackendStatusBanner /> : null}

      <main
        className="workspace"
        aria-label={`${stateLabel()}模式`}
        onClick={(event) => {
          if (menu && !(event.target as HTMLElement).closest(".node-menu")) {
            setMenu(null);
          }
          if (
            appMenuOpen &&
            !(event.target as HTMLElement).closest(".app-switcher")
          ) {
            setAppMenuOpen(false);
          }
          if (
            projectMenuOpen &&
            !(event.target as HTMLElement).closest(".project-switcher")
          ) {
            setProjectMenuOpen(false);
          }
        }}
      >
        {hasProject && currentNode ? (
          pageMode === "manage" ? (
            <section className="graph-layout">
              <div className="graph-tools">
                <button className="button" type="button" onClick={() => switchMode("detail")}>
                  返回图片详情
                </button>
                <button className="button" type="button" onClick={() => fitView("graph")}>
                  适配画布
                </button>
              </div>
              <div
                ref={graphStageRef}
                className="stage graph-stage"
                data-stage="graph"
                onWheel={(event) => onStageWheel(event, "graph")}
                onPointerDown={(event) => onStagePointerDown(event, "graph")}
              >
                <div className="stage-content" style={canvasStyle(graphCanvas)}>
                  <GraphEdges nodes={graphNodes} />
                  {graphNodes.map((node) => (
                    <GraphNode
                      key={node.id}
                      node={node}
                      selected={uiState.selectedNodeIds.includes(node.id)}
                      status={processingNodeIds.has(node.id) ? "processing" : null}
                      onSelect={selectGraphNode}
                      onOpen={openNode}
                      onMenu={openNodeMenu}
                    />
                  ))}
                </div>
              </div>
              {uiState.selectedNodeIds.length >= 2 ? (
                <div className="merge-bar">
                  <span className="merge-selection">
                    已选 {uiState.selectedNodeIds.length} 个节点
                  </span>
                  <input
                    type="text"
                    value={mergePrompt}
                    placeholder="描述你希望如何组合这些图片"
                    onChange={(event) => setMergePrompt(event.currentTarget.value)}
                  />
                  <button
                    className="button primary"
                    type="button"
                    disabled={!mergePrompt.trim()}
                    onClick={() => void startOptimize("merge")}
                  >
                    开始合并
                  </button>
                </div>
              ) : null}
            </section>
          ) : (
            <section className="detail-layout">
              <div
                ref={detailStageRef}
                className="stage"
                data-stage="detail"
                onWheel={(event) => onStageWheel(event, "detail")}
                onPointerDown={(event) => onStagePointerDown(event, "detail")}
              >
                <CanvasControls
                  onZoomOut={() => zoomCanvas(0.88)}
                  onZoomIn={() => zoomCanvas(1.12)}
                  onFit={() => fitView("detail")}
                />
                <div className="stage-content" style={canvasStyle(detailCanvas)}>
                  {detailState === "edit" ? (
                    isGroupNode(currentNode) ? (
                      <GroupBoard node={currentNode} />
                    ) : (
                      <EditableImage
                        node={currentNode}
                        lassoActive={lassoActive}
                        regions={draft.regions}
                        selectedRegionId={selectedRegionId}
                        lassoDraft={lassoDraft}
                        onStartLasso={startLasso}
                        onSelectRegion={setSelectedRegionId}
                      />
                    )
                  ) : compareMode === "split" && currentParent ? (
                    <SplitCompare parent={currentParent} node={currentNode} />
                  ) : compareMode === "slider" && currentParent ? (
                    <SliderCompare
                      parent={currentParent}
                      node={currentNode}
                      value={compareValue}
                    />
                  ) : (
                    <ImageBoard node={currentNode} label="当前图片" />
                  )}
                </div>
                {detailState === "edit" && !isGroupNode(currentNode) ? (
                  <div className="toolbar">
                    <button
                      className={lassoActive ? "active" : ""}
                      type="button"
                      onClick={() => setLassoActive((value) => !value)}
                    >
                      套索
                    </button>
                    <button
                      type="button"
                      disabled={!draft.regions.length}
                      onClick={undoRegion}
                    >
                      撤销
                    </button>
                    <button type="button" disabled>
                      重做
                    </button>
                    <button
                      type="button"
                      disabled={!selectedRegionId}
                      onClick={deleteSelectedRegion}
                    >
                      删除选区
                    </button>
                    <button type="button" onClick={requestExitEdit}>
                      退出
                    </button>
                  </div>
                ) : null}
              </div>
              <aside className="panel">
                {taskPanelTasks.length ? (
                  <ProcessingStatus
                    tasks={taskPanelTasks}
                    bridgeStatus={bridgeStatus}
                    onCancel={cancelTask}
                    onCopyHandoffPrompt={copyHandoffPrompt}
                    onRetry={retryTask}
                  />
                ) : (
                  <BridgeSetupNotice bridgeStatus={bridgeStatus} />
                )}
                {detailState === "edit" ? (
                  isGroupNode(currentNode) ? (
                    <GroupEditPanel
                      node={currentNode}
                      draft={draft}
                      canStart={Boolean(draft.wholePrompt.trim())}
                      onWholePromptChange={updateWholePrompt}
                      onAddReference={requestReferenceUpload}
                      onStart={() => void startOptimize("group")}
                      onExit={requestExitEdit}
                    />
                  ) : (
                    <SingleEditPanel
                      currentNode={currentNode}
                      draft={draft}
                      selectedRegionId={selectedRegionId}
                      canStart={canStartEdit}
                      onWholePromptChange={updateWholePrompt}
                      onAddReference={requestReferenceUpload}
                      onRegionPromptChange={updateRegionPrompt}
                      onSelectRegion={setSelectedRegionId}
                      onDeleteRegion={deleteRegion}
                      onStart={() => void startOptimize("edit")}
                      onExit={requestExitEdit}
                    />
                  )
                ) : (
                  <ViewPanel
                    node={currentNode}
                    parent={currentParent}
                    compareMode={compareMode}
                    compareValue={compareValue}
                    onCompareModeChange={setSliderMode}
                    onCompareValueChange={setCompareValue}
                    onEnterEdit={enterEdit}
                    onExport={exportCurrent}
                  />
                )}
              </aside>
              <ThumbRail
                nodes={adjacent}
                currentId={currentNode.id}
                onOpenNode={openNode}
              />
            </section>
          )
        ) : (
          <EmptyProject onUpload={createProjectFromFiles} />
        )}
      </main>

      {generating ? <GeneratingOverlay /> : null}
      {menu ? (
        <NodeContextMenu
          menu={menu}
          node={projectNodes.find((item) => item.id === menu.id) ?? null}
          selected={uiState.selectedNodeIds.includes(menu.id)}
          onOpen={openNode}
          onRename={renameNode}
          onToggleSelect={toggleSelectFromMenu}
          onCopy={copyBranch}
          onDelete={deleteCascade}
        />
      ) : null}
      {toast ? <div className="toast">{toast}</div> : null}
      {exportTarget ? (
        <ExportDialog
          target={exportTarget}
          exporting={exporting}
          onPathChange={(filePath) =>
            setExportTarget((target) => (target ? { ...target, filePath } : target))
          }
          onCancel={() => setExportTarget(null)}
          onSubmit={confirmExport}
        />
      ) : null}
      {pendingExit ? (
        <ConfirmDialog
          title="放弃当前编辑？"
          cancelLabel="继续编辑"
          confirmLabel="放弃修改"
          onCancel={() => setPendingExit(false)}
          onConfirm={() => exitEdit(true)}
        >
          当前有未提交编辑草稿。是否放弃并退出编辑？
        </ConfirmDialog>
      ) : null}
      {pendingProjectAction ? (
        <ConfirmDialog
          title={pendingProjectAction === "new" ? "新建空项目？" : "重置当前项目？"}
          cancelLabel="取消"
          confirmLabel={pendingProjectAction === "new" ? "新建项目" : "重置项目"}
          onCancel={() => setPendingProjectAction(null)}
          onConfirm={confirmProjectAction}
        >
          {pendingProjectAction === "new"
            ? "当前项目会自动保存到项目库，画布将切换到新的空项目。"
            : "重置会清空当前项目的版本树、任务记录、选区和草稿。"}
        </ConfirmDialog>
      ) : null}
      {projectLibraryOpen ? (
        <ProjectLibraryDialog
          library={projectLibrary}
          onClose={() => setProjectLibraryOpen(false)}
          onOpenProject={openProjectFromLibrary}
          onDeleteProject={requestDeleteProject}
        />
      ) : null}
      {projectRenameDraft !== null ? (
        <ProjectRenameDialog
          initialName={projectRenameDraft}
          onCancel={() => setProjectRenameDraft(null)}
          onSubmit={renameProject}
        />
      ) : null}
      {pendingProjectDelete ? (
        <ConfirmDialog
          title="删除项目？"
          cancelLabel="取消"
          confirmLabel="删除项目"
          onCancel={() => setPendingProjectDelete(null)}
          onConfirm={confirmDeleteProject}
        >
          删除“{pendingProjectDelete.name}”后将无法从项目库重新进入。
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function ProjectLibraryDialog({
  library,
  onClose,
  onOpenProject,
  onDeleteProject
}: {
  library: RemoteProjectLibrary | null;
  onClose: () => void;
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (project: RemoteProjectSummary) => void;
}) {
  const projects = library?.projects ?? [];

  return (
    <div className="confirm-backdrop">
      <section
        className="project-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-library-title"
      >
        <div className="project-library-head">
          <div>
            <h2 id="project-library-title">项目库</h2>
            <p>打开之前的版本树，或管理不再需要的项目。</p>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="project-library-list">
          {projects.length ? (
            projects.map((project) => (
              <article
                className="project-library-item"
                data-active={project.id === library?.activeProjectId}
                key={project.id}
              >
                <div className="project-library-thumb">
                  {project.thumbnailUrl ? (
                    <img src={project.thumbnailUrl} alt={project.name} />
                  ) : (
                    <span>空</span>
                  )}
                </div>
                <div className="project-library-info">
                  <strong>{project.name}</strong>
                  <span>
                    {project.nodeCount} 个版本 · {project.taskCount} 个任务 ·{" "}
                    {formatProjectTime(project.updatedAt)}
                  </span>
                </div>
                {project.id === library?.activeProjectId ? (
                  <span className="status-pill">当前</span>
                ) : null}
                <button
                  className="button"
                  type="button"
                  onClick={() => onOpenProject(project.id)}
                >
                  打开
                </button>
                <button
                  className="button danger"
                  type="button"
                  onClick={() => onDeleteProject(project)}
                >
                  删除
                </button>
              </article>
            ))
          ) : (
            <div className="project-library-empty">
              暂无已保存项目。创建或上传图片后会自动保存到这里。
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ProjectRenameDialog({
  initialName,
  onCancel,
  onSubmit
}: {
  initialName: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    onSubmit(name);
  };

  return (
    <div className="confirm-backdrop">
      <form
        className="confirm-dialog project-rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-rename-title"
        onSubmit={submit}
      >
        <h2 id="project-rename-title">重命名项目</h2>
        <label className="project-rename-field">
          <span>项目名称</span>
          <input
            aria-label="项目名称"
            autoFocus
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary-button" type="submit" disabled={!name.trim()}>
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function formatProjectTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return "未知时间";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(time));
}

function BackendStatusBanner() {
  return (
    <div className="backend-status" role="status" aria-live="polite">
      <strong>Pedit 后端未连接</strong>
      <span>
        刷新或重启 127.0.0.1:5173 后继续；当前页面只能保留本地草稿，生成任务不会自动写回。
      </span>
    </div>
  );
}

function EmptyProject({
  onUpload
}: {
  onUpload: (files: File[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length) {
      onUpload(files);
    }
    event.currentTarget.value = "";
  };

  return (
    <section className="empty">
      <div className="empty-inner">
        <div className="empty-copy">
          <h1>从图片开始编辑。</h1>
          <p>
            上传一张或多张图片，Pedit 会把它们放入同一个项目，并在画布中创建可继续编辑和分支管理的版本节点。
          </p>
        </div>
        <div className="upload-panel">
          <input
            ref={fileInputRef}
            className="visually-hidden-file"
            type="file"
            accept="image/*"
            multiple
            aria-label="选择本地图片"
            onChange={handleFileChange}
          />
          <UploadChoice
            title="上传图片"
            desc="支持一张或多张图片；多张图片会作为同一个图片组 Root。"
            onClick={() => fileInputRef.current?.click()}
          />
        </div>
      </div>
    </section>
  );
}

function UploadChoice({
  title,
  desc,
  onClick
}: {
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button className="upload-choice" type="button" aria-label={title} onClick={onClick}>
      <span>
        <span className="choice-title">{title}</span>
        <span className="choice-desc">{desc}</span>
      </span>
      <span className="button primary">开始</span>
    </button>
  );
}

function CanvasControls({
  onZoomOut,
  onZoomIn,
  onFit
}: {
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
}) {
  return (
    <div className="canvas-controls">
      <button className="icon-button" type="button" onClick={onZoomOut}>
        -
      </button>
      <button className="icon-button" type="button" onClick={onZoomIn}>
        +
      </button>
      <button className="button" type="button" onClick={onFit}>
        适配画布
      </button>
    </div>
  );
}

function ImageBoard({ node, label }: { node: ImageProjectNode; label: string }) {
  return (
    <div className="image-board" style={{ left: 180, top: 72 }}>
      <div className="image-shell">
        <span className="image-label">{label}</span>
        <AssetImage src={node.imageUrl} alt={node.name} />
      </div>
    </div>
  );
}

function AssetImage({
  src,
  alt,
  draggable
}: {
  src: string;
  alt: string;
  draggable?: boolean;
}) {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setMissing(false);
  }, [src]);

  if (missing) {
    return (
      <div className="asset-missing" role="alert">
        <strong>图片资源不可用</strong>
        <span>{alt || "当前版本图片"} 无法加载，请重新上传或切换到其他版本。</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      draggable={draggable}
      onError={() => setMissing(true)}
    />
  );
}

function EditableImage({
  node,
  lassoActive,
  regions,
  selectedRegionId,
  lassoDraft,
  onStartLasso,
  onSelectRegion
}: {
  node: ImageProjectNode;
  lassoActive: boolean;
  regions: EditRegion[];
  selectedRegionId: string | null;
  lassoDraft: LassoDraft | null;
  onStartLasso: (event: PointerEvent<HTMLDivElement>) => void;
  onSelectRegion: (id: string) => void;
}) {
  return (
    <div className="image-board" style={{ left: 180, top: 72 }}>
      <div
        className="image-shell editable-image"
        aria-label="套索圈选画布"
        data-pan-mode={!lassoActive}
        onPointerDown={onStartLasso}
      >
        <span className="image-label">
          {lassoActive ? "按住拖动手动画选区" : "拖动图片移动画布"}
        </span>
        <AssetImage src={node.imageUrl} alt={node.name} draggable={false} />
        <svg
          className="mask-layer"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {regions.map((region) => (
            <polygon
              key={region.id}
              className={`mask-polygon ${selectedRegionId === region.id ? "selected" : ""}`}
              points={formatPercentPoints(region.points)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onSelectRegion(region.id);
              }}
            />
          ))}
          {lassoDraft && lassoDraft.points.length > 1 ? (
            <polyline
              className="lasso-draft-line"
              points={formatPercentPoints(lassoDraft.points)}
            />
          ) : null}
        </svg>
        {regions.map((region) => {
          const anchor = regionLabelAnchor(region.points);

          return (
            <button
              key={region.id}
              className={`mask-label ${selectedRegionId === region.id ? "selected" : ""}`}
              style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSelectRegion(region.id);
              }}
            >
              {region.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GroupBoard({ node }: { node: ImageProjectNode }) {
  const refs = imageReferences(node);

  return (
    <div className="image-board" style={{ left: 160, top: 118 }}>
      <div className="group-board-card">
        <div className="group-board-card-title">图片组 Root</div>
        <div className="group-cards">
          {refs.map((image) => (
            <div className="group-card" key={image.url}>
              <img src={image.url} alt={image.name} />
              <div>{image.name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SplitCompare({
  parent,
  node
}: {
  parent: ImageProjectNode;
  node: ImageProjectNode;
}) {
  return (
    <div className="compare-board" style={{ left: 120, top: 72 }}>
      <div className="image-shell">
        <span className="image-label">上一版本</span>
        <AssetImage src={parent.imageUrl} alt={parent.name} />
      </div>
      <div className="image-shell">
        <span className="image-label">当前版本</span>
        <AssetImage src={node.imageUrl} alt={node.name} />
      </div>
    </div>
  );
}

function SliderCompare({
  parent,
  node,
  value
}: {
  parent: ImageProjectNode;
  node: ImageProjectNode;
  value: number;
}) {
  return (
    <div className="compare-board" style={{ left: 180, top: 72 }}>
      <div className="compare-slider">
        <img src={parent.imageUrl} alt={parent.name} />
        <div className="compare-top" style={{ width: `${value}%` }}>
          <img src={node.imageUrl} alt={node.name} />
        </div>
      </div>
    </div>
  );
}

function ViewPanel({
  node,
  parent,
  compareMode,
  compareValue,
  onCompareModeChange,
  onCompareValueChange,
  onEnterEdit,
  onExport
}: {
  node: ImageProjectNode;
  parent: ImageProjectNode | null;
  compareMode: "image" | "slider" | "split";
  compareValue: number;
  onCompareModeChange: (mode: "image" | "slider" | "split") => void;
  onCompareValueChange: (value: number) => void;
  onEnterEdit: () => void;
  onExport: () => void;
}) {
  return (
    <>
      <div className="panel-scroll">
        <div className="panel-titlebar">
          <h2>{node.name}</h2>
          <span className="status-pill">{node.parentIds.length ? "版本节点" : "Root"}</span>
        </div>
        <p>{node.summary}</p>
        <div className="panel-section">
          <div className="section-title">
            <div className="label">对比方式</div>
            <span className="status-pill">{parent ? "可对比上一版本" : "起始节点"}</span>
          </div>
          <div className="segmented">
            <button
              className={`button ${compareMode === "image" ? "primary" : ""}`}
              type="button"
              onClick={() => onCompareModeChange("image")}
            >
              当前图片
            </button>
            <button
              className={`button ${compareMode === "slider" ? "primary" : ""}`}
              type="button"
              disabled={!parent}
              onClick={() => onCompareModeChange("slider")}
            >
              滑杆
            </button>
            <button
              className={`button ${compareMode === "split" ? "primary" : ""}`}
              type="button"
              disabled={!parent}
              onClick={() => onCompareModeChange("split")}
            >
              左右并排
            </button>
          </div>
          {compareMode === "slider" && parent ? (
            <input
              className="compare-range"
              type="range"
              min="12"
              max="88"
              value={compareValue}
              aria-label="对比位置"
              onChange={(event) => onCompareValueChange(Number(event.currentTarget.value))}
            />
          ) : null}
        </div>
        <div className="panel-section">
          <div className="label">操作</div>
          <button className="button primary" type="button" onClick={onEnterEdit}>
            进入编辑
          </button>
          <button className="button" type="button" onClick={onExport}>
            导出当前图片
          </button>
        </div>
      </div>
    </>
  );
}

function SingleEditPanel({
  currentNode,
  draft,
  selectedRegionId,
  canStart,
  onWholePromptChange,
  onAddReference,
  onRegionPromptChange,
  onSelectRegion,
  onDeleteRegion,
  onStart,
  onExit
}: {
  currentNode: ImageProjectNode;
  draft: EditDraft;
  selectedRegionId: string | null;
  canStart: boolean;
  onWholePromptChange: (value: string) => void;
  onAddReference: () => void;
  onRegionPromptChange: (id: string, value: string) => void;
  onSelectRegion: (id: string) => void;
  onDeleteRegion: (id: string) => void;
  onStart: () => void;
  onExit: () => void;
}) {
  return (
    <>
      <div className="panel-scroll">
        <div className="panel-titlebar">
          <h2>编辑 Inspector</h2>
          <span className="status-pill">{draft.regions.length} 个区域</span>
        </div>
        <div className="panel-section">
          <div className="label">整图要求</div>
          <textarea
            placeholder="例如：把背景处理得更干净，保留人物主体。"
            value={draft.wholePrompt}
            onChange={(event) => onWholePromptChange(event.currentTarget.value)}
          />
        </div>
        <div className="panel-section">
          <div className="section-title">
            <div className="label">参考图片</div>
            <button className="button" type="button" onClick={onAddReference}>
              上传参考图
            </button>
          </div>
          <div className="reference-list">
            {draft.references.length ? (
              draft.references.map((ref) => <ReferenceCard key={ref.url} refImage={ref} />)
            ) : (
              <span className="status-pill">暂无参考图</span>
            )}
          </div>
        </div>
        {draft.regions.length ? (
          <div className="panel-section">
            <div className="label">区域修改</div>
            {draft.regions.map((region) => (
              <div
                className="region-editor"
                data-selected={selectedRegionId === region.id}
                key={region.id}
                onClick={() => onSelectRegion(region.id)}
              >
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <strong>{region.name}</strong>
                  <span className="region-geometry">
                    {formatRegionGeometry(region.points)}
                  </span>
                  <button
                    className="button danger"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteRegion(region.id);
                    }}
                  >
                    删除
                  </button>
                </div>
                <textarea
                  placeholder="描述这个区域要怎么改"
                  value={region.prompt}
                  onChange={(event) =>
                    onRegionPromptChange(region.id, event.currentTarget.value)
                  }
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="panel-footer">
        <button
          className="button primary"
          type="button"
          disabled={!canStart}
          onClick={onStart}
        >
          开始优化
        </button>
        <button className="button" type="button" onClick={onExit}>
          退出编辑
        </button>
      </div>
    </>
  );
}

function GroupEditPanel({
  node,
  draft,
  canStart,
  onWholePromptChange,
  onAddReference,
  onStart,
  onExit
}: {
  node: ImageProjectNode;
  draft: EditDraft;
  canStart: boolean;
  onWholePromptChange: (value: string) => void;
  onAddReference: () => void;
  onStart: () => void;
  onExit: () => void;
}) {
  const refs = imageReferences(node);

  return (
    <>
      <div className="panel-scroll">
        <div className="panel-titlebar">
          <h2>图片组生成</h2>
          <span className="status-pill">{refs.length} 输入</span>
        </div>
        <p>图片组 Root 不支持局部圈选，可根据自然语言组合生成一张新图。</p>
        <div className="panel-section">
          <div className="label">图片组</div>
          <div className="reference-list">
            {refs.map((ref) => <ReferenceCard key={ref.url} refImage={ref} />)}
          </div>
        </div>
        <div className="panel-section">
          <div className="label">生成要求</div>
          <textarea
            placeholder="例如：让人物抱着小猫坐在沙发上看电视，画面自然真实。"
            value={draft.wholePrompt}
            onChange={(event) => onWholePromptChange(event.currentTarget.value)}
          />
        </div>
        <div className="panel-section">
          <div className="label">继续添加参考图</div>
          <button className="button" type="button" onClick={onAddReference}>
            上传参考图
          </button>
          <div className="reference-list">
            {draft.references.length ? (
              draft.references.map((ref) => <ReferenceCard key={ref.url} refImage={ref} />)
            ) : (
              <span className="status-pill">暂无新增参考图</span>
            )}
          </div>
        </div>
      </div>
      <div className="panel-footer">
        <button
          className="button primary"
          type="button"
          disabled={!canStart}
          onClick={onStart}
        >
          开始优化
        </button>
        <button className="button" type="button" onClick={onExit}>
          退出编辑
        </button>
      </div>
    </>
  );
}

function ReferenceCard({ refImage }: { refImage: ReferenceImage }) {
  return (
    <div className="reference">
      <img src={refImage.url} alt={refImage.name} />
      <span>{refImage.name}</span>
    </div>
  );
}

function ThumbRail({
  nodes,
  currentId,
  onOpenNode
}: {
  nodes: ImageProjectNode[];
  currentId: string;
  onOpenNode: (id: string) => void;
}) {
  return (
    <div className="thumb-rail">
      {nodes.map((node) => (
        <button
          className={`thumb ${node.id === currentId ? "active" : ""}`}
          key={node.id}
          type="button"
          onClick={() => onOpenNode(node.id)}
        >
          <img src={node.imageUrl} alt={node.name} />
          <span>
            <span className="thumb-title">{node.name}</span>
            <span className="thumb-meta">{node.parentIds.length ? "相邻节点" : "Root"}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function GraphEdges({ nodes }: { nodes: ImageProjectNode[] }) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const segments: Array<{
    id: string;
    d: string;
    x: number;
    y: number;
    merge: boolean;
  }> = [];

  nodes.forEach((node) => {
    node.parentIds.forEach((parentId) => {
      const parent = nodeMap.get(parentId);
      if (!parent) {
        return;
      }

      const parentHeight = isGroupNode(parent) ? 190 : 184;
      const x1 = parent.position.x + 104;
      const y1 = parent.position.y + parentHeight;
      const x2 = node.position.x + 104;
      const y2 = node.position.y;
      const gap = Math.max(36, y2 - y1);
      const jointY = Math.round(y1 + Math.max(32, Math.min(82, gap * 0.45)));
      const d =
        Math.abs(x2 - x1) < 2
          ? `M ${x1} ${y1} L ${x2} ${y2}`
          : steppedEdgePath(x1, y1, x2, y2, jointY);
      segments.push({
        id: `${parentId}-${node.id}`,
        d,
        x: x2,
        y: y2,
        merge: node.parentIds.length > 1
      });
    });
  });

  return (
    <svg className="edge-layer" width="2400" height="1800" aria-hidden="true">
      {segments.map((segment) => (
        <g key={segment.id}>
          <path className={`edge-path${segment.merge ? " merge-edge" : ""}`} d={segment.d} />
          <circle
            className={`edge-end${segment.merge ? " merge-end" : ""}`}
            cx={segment.x}
            cy={segment.y}
            r="3.2"
          />
        </g>
      ))}
    </svg>
  );
}

function GraphNode({
  node,
  selected,
  status,
  onSelect,
  onOpen,
  onMenu
}: {
  node: ImageProjectNode;
  selected: boolean;
  status: "processing" | null;
  onSelect: (event: MouseEvent<HTMLDivElement>, id: string) => void;
  onOpen: (id: string) => void;
  onMenu: (event: MouseEvent<HTMLDivElement>, id: string) => void;
}) {
  const group = isGroupNode(node);
  const kindLabel = group ? "图片组 Root" : node.parentIds.length ? "版本节点" : "Root";
  const parentLabel = node.parentIds.length ? `${node.parentIds.length} 输入` : "起点";

  return (
    <div
      className={`graph-node ${group ? "group-node" : "image-node"} ${node.parentIds.length ? "" : "root-node"} ${selected ? "selected" : ""}`}
      style={{ left: node.position.x, top: node.position.y }}
      onClick={(event) => onSelect(event, node.id)}
      onDoubleClick={() => onOpen(node.id)}
      onContextMenu={(event) => onMenu(event, node.id)}
    >
      <span className="node-port node-port-in" />
      <span className="node-port node-port-out" />
      <div className="node-header">
        <span className="node-type-dot" />
        <span className="node-name">{node.name}</span>
        {status === "processing" ? (
          <span className="node-status">处理中</span>
        ) : null}
      </div>
      <div className="node-preview">
        {group ? (
          <div className="graph-group">
            <div className="graph-group-grid">
              {imageReferences(node).map((image) => (
                <img src={image.url} alt={image.name} key={image.url} />
              ))}
            </div>
          </div>
        ) : (
          <img src={node.imageUrl} alt={node.name} />
        )}
      </div>
      <div className="node-kind">
        <span>{kindLabel}</span>
        <span>{parentLabel}</span>
      </div>
    </div>
  );
}

function NodeContextMenu({
  menu,
  node,
  selected,
  onOpen,
  onRename,
  onToggleSelect,
  onCopy,
  onDelete
}: {
  menu: NodeMenu;
  node: ImageProjectNode | null;
  selected: boolean;
  onOpen: (id: string) => void;
  onRename: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!node) {
    return null;
  }

  return (
    <div
      className="node-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" onClick={() => onOpen(node.id)}>
        查看大图
      </button>
      <button type="button" onClick={() => onRename(node.id)}>
        重命名
      </button>
      <button type="button" onClick={() => onToggleSelect(node.id)}>
        {selected ? "取消选中" : "选中"}
      </button>
      <button type="button" onClick={() => onCopy(node.id)}>
        复制分支
      </button>
      <button type="button" onClick={() => onDelete(node.id)}>
        删除
      </button>
    </div>
  );
}

function GeneratingOverlay() {
  return (
    <div className="overlay">
      <div className="modal">
        <h2>正在理解图片与需求</h2>
        <p>正在分析图像内容、选区、参考图和自然语言要求，并生成新的版本节点。</p>
        <div className="progress">
          <span />
        </div>
      </div>
    </div>
  );
}

const staleTaskThresholdMs = 2 * 60 * 1000;

function BridgeSetupNotice({
  bridgeStatus
}: {
  bridgeStatus: CodexBridgeStatus | null;
}) {
  if (bridgeStatus?.status === "active") {
    return (
      <div className="processing-status" data-status="idle" role="status">
        <span className="processing-dot" />
        <div className="processing-copy">
          <strong>Codex MCP Bridge 已连接</strong>
          <span>
            图片优化任务会通过 Pedit MCP 暴露给 Codex，并使用你自己的 Codex 能力与额度处理。
          </span>
          <em>
            pedit-mcp
            {bridgeStatus.lastMcpToolName ? ` · ${bridgeStatus.lastMcpToolName}` : ""}
          </em>
        </div>
      </div>
    );
  }

  return (
    <div className="processing-status" data-status="unavailable" role="status">
      <span className="processing-dot" />
      <div className="processing-copy">
        <strong>当前未连接 Codex Bridge。</strong>
        <span>
          {bridgeStatus?.message ??
            "Pedit MCP Server 可用，但当前 Codex 线程尚未暴露原生 pedit_* 工具。请新开 Codex 线程或重启 Codex；当前线程也可以复制交接指令，由 Codex 使用 CLI fallback 继续处理。"}
        </span>
        <em>pedit-mcp · 未连接</em>
      </div>
    </div>
  );
}

function ProcessingStatus({
  tasks,
  bridgeStatus,
  onCancel,
  onCopyHandoffPrompt,
  onRetry
}: {
  tasks: CanvasGenerationTask[];
  bridgeStatus: CodexBridgeStatus | null;
  onCancel: (taskId: string) => void;
  onCopyHandoffPrompt: (taskId: string) => void;
  onRetry: (taskId: string) => void;
}) {
  const latest = tasks[tasks.length - 1];
  const latestUpdatedAt = latest ? Date.parse(latest.updatedAt || latest.createdAt) : 0;
  const stale =
    latest?.status === "pending" &&
    Number.isFinite(latestUpdatedAt) &&
    Date.now() - latestUpdatedAt > staleTaskThresholdMs;
  const running = latest?.status === "running";
  const failed = latest?.status === "failed";
  const bridgeActive = bridgeStatus?.status === "active";
  const bridgeUnavailableMessage =
    bridgeStatus?.message ??
    "当前未连接 Codex Bridge：Pedit MCP Server 可用，但当前 Codex 线程尚未暴露原生 pedit_* 工具。请新开 Codex 线程或重启 Codex；当前线程也可以复制交接指令，由 Codex 使用 CLI fallback 继续处理。";
  const canCopyHandoff = latest?.status === "pending" && Boolean(latest.handoffPrompt);
  const pendingTasks = tasks.filter((task) => task.status === "pending");
  const queueIndex =
    latest?.status === "pending"
      ? pendingTasks.findIndex((task) => task.id === latest.id) + 1
      : 0;
  const statusText = failed
    ? "可重试"
    : stale
      ? "等待接手"
      : running
        ? latest?.workerStage === "cancelling"
          ? "取消中"
          : "生成中"
    : "等待发送";
  const typeText =
    latest?.type === "multi_node_merge"
      ? "多图生成"
      : latest?.type === "text_to_image"
        ? "文字生图"
        : "局部优化";
  const steps = [
    { label: "已提交", active: Boolean(latest), done: Boolean(latest) },
    {
      label: "发送指令",
      active: latest?.status === "running",
      done: latest?.status === "running" || latest?.status === "succeeded"
    },
    {
      label: "生成处理",
      active: latest?.status === "running" && latest?.workerStage !== "validating",
      done: latest?.status === "succeeded"
    },
    {
      label: "写回画布",
      active: latest?.status === "running" && latest?.workerStage === "validating",
      done: latest?.status === "succeeded"
    }
  ];
  const runningForMs =
    latest?.status === "running" && latest.workerStartedAt
      ? Math.max(0, Date.now() - Date.parse(latest.workerStartedAt))
      : 0;
  const runningMinutes = Math.floor(runningForMs / 60_000);
  const runningSeconds = Math.floor((runningForMs % 60_000) / 1000);
  const runningDuration =
    latest?.status === "running" && latest.workerStartedAt
      ? `${runningMinutes}:${String(runningSeconds).padStart(2, "0")}`
      : "";

  return (
    <div
      className="processing-status"
      data-status={latest?.status ?? "idle"}
      role="status"
      aria-live="polite"
    >
      <span className="processing-dot" />
      <div className="processing-copy">
        <strong>
          {failed
            ? "任务未完成"
            : stale
              ? "等待你复制并发送给 Codex"
              : running
                ? "Codex 正在处理图片"
                : "等待你复制并发送给 Codex"}
        </strong>
        <span>
          {failed
            ? latest?.error || "任务失败。可以重试，或取消后重新圈选提交。"
            : stale
              ? bridgeActive
                ? "交接指令已准备，但任务超过 2 分钟未被 claim。请复制交接指令，粘贴到 Codex 输入框并发送；Pedit 会自动监听写回结果。"
                : bridgeUnavailableMessage
              : running
                ? latest?.workerMessage
                  ? `${latest.workerMessage}${runningDuration ? ` · 已运行 ${runningDuration}` : ""}`
                  : "Codex 已接手任务，正在使用当前 Codex 能力处理。完成并通过校验后会写回画布。"
                : bridgeActive
                  ? `交接指令已准备。请先复制，再粘贴到 Codex 输入框并发送；Codex 通过 Pedit MCP claim 后会优先尝试本地高保真处理，必要时再调用 image2，Pedit 会自动监听写回结果。${
                      queueIndex && pendingTasks.length > 1 ? `当前待处理第 ${queueIndex} 个。` : ""
                    }`
                  : bridgeUnavailableMessage}
        </span>
        {canCopyHandoff && latest?.handoffPrompt ? (
          <div className="handoff-guide" aria-label="Codex 交接步骤">
            <div className="handoff-guide-head">
              <span>下一步</span>
              <strong>把交接指令发送给 Codex</strong>
            </div>
            <ol className="handoff-steps">
              <li>
                <span>1</span>
                <p>点击复制</p>
              </li>
              <li>
                <span>2</span>
                <p>粘贴到 Codex 输入框</p>
              </li>
              <li>
                <span>3</span>
                <p>发送后等待写回</p>
              </li>
            </ol>
            <button
              className="handoff-copy-button"
              type="button"
              onClick={() => onCopyHandoffPrompt(latest.id)}
            >
              复制交接指令
            </button>
            <details className="handoff-prompt">
              <summary>查看将发送的交接指令</summary>
              <pre>{latest.handoffPrompt}</pre>
            </details>
          </div>
        ) : null}
        <div className="task-steps" aria-label="任务进度">
          {steps.map((step) => (
            <span
              className="task-step"
              data-active={step.active}
              data-done={step.done}
              key={step.label}
            >
              {step.label}
            </span>
          ))}
        </div>
        {latest ? (
          <em>
            {typeText} · {statusText}
            {bridgeStatus?.automationId ? ` · ${bridgeStatus.automationId}` : ""}
          </em>
        ) : null}
        {latest ? (
          <div className="task-actions">
            {latest.status === "failed" || stale ? (
              <button type="button" onClick={() => onRetry(latest.id)}>
                {latest.status === "failed" ? "重试任务" : "重新准备交接"}
              </button>
            ) : null}
            {latest.status === "pending" || latest.status === "running" ? (
              <button type="button" onClick={() => onCancel(latest.id)}>
                取消任务
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ExportDialog({
  target,
  exporting,
  onPathChange,
  onCancel,
  onSubmit
}: {
  target: ExportTarget;
  exporting: boolean;
  onPathChange: (filePath: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="confirm-backdrop">
      <form
        className="confirm-dialog export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onSubmit={onSubmit}
      >
        <h2 id="export-dialog-title">导出当前图片</h2>
        <p>输入本地保存路径。支持使用 ~/Downloads 这类路径。</p>
        <label className="export-path-field">
          <span>本地路径</span>
          <input
            value={target.filePath}
            onChange={(event) => onPathChange(event.currentTarget.value)}
            autoFocus
          />
        </label>
        <div className="confirm-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={exporting}
            onClick={onCancel}
          >
            取消
          </button>
          <button className="primary-button" type="submit" disabled={exporting || !target.filePath.trim()}>
            {exporting ? "导出中" : "导出"}
          </button>
        </div>
      </form>
    </div>
  );
}

function layoutProjectNodes(nodes: ImageProjectNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depthMemo = new Map<string, number>();

  const depthOf = (node: ImageProjectNode): number => {
    const cached = depthMemo.get(node.id);
    if (cached !== undefined) {
      return cached;
    }

    if (!node.parentIds.length) {
      depthMemo.set(node.id, 0);
      return 0;
    }

    const parentDepths = node.parentIds
      .map((parentId) => byId.get(parentId))
      .filter((parent): parent is ImageProjectNode => parent !== undefined)
      .map((parent) => depthOf(parent));
    const depth = (parentDepths.length ? Math.max(...parentDepths) : 0) + 1;
    depthMemo.set(node.id, depth);
    return depth;
  };

  nodes.forEach(depthOf);
  const layers = new Map<number, ImageProjectNode[]>();
  nodes.forEach((node) => {
    const depth = depthMemo.get(node.id) ?? 0;
    const layer = layers.get(depth) ?? [];
    layer.push(node);
    layers.set(depth, layer);
  });

  const xGap = 292;
  const yGap = 254;
  const baseY = 44;
  const centerX = 650;
  const positioned = new Map<string, ImageProjectNode>();

  [...layers.keys()].sort((a, b) => a - b).forEach((depth) => {
    const layer = [...(layers.get(depth) ?? [])];
    layer.sort((left, right) => parentCenter(left, positioned) - parentCenter(right, positioned));
    const startX = centerX - ((layer.length - 1) * xGap) / 2;
    layer.forEach((node, index) => {
      const parentXs = node.parentIds
        .map((parentId) => positioned.get(parentId)?.position.x)
        .filter((x): x is number => typeof x === "number");
      const averagedParentX = parentXs.length
        ? parentXs.reduce((sum, x) => sum + x, 0) / parentXs.length
        : startX + index * xGap;
      positioned.set(node.id, {
        ...node,
        position: {
          x: Math.round((startX + index * xGap + averagedParentX) / 2),
          y: baseY + depth * yGap
        }
      });
    });

    const sortedLayer = layer
      .map((node) => positioned.get(node.id))
      .filter((node): node is ImageProjectNode => node !== undefined)
      .sort((left, right) => left.position.x - right.position.x);

    for (let index = 1; index < sortedLayer.length; index += 1) {
      const previous = sortedLayer[index - 1];
      const current = sortedLayer[index];
      const minX = previous.position.x + xGap;
      if (current.position.x < minX) {
        const next = {
          ...current,
          position: { ...current.position, x: minX }
        };
        positioned.set(current.id, next);
        sortedLayer[index] = next;
      }
    }
  });

  return nodes.map((node) => positioned.get(node.id) ?? node);
}

function parentCenter(
  node: ImageProjectNode,
  positioned: Map<string, ImageProjectNode>
) {
  if (!node.parentIds.length) {
    return 650;
  }

  const xs = node.parentIds
    .map((parentId) => positioned.get(parentId)?.position.x)
    .filter((x): x is number => typeof x === "number");

  return xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : node.position.x;
}

function findPrimaryParent(
  nodes: ImageProjectNode[],
  node: ImageProjectNode | null
) {
  if (!node?.parentIds.length) {
    return null;
  }

  return findImageNode(nodes, node.parentIds[0]);
}

function adjacentNodes(nodes: ImageProjectNode[], node: ImageProjectNode | null) {
  if (!node) {
    return [];
  }

  const ids = new Set<string>([node.id]);
  node.parentIds.forEach((id) => ids.add(id));
  nodes
    .filter((child) => !child.deleted && child.parentIds.includes(node.id))
    .forEach((child) => ids.add(child.id));
  node.parentIds.forEach((parentId) => {
    nodes
      .filter((sibling) => !sibling.deleted && sibling.parentIds.includes(parentId))
      .forEach((sibling) => ids.add(sibling.id));
  });

  return nodes.filter((item) => ids.has(item.id) && !item.deleted);
}

function isGroupNode(node: ImageProjectNode) {
  return node.kind === "source" && Boolean(node.referenceImageUrls?.length);
}

function imageReferences(node: ImageProjectNode): ReferenceImage[] {
  if (node.referenceImageUrls?.length) {
    return node.referenceImageUrls.map((url, index) => ({
      name:
        node.referenceImageNames?.[index] ??
        (index === 0 ? "人物照片" : index === 1 ? "小猫参考" : `参考图 ${index + 1}`),
      url
    }));
  }

  return [{ name: node.name, url: node.imageUrl }];
}

function safeExportFileName(name: string) {
  const baseName = name
    .trim()
    .replace(/[/:\\?%*"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);

  return `${baseName || "pedit-image"}.png`;
}

async function imageUrlToBlob(imageUrl: string): Promise<Blob> {
  if (imageUrl.startsWith("data:")) {
    const commaIndex = imageUrl.indexOf(",");
    if (commaIndex === -1) {
      throw new Error("图片数据格式不正确。");
    }

    const meta = imageUrl.slice(0, commaIndex);
    const data = imageUrl.slice(commaIndex + 1);
    const mime = /data:([^;,]+)/.exec(meta)?.[1] ?? "application/octet-stream";

    if (meta.includes(";base64")) {
      const binary = window.atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      return new Blob([bytes], { type: mime });
    }

    return new Blob([decodeURIComponent(data)], { type: mime });
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error("无法读取当前图片。");
  }

  return response.blob();
}

function isSavePickerAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function hasDraftChanges(draft: EditDraft) {
  return Boolean(
    draft.wholePrompt.trim() ||
      draft.regions.length ||
      draft.references.length
  );
}

function hasValidEdit(draft: EditDraft) {
  return Boolean(
    draft.wholePrompt.trim() ||
      draft.regions.some((region) => region.prompt.trim()) ||
      (draft.references.length && draft.wholePrompt.trim())
  );
}

function pointFromClient(
  clientX: number,
  clientY: number,
  box: DOMRect
): { x: number; y: number } {
  return {
    x: clamp(((clientX - box.left) / box.width) * 100, 0, 100),
    y: clamp(((clientY - box.top) / box.height) * 100, 0, 100)
  };
}

function closeLassoPoints(points: EditRegion["points"]): EditRegion["points"] {
  if (points.length < 2) {
    return points;
  }

  const start = points[0];
  const last = points[points.length - 1];

  if (Math.hypot(start.x - last.x, start.y - last.y) < 1) {
    return points;
  }

  return [...points, start];
}

function isUsableLasso(points: EditRegion["points"]) {
  if (points.length < 4) {
    return false;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return Math.max(...xs) - Math.min(...xs) >= 4 && Math.max(...ys) - Math.min(...ys) >= 4;
}

function formatPercentPoints(points: EditRegion["points"]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function formatRegionGeometry(points: EditRegion["points"]) {
  const bounds = getRegionBounds(points);
  const centerX = Math.round((bounds.x + bounds.width / 2) * 10) / 10;
  const centerY = Math.round((bounds.y + bounds.height / 2) * 10) / 10;

  return `中心 ${centerX}%, ${centerY}% · ${bounds.width}% × ${bounds.height}%`;
}

function regionLabelAnchor(points: EditRegion["points"]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    x: Math.min(...xs),
    y: Math.min(...ys)
  };
}

function canvasStyle(canvas: CanvasTransform) {
  return {
    transform: `translate(${canvas.x}px, ${canvas.y}px) scale(${canvas.scale})`
  };
}

function detailContentMetrics() {
  return { left: 120, top: 72, w: 858, h: 520 };
}

function fitDetailCanvas(
  stage: HTMLDivElement | null,
  metrics: { left: number; top: number; w: number; h: number }
): CanvasTransform {
  const rect = stage?.getBoundingClientRect();
  if (!rect) {
    return defaultCanvas();
  }

  const scale = Math.min(
    1.15,
    Math.max(0.42, Math.min((rect.width - 96) / metrics.w, (rect.height - 96) / metrics.h))
  );

  return {
    x: (rect.width - metrics.w * scale) / 2 - metrics.left * scale,
    y: (rect.height - metrics.h * scale) / 2 - metrics.top * scale,
    scale
  };
}

function fitGraphCanvas(
  stage: HTMLDivElement | null,
  nodes: ImageProjectNode[]
): CanvasTransform {
  const rect = stage?.getBoundingClientRect();
  if (!rect || nodes.length === 0) {
    return { x: 120, y: 96, scale: 1 };
  }

  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + 208));
  const maxY = Math.max(
    ...nodes.map((node) => node.position.y + (isGroupNode(node) ? 190 : 184))
  );
  const width = maxX - minX;
  const height = maxY - minY;
  const scale = Math.min(
    1.1,
    Math.max(0.4, Math.min((rect.width - 160) / width, (rect.height - 170) / height))
  );

  return {
    x: (rect.width - width * scale) / 2 - minX * scale,
    y: (rect.height - height * scale) / 2 - minY * scale,
    scale
  };
}

function steppedEdgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  jointY: number
) {
  const direction = x2 > x1 ? 1 : -1;
  const radius = Math.min(10, Math.abs(x2 - x1) / 2, Math.max(6, (y2 - y1) / 5));

  return [
    `M ${x1} ${y1}`,
    `L ${x1} ${jointY - radius}`,
    `Q ${x1} ${jointY} ${x1 + direction * radius} ${jointY}`,
    `L ${x2 - direction * radius} ${jointY}`,
    `Q ${x2} ${jointY} ${x2} ${jointY + radius}`,
    `L ${x2} ${y2}`
  ].join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error(`Unable to read image file ${file.name}.`));
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function findNewlyCompletedResultNodeId(
  previousTasks: CanvasGenerationTask[],
  project: RemoteCanvasProject
) {
  const previousStatus = new Map(
    previousTasks.map((task) => [task.id, task.status])
  );
  const resultNodeIds = new Set(project.nodes.map((node) => node.id));

  return [...project.tasks]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .find(
      (task) =>
        task.status === "succeeded" &&
        task.resultNodeId &&
        resultNodeIds.has(task.resultNodeId) &&
        previousStatus.get(task.id) !== "succeeded"
    )?.resultNodeId;
}

function loadStoredCanvasState(): CanvasUiState {
  const state = createCanvasUiState();

  if (typeof window === "undefined") {
    return state;
  }

  try {
    const rawState = window.localStorage.getItem(canvasStateStorageKey);
    return rawState
      ? applyCanvasStateSnapshot(
          state,
          JSON.parse(rawState) as Partial<CanvasStateSnapshot>
        )
      : state;
  } catch {
    return state;
  }
}

function saveStoredCanvasState(state: CanvasUiState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      canvasStateStorageKey,
      JSON.stringify({
        mode: state.mode,
        currentNodeId: state.currentNodeId,
        selectedNodeIds: state.selectedNodeIds,
        showHiddenNodes: state.showHiddenNodes
      } satisfies CanvasStateSnapshot)
    );
  } catch {
    // The remote project state is still usable if browser storage is full.
  }
}
