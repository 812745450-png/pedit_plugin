import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  LassoCanvas,
  LassoRegionDraft
} from "../components/LassoCanvas";
import { RegionPanel } from "../components/RegionPanel";
import { Toolbar } from "../components/Toolbar";

export type { LassoRegionDraft } from "../components/LassoCanvas";

interface BigImageEditProps {
  currentNodeId: string | null;
  imageUrl?: string;
  locked: boolean;
  initialState?: BigImageEditState;
  onExitEdit?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onStartEdit?: (input: {
    globalInstruction: string;
    regions: LassoRegionDraft[];
  }) => void;
}

interface EditSnapshot {
  regions: LassoRegionDraft[];
  selectedRegionId: string | null;
  nextRegionNumber: number;
}

export interface BigImageEditState extends EditSnapshot {
  globalInstruction: string;
  undoStack: EditSnapshot[];
  redoStack: EditSnapshot[];
  showExitConfirm: boolean;
  submitStatus: "idle" | "running";
}

const regionColors = ["#55f0c2", "#f6c85f", "#8aa4ff", "#f58bb5"];

export function createBigImageEditState(): BigImageEditState {
  return {
    regions: [],
    globalInstruction: "",
    selectedRegionId: null,
    nextRegionNumber: 1,
    undoStack: [],
    redoStack: [],
    showExitConfirm: false,
    submitStatus: "idle"
  };
}

export function createLassoRegion(
  regionNumber: number,
  points: LassoRegionDraft["points"]
): LassoRegionDraft | null {
  if (!isValidLassoPolygon(points)) {
    return null;
  }

  return {
    id: `region-${regionNumber}`,
    label: `区域 ${regionNumber}`,
    points,
    color: regionColors[(regionNumber - 1) % regionColors.length],
    instruction: ""
  };
}

export function addLassoRegion(
  state: BigImageEditState,
  region: LassoRegionDraft | null
): BigImageEditState {
  if (!region) {
    return state;
  }

  return withHistory(state, {
    regions: [...state.regions, region],
    selectedRegionId: region.id,
    nextRegionNumber: state.nextRegionNumber + 1
  });
}

export function setRegionInstruction(
  state: BigImageEditState,
  regionId: string,
  instruction: string
): BigImageEditState {
  const currentRegion = state.regions.find((region) => region.id === regionId);

  if (!currentRegion || currentRegion.instruction === instruction) {
    return state;
  }

  return withHistory(state, {
    regions: state.regions.map((region) =>
      region.id === regionId ? { ...region, instruction } : region
    ),
    selectedRegionId: regionId,
    nextRegionNumber: state.nextRegionNumber
  });
}

export function selectRegion(
  state: BigImageEditState,
  regionId: string
): BigImageEditState {
  if (!state.regions.some((region) => region.id === regionId)) {
    return state;
  }

  return {
    ...state,
    selectedRegionId: regionId
  };
}

export function deleteSelectedRegion(
  state: BigImageEditState
): BigImageEditState {
  if (!state.selectedRegionId) {
    return state;
  }

  const nextRegions = state.regions.filter(
    (region) => region.id !== state.selectedRegionId
  );

  if (nextRegions.length === state.regions.length) {
    return state;
  }

  return withHistory(state, {
    regions: nextRegions,
    selectedRegionId: nextRegions.at(-1)?.id ?? null,
    nextRegionNumber: state.nextRegionNumber
  });
}

export function undoEditState(state: BigImageEditState): BigImageEditState {
  const previous = state.undoStack.at(-1);

  if (!previous) {
    return state;
  }

  return {
    ...state,
    ...previous,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [toSnapshot(state), ...state.redoStack],
    showExitConfirm: false
  };
}

export function redoEditState(state: BigImageEditState): BigImageEditState {
  const next = state.redoStack[0];

  if (!next) {
    return state;
  }

  return {
    ...state,
    ...next,
    undoStack: [...state.undoStack, toSnapshot(state)],
    redoStack: state.redoStack.slice(1),
    showExitConfirm: false
  };
}

export function startEditEnabled(
  state: BigImageEditState,
  locked: boolean
): boolean {
  return (
    !locked &&
    (state.globalInstruction.trim().length > 0 ||
      state.regions.some((region) => region.instruction.trim().length > 0))
  );
}

export function startEditDraft(
  state: BigImageEditState,
  locked: boolean
): BigImageEditState {
  if (!startEditEnabled(state, locked)) {
    return state;
  }

  return {
    ...state,
    submitStatus: "running",
    showExitConfirm: false
  };
}

export function requestExitEdit(state: BigImageEditState): BigImageEditState {
  if (!hasDraftChanges(state)) {
    return state;
  }

  return {
    ...state,
    showExitConfirm: true
  };
}

function continueEditing(state: BigImageEditState): BigImageEditState {
  return {
    ...state,
    showExitConfirm: false
  };
}

function discardChanges(): BigImageEditState {
  return createBigImageEditState();
}

function hasDraftChanges(state: BigImageEditState): boolean {
  return (
    state.globalInstruction.trim().length > 0 ||
    state.regions.length > 0 ||
    state.submitStatus === "running"
  );
}

export function isValidLassoPolygon(
  points: LassoRegionDraft["points"]
): boolean {
  const distinctPoints = points.filter(
    (point, index) =>
      points.findIndex(
        (otherPoint) => otherPoint.x === point.x && otherPoint.y === point.y
      ) === index
  );

  if (distinctPoints.length < 3) {
    return false;
  }

  const xs = distinctPoints.map((point) => point.x);
  const ys = distinctPoints.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);

  if (width < 8 || height < 8) {
    return false;
  }

  return polygonArea(distinctPoints) >= 64;
}

function polygonArea(points: LassoRegionDraft["points"]): number {
  return (
    Math.abs(
      points.reduce((area, point, index) => {
        const nextPoint = points[(index + 1) % points.length];

        return area + point.x * nextPoint.y - nextPoint.x * point.y;
      }, 0)
    ) / 2
  );
}

function withHistory(
  state: BigImageEditState,
  nextSnapshot: EditSnapshot
): BigImageEditState {
  return {
    ...state,
    ...nextSnapshot,
    undoStack: [...state.undoStack, toSnapshot(state)],
    redoStack: [],
    showExitConfirm: false,
    submitStatus: "idle"
  };
}

function toSnapshot(state: EditSnapshot): EditSnapshot {
  return {
    regions: state.regions,
    selectedRegionId: state.selectedRegionId,
    nextRegionNumber: state.nextRegionNumber
  };
}

export function BigImageEdit({
  currentNodeId,
  imageUrl,
  locked,
  initialState,
  onExitEdit,
  onDirtyChange,
  onStartEdit
}: BigImageEditProps) {
  const [editState, setEditState] = useState<BigImageEditState>(
    () => initialState ?? createBigImageEditState()
  );
  const canStartEdit = startEditEnabled(editState, locked);
  const dirty = useMemo(() => hasDraftChanges(editState), [editState]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const handleRequestExit = () => {
    if (!hasDraftChanges(editState)) {
      onExitEdit?.();
      return;
    }

    setEditState((state) => requestExitEdit(state));
  };

  const handleDiscard = () => {
    setEditState(discardChanges());
    onDirtyChange?.(false);
    onExitEdit?.();
  };

  const handleStartEdit = () => {
    const nextState = startEditDraft(editState, locked);

    if (nextState === editState) {
      return;
    }

    setEditState(nextState);
    onStartEdit?.({
      globalInstruction: nextState.globalInstruction,
      regions: nextState.regions
    });
  };

  return (
    <div className="mode-grid edit-grid">
      <section className="image-stage edit-stage" aria-label="图片编辑器">
        <div className="stage-toolbar">
          <span>套索圈选</span>
          <span>{editState.regions.length} 个区域</span>
          <span>{locked ? "已锁定" : "可编辑"}</span>
        </div>
        <div className="image-frame">
          <LassoCanvas
            locked={locked}
            imageUrl={imageUrl}
            regions={editState.regions}
            selectedRegionId={editState.selectedRegionId}
            createRegion={(points) =>
              createLassoRegion(editState.nextRegionNumber, points)
            }
            onRegionCreate={(region) =>
              setEditState((state) => addLassoRegion(state, region))
            }
            onSelectRegion={(regionId) =>
              setEditState((state) => selectRegion(state, regionId))
            }
          />
        </div>
        <Toolbar
          locked={locked}
          canUndo={editState.undoStack.length > 0}
          canRedo={editState.redoStack.length > 0}
          hasSelection={editState.selectedRegionId !== null}
          onUndo={() => setEditState((state) => undoEditState(state))}
          onRedo={() => setEditState((state) => redoEditState(state))}
          onDelete={() => setEditState((state) => deleteSelectedRegion(state))}
          onRequestExit={handleRequestExit}
        />
      </section>

      <RegionPanel
        currentNodeId={currentNodeId}
        locked={locked}
        globalInstruction={editState.globalInstruction}
        regions={editState.regions}
        selectedRegionId={editState.selectedRegionId}
        canStartEdit={canStartEdit}
        onSelectRegion={(regionId) =>
          setEditState((state) => selectRegion(state, regionId))
        }
        onInstructionChange={(regionId, instruction) =>
          setEditState((state) =>
            setRegionInstruction(state, regionId, instruction)
          )
        }
        onGlobalInstructionChange={(instruction) =>
          setEditState((state) => ({ ...state, globalInstruction: instruction }))
        }
        submitStatus={editState.submitStatus}
        onStartEdit={handleStartEdit}
      />

      {editState.showExitConfirm ? (
        <ConfirmDialog
          title="放弃当前编辑？"
          cancelLabel="继续编辑"
          confirmLabel="放弃修改"
          onCancel={() => setEditState((state) => continueEditing(state))}
          onConfirm={handleDiscard}
        >
          当前还有未提交的圈选区域或修改要求。
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
