export type CanvasMode = "big_image_view" | "big_image_edit" | "version";

export interface CanvasUiState {
  mode: CanvasMode;
  locked: boolean;
  currentNodeId: string | null;
  selectedNodeIds: string[];
  showHiddenNodes: boolean;
}

export interface CanvasStateSnapshot {
  mode: CanvasMode;
  currentNodeId: string | null;
  selectedNodeIds: string[];
  showHiddenNodes: boolean;
}

export interface PeditClient {
  getCanvasState(): Promise<unknown>;
  createPendingTask(input: unknown): Promise<unknown>;
  exportCurrentImage(): Promise<unknown>;
}

export function createCanvasUiState(
  overrides: Partial<CanvasUiState> = {}
): CanvasUiState {
  return {
    mode: "big_image_view",
    locked: false,
    currentNodeId: null,
    selectedNodeIds: [],
    showHiddenNodes: false,
    ...overrides
  };
}

export function setCanvasMode(
  state: CanvasUiState,
  mode: CanvasMode
): CanvasUiState {
  return {
    ...state,
    mode
  };
}

export function setCanvasLocked(
  state: CanvasUiState,
  locked: boolean
): CanvasUiState {
  return {
    ...state,
    locked
  };
}

export function selectNode(
  state: CanvasUiState,
  nodeId: string,
  selectedNodeIds: string[] = [nodeId]
): CanvasUiState {
  return {
    ...state,
    currentNodeId: nodeId,
    selectedNodeIds
  };
}

export function clearCurrentNode(state: CanvasUiState): CanvasUiState {
  return {
    ...state,
    currentNodeId: null,
    selectedNodeIds: []
  };
}

export function toggleShowHiddenNodes(state: CanvasUiState): CanvasUiState {
  return {
    ...state,
    showHiddenNodes: !state.showHiddenNodes
  };
}

export function toCanvasStateSnapshot(
  state: CanvasUiState
): CanvasStateSnapshot {
  return {
    mode: state.mode,
    currentNodeId: state.currentNodeId,
    selectedNodeIds: [...state.selectedNodeIds],
    showHiddenNodes: state.showHiddenNodes
  };
}

export function applyCanvasStateSnapshot(
  state: CanvasUiState,
  snapshot: Partial<CanvasStateSnapshot>
): CanvasUiState {
  return {
    ...state,
    mode: snapshot.mode ?? state.mode,
    currentNodeId:
      snapshot.currentNodeId === undefined
        ? state.currentNodeId
        : snapshot.currentNodeId,
    selectedNodeIds: snapshot.selectedNodeIds
      ? [...snapshot.selectedNodeIds]
      : state.selectedNodeIds,
    showHiddenNodes: snapshot.showHiddenNodes ?? state.showHiddenNodes
  };
}
