import { useMemo, useState } from "react";
import { CompareMode, CompareSlider } from "../components/CompareSlider";
import { CanvasMode } from "../state/canvasStore";

interface BigImageViewProps {
  currentNodeId: string | null;
  currentNodeName?: string;
  onModeChange: (mode: CanvasMode) => void;
  beforeImageUrl?: string;
  afterImageUrl?: string;
  optimizationSummary?: string | null;
}

export function BigImageView({
  currentNodeId,
  currentNodeName,
  onModeChange,
  beforeImageUrl,
  afterImageUrl,
  optimizationSummary
}: BigImageViewProps) {
  const [comparisonMode, setComparisonMode] = useState<CompareMode>("image");
  const [comparisonPosition, setComparisonPosition] = useState(50);
  const summaryText = optimizationSummary?.trim() || "暂无优化描述";
  const exportUrl = useMemo(
    () => afterImageUrl ?? beforeImageUrl ?? createPlaceholderImageUrl(currentNodeId),
    [afterImageUrl, beforeImageUrl, currentNodeId]
  );

  const exportCurrentImage = () => {
    const link = document.createElement("a");
    link.href = exportUrl;
    link.download = `${currentNodeId ?? "pedit-current-image"}.jpg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="mode-grid view-grid">
      <section className="image-stage" aria-label="图片预览">
        <div className="stage-toolbar">
          <span>适配画布</span>
          <span>100%</span>
          <span>
            {comparisonMode === "image"
              ? "当前图"
              : comparisonMode === "slider"
                ? "滑杆对比"
                : "左右并排"}
          </span>
        </div>
        <div className="image-frame">
          <CompareSlider
            mode={comparisonMode}
            position={comparisonPosition}
            beforeImageUrl={beforeImageUrl}
            afterImageUrl={afterImageUrl}
            beforeLabel="上一版本"
            afterLabel="当前版本"
          />
        </div>
        <div className="stage-footer">
          <span>当前节点</span>
          <strong>{currentNodeName ?? currentNodeId}</strong>
        </div>
      </section>

      <aside className="right-panel" aria-label="优化内容">
        <div className="panel-header">
          <p className="panel-label">图片详情</p>
          <h2>{currentNodeName ?? "当前图片"}</h2>
        </div>

        <div className="summary-list">
          <div className="summary-row">
            <span>当前节点</span>
            <strong>{currentNodeName ?? currentNodeId}</strong>
          </div>
          <div className="summary-row">
            <span>查看方式</span>
            <strong>
              {comparisonMode === "image"
                ? "当前图"
                : comparisonMode === "slider"
                  ? "滑杆对比"
                  : "左右并排"}
            </strong>
          </div>
        </div>

        <div className="comparison-box">
          <p className="panel-label">对比</p>
          <div className="comparison-mode-control" aria-label="对比方式">
            <button
              className="mode-tab"
              data-active={comparisonMode === "image"}
              type="button"
              aria-pressed={comparisonMode === "image"}
              onClick={() => setComparisonMode("image")}
            >
              当前图
            </button>
            <button
              className="mode-tab"
              data-active={comparisonMode === "slider"}
              type="button"
              aria-pressed={comparisonMode === "slider"}
              onClick={() => setComparisonMode("slider")}
            >
              滑杆
            </button>
            <button
              className="mode-tab"
              data-active={comparisonMode === "split"}
              type="button"
              aria-pressed={comparisonMode === "split"}
              onClick={() => setComparisonMode("split")}
            >
              并排
            </button>
          </div>
          {comparisonMode === "slider" ? (
            <label className="range-field" htmlFor="compare-position">
              <span>对比位置</span>
              <input
                id="compare-position"
                type="range"
                min="0"
                max="100"
                value={comparisonPosition}
                onChange={(event) =>
                  setComparisonPosition(Number(event.currentTarget.value))
                }
              />
            </label>
          ) : null}
          <p className="summary-copy">{summaryText}</p>
        </div>

        <div className="panel-actions">
          <button
            className="secondary-button"
            type="button"
          onClick={exportCurrentImage}
          >
            导出当前图片
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => onModeChange("big_image_edit")}
          >
            进入编辑
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => onModeChange("version")}
          >
            图片管理
          </button>
        </div>
      </aside>
    </div>
  );
}

function createPlaceholderImageUrl(currentNodeId: string | null) {
  const title = escapeSvgText(currentNodeId ?? "Pedit optimized image");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800"><rect width="1280" height="800" fill="#b7c2c9"/><rect y="416" width="1280" height="384" fill="#6f858d"/><rect x="486" y="192" width="308" height="336" rx="28" fill="#e6ebed"/><text x="64" y="96" fill="#20242a" font-family="Arial, sans-serif" font-size="36" font-weight="700">${title}</text></svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
