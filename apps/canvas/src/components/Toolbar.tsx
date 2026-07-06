interface ToolbarProps {
  locked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onRequestExit: () => void;
}

export function Toolbar({
  locked,
  canUndo,
  canRedo,
  hasSelection,
  onUndo,
  onRedo,
  onDelete,
  onRequestExit
}: ToolbarProps) {
  return (
    <div className="bottom-toolbar" aria-label="套索工具">
      <button type="button" disabled>
        套索
      </button>
      <button type="button" disabled={locked || !canUndo} onClick={onUndo}>
        撤销
      </button>
      <button type="button" disabled={locked || !canRedo} onClick={onRedo}>
        重做
      </button>
      <button
        type="button"
        disabled={locked || !hasSelection}
        onClick={onDelete}
      >
        删除区域
      </button>
      <button type="button" disabled={locked} onClick={onRequestExit}>
        退出编辑
      </button>
    </div>
  );
}
