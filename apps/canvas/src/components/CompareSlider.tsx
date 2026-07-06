export type CompareMode = "image" | "slider" | "split";

interface CompareSliderProps {
  beforeImageUrl?: string;
  afterImageUrl?: string;
  beforeLabel?: string;
  afterLabel?: string;
  mode?: CompareMode;
  position?: number;
}

function VisualPane({
  imageUrl,
  label,
  tone
}: {
  imageUrl?: string;
  label: string;
  tone: "before" | "after";
}) {
  return (
    <div className="compare-visual-pane" data-tone={tone}>
      {imageUrl ? (
        <img src={imageUrl} alt={label} />
      ) : (
        <div className="compare-placeholder" aria-hidden="true">
          <div className="placeholder-horizon" />
          <div className="placeholder-subject" />
        </div>
      )}
      <span className="compare-label">{label}</span>
    </div>
  );
}

export function CompareSlider({
  beforeImageUrl,
  afterImageUrl,
  beforeLabel = "修改前",
  afterLabel = "当前图",
  mode = "image",
  position = 50
}: CompareSliderProps) {
  if (mode === "split") {
    return (
      <div className="compare-split-view" aria-label="左右并排对比">
        <VisualPane imageUrl={beforeImageUrl} label={beforeLabel} tone="before" />
        <VisualPane imageUrl={afterImageUrl} label={afterLabel} tone="after" />
      </div>
    );
  }

  if (mode === "image") {
    return (
      <div className="compare-single-view" aria-label="当前图片">
        <VisualPane imageUrl={afterImageUrl ?? beforeImageUrl} label={afterLabel} tone="after" />
      </div>
    );
  }

  return (
    <div className="compare-slider" aria-label="修改前后滑杆对比">
      <VisualPane imageUrl={beforeImageUrl} label={beforeLabel} tone="before" />
      <div
        className="compare-after-layer"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        aria-hidden="true"
      >
        <VisualPane imageUrl={afterImageUrl} label={afterLabel} tone="after" />
      </div>
      <div
        className="compare-divider"
        style={{ left: `${position}%` }}
        aria-hidden="true"
      />
    </div>
  );
}
