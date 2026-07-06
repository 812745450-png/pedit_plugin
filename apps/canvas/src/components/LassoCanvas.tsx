import { useRef, useState } from "react";
import type { PointerEvent } from "react";

export interface LassoRegionDraft {
  id: string;
  label: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  instruction: string;
}

interface LassoCanvasProps {
  locked: boolean;
  imageUrl?: string;
  regions: LassoRegionDraft[];
  selectedRegionId: string | null;
  createRegion: (points: LassoRegionDraft["points"]) => LassoRegionDraft | null;
  onRegionCreate: (region: LassoRegionDraft) => void;
  onSelectRegion: (regionId: string) => void;
}

const viewBoxWidth = 1000;
const viewBoxHeight = 625;

export function LassoCanvas({
  locked,
  imageUrl,
  regions,
  selectedRegionId,
  createRegion,
  onRegionCreate,
  onSelectRegion
}: LassoCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draftPointsRef = useRef<LassoRegionDraft["points"]>([]);
  const [draftPoints, setDraftPoints] = useState<LassoRegionDraft["points"]>(
    []
  );
  const [activePointerId, setActivePointerId] = useState<number | null>(null);

  const isDrawing = activePointerId !== null;

  const readPoint = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = svgRef.current?.getBoundingClientRect();

    if (!bounds || bounds.width === 0 || bounds.height === 0) {
      return {
        x: event.clientX,
        y: event.clientY
      };
    }

    return {
      x: ((event.clientX - bounds.left) / bounds.width) * viewBoxWidth,
      y: ((event.clientY - bounds.top) / bounds.height) * viewBoxHeight
    };
  };

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (locked || event.button !== 0) {
      return;
    }

    const point = readPoint(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setActivePointerId(event.pointerId);
    draftPointsRef.current = [point];
    setDraftPoints([point]);
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (locked || activePointerId !== event.pointerId || !isDrawing) {
      return;
    }

    const point = readPoint(event);
    setDraftPoints((points) => {
      const lastPoint = points.at(-1);

      if (
        lastPoint &&
        Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 4
      ) {
        return points;
      }

      const nextPoints = [...points, point];
      draftPointsRef.current = nextPoints;
      return nextPoints;
    });
  };

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointerId !== event.pointerId) {
      return;
    }

    const point = readPoint(event);
    const closedPoints = [...draftPointsRef.current, point];
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setActivePointerId(null);
    draftPointsRef.current = [];
    setDraftPoints([]);

    if (!locked && closedPoints.length >= 3) {
      const region = createRegion(closedPoints);

      if (region) {
        onRegionCreate(region);
      }
    }
  };

  const handlePointerCancel = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setActivePointerId(null);
    draftPointsRef.current = [];
    setDraftPoints([]);
  };

  return (
    <div
      className="image-placeholder editable lasso-canvas"
      data-locked={locked}
    >
      {imageUrl ? (
        <img className="lasso-base-image" src={imageUrl} alt="" />
      ) : (
        <>
          <div className="placeholder-horizon" />
          <div className="placeholder-subject" />
        </>
      )}
      <svg
        ref={svgRef}
        className="lasso-overlay"
        aria-label="套索圈选画布"
        role="img"
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        preserveAspectRatio="none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {regions.map((region) => (
          <polygon
            key={region.id}
            className="lasso-region"
            data-selected={selectedRegionId === region.id}
            points={formatPoints(region.points)}
            fill={region.color}
            stroke={region.color}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              if (!locked) {
                onSelectRegion(region.id);
              }
            }}
          >
            <title>{region.label}</title>
          </polygon>
        ))}
        {draftPoints.length > 1 ? (
          <polyline
            className="lasso-draft-line"
            points={formatPoints(draftPoints)}
          />
        ) : null}
      </svg>
    </div>
  );
}

function formatPoints(points: LassoRegionDraft["points"]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}
