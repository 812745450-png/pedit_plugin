import type { LassoRegionDraft } from "./LassoCanvas";

interface RegionPanelProps {
  currentNodeId: string | null;
  locked: boolean;
  globalInstruction: string;
  regions: LassoRegionDraft[];
  selectedRegionId: string | null;
  canStartEdit: boolean;
  submitStatus: "idle" | "running";
  onSelectRegion: (regionId: string) => void;
  onGlobalInstructionChange: (instruction: string) => void;
  onInstructionChange: (regionId: string, instruction: string) => void;
  onStartEdit: () => void;
}

export function RegionPanel({
  currentNodeId,
  locked,
  globalInstruction,
  regions,
  selectedRegionId,
  canStartEdit,
  submitStatus,
  onSelectRegion,
  onGlobalInstructionChange,
  onInstructionChange,
  onStartEdit
}: RegionPanelProps) {
  return (
    <aside className="right-panel region-panel" aria-label="编辑要求">
      <div className="panel-header">
        <p className="panel-label">编辑模式</p>
        <h2>修改要求</h2>
      </div>

      <div className="summary-list">
        <div className="summary-row">
          <span>当前节点</span>
          <strong>{currentNodeId}</strong>
        </div>
        <div className="summary-row">
          <span>圈选区域</span>
          <strong>{regions.length}</strong>
        </div>
        <div className="summary-row">
          <span>编辑状态</span>
          <strong>{locked ? "已锁定" : "可编辑"}</strong>
        </div>
      </div>

      <label className="global-prompt-field" htmlFor="global-edit-prompt">
        <span>整图修改要求</span>
        <textarea
          id="global-edit-prompt"
          rows={4}
          value={globalInstruction}
          placeholder="例如：让整体光线更柔和，保留人物身份和照片质感"
          disabled={locked}
          onChange={(event) =>
            onGlobalInstructionChange(event.currentTarget.value)
          }
        />
      </label>

      <div className="region-list" aria-label="Lasso regions">
        {regions.length === 0 ? (
          <p className="panel-copy">
            需要局部修改时，在图片上按住并手动圈选区域；圈选完成后，这里会出现对应的区域输入框。
          </p>
        ) : (
          regions.map((region) => (
            <label
              key={region.id}
              className="region-card"
              data-selected={selectedRegionId === region.id}
              htmlFor={`${region.id}-instruction`}
              onClick={() => {
                if (!locked) {
                  onSelectRegion(region.id);
                }
              }}
            >
              <span className="region-card-header">
                <span
                  className="region-swatch"
                  style={{ backgroundColor: region.color }}
                  aria-hidden="true"
                />
                <span>{region.label.replace("Region", "区域")}</span>
              </span>
              <textarea
                id={`${region.id}-instruction`}
                rows={4}
                value={region.instruction}
                placeholder="描述这个区域要如何修改"
                disabled={locked}
                onChange={(event) =>
                  onInstructionChange(region.id, event.currentTarget.value)
                }
              />
            </label>
          ))
        )}
      </div>

      <div className="panel-actions">
        <button
          className="primary-button"
          type="button"
          disabled={!canStartEdit}
          onClick={onStartEdit}
        >
          开始优化
        </button>
      </div>
      {submitStatus === "running" ? (
        <div className="submit-status" role="status" aria-live="polite">
          <strong>编辑请求已排队</strong>
          <span>等待 Codex 接手后会优先尝试本地高保真处理，必要时再调用 image2。</span>
        </div>
      ) : null}
    </aside>
  );
}
