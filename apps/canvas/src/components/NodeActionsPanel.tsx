interface NodeActionsPanelProps {
  nodeName: string | null;
  summary?: string | null;
  edgeLabel?: string | null;
  selectedCount: number;
  draftName: string;
  onDraftNameChange: (name: string) => void;
  onRename: () => void;
  onViewVersion: () => void;
  onEditFromVersion: () => void;
  onCopyBranch: () => void;
  onRequestDelete: () => void;
}

export function NodeActionsPanel({
  nodeName,
  summary,
  edgeLabel,
  selectedCount,
  draftName,
  onDraftNameChange,
  onRename,
  onViewVersion,
  onEditFromVersion,
  onCopyBranch,
  onRequestDelete
}: NodeActionsPanelProps) {
  const hasSingleSelection = selectedCount === 1 && nodeName !== null;

  return (
    <div className="node-actions" aria-label="版本操作">
      <div className="panel-header">
        <p className="panel-label">已选节点</p>
        <h2>{nodeName ?? "未选择节点"}</h2>
      </div>

      <div className="summary-list">
        <div className="summary-row">
          <span>已选数量</span>
          <strong>{selectedCount}</strong>
        </div>
      </div>

      <label className="rename-field" htmlFor="version-node-name">
        <span>节点名称</span>
        <input
          id="version-node-name"
          value={draftName}
          disabled={!hasSingleSelection}
          onChange={(event) => onDraftNameChange(event.currentTarget.value)}
        />
      </label>

      {summary || edgeLabel ? (
        <details className="node-explain">
          <summary>生成说明</summary>
          {edgeLabel ? <p><strong>{edgeLabel}</strong></p> : null}
          {summary ? <p>{summary}</p> : null}
        </details>
      ) : null}

      <div className="panel-actions stacked-actions">
        <button
          className="primary-button"
          type="button"
          disabled={!hasSingleSelection}
          onClick={onViewVersion}
        >
          查看大图
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!hasSingleSelection}
          onClick={onEditFromVersion}
        >
          从此编辑
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!hasSingleSelection || draftName.trim().length === 0}
          onClick={onRename}
        >
          重命名
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!hasSingleSelection}
          onClick={onCopyBranch}
        >
          复制分支
        </button>
        <button
          className="primary-button danger-button"
          type="button"
          disabled={!hasSingleSelection}
          onClick={onRequestDelete}
        >
          级联删除
        </button>
      </div>
    </div>
  );
}
