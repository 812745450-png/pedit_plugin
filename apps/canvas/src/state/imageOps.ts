import type { LassoRegionDraft } from "../components/LassoCanvas";
import type { ImageProjectNode } from "./imageProject";

const maxCanvasWidth = 1280;

export async function renderEditedImage(
  source: ImageProjectNode,
  regions: LassoRegionDraft[],
  generationIndex: number
) {
  const image = await loadImage(source.imageUrl);
  const { width, height } = scaleSize(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas rendering context is unavailable.");
  }

  canvas.width = width;
  canvas.height = height;

  const filter =
    generationIndex % 2 === 0
      ? "brightness(1.08) contrast(1.06) saturate(1.18)"
      : "brightness(1.04) contrast(1.12) saturate(1.1) sepia(0.08)";

  context.filter = filter;
  context.drawImage(image, 0, 0, width, height);
  context.filter = "none";

  addFilmTone(context, width, height, generationIndex);
  addRegionAccents(context, width, height, regions);
  addFineBorder(context, width, height);

  return canvas.toDataURL("image/jpeg", 0.88);
}

export async function renderCompositeImage(
  parents: ImageProjectNode[],
  prompt: string
) {
  const [baseNode, cameoNode] = chooseCompositeParents(parents);
  const baseImage = await loadImage(baseNode.imageUrl);
  const cameoImage = await loadImage(cameoNode.imageUrl);
  const { width, height } = scaleSize(
    baseImage.naturalWidth,
    baseImage.naturalHeight
  );
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas rendering context is unavailable.");
  }

  canvas.width = width;
  canvas.height = height;

  context.filter = "brightness(1.03) contrast(1.06) saturate(1.08)";
  context.drawImage(baseImage, 0, 0, width, height);
  context.filter = "none";
  addFilmTone(context, width, height, 2);

  const cameoWidth = width * 0.28;
  const cameoHeight = cameoWidth * 1.12;
  const cameoX = width * 0.08;
  const cameoY = height * 0.6;

  context.save();
  context.shadowColor = "rgba(26, 31, 38, 0.38)";
  context.shadowBlur = 28;
  context.shadowOffsetY = 18;
  roundedRect(context, cameoX, cameoY, cameoWidth, cameoHeight, 18);
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.fill();
  context.restore();

  context.save();
  roundedRect(context, cameoX + 10, cameoY + 10, cameoWidth - 20, cameoHeight - 20, 14);
  context.clip();
  drawImageCover(
    context,
    cameoImage,
    cameoX + 10,
    cameoY + 10,
    cameoWidth - 20,
    cameoHeight - 20
  );
  context.restore();

  context.save();
  context.globalCompositeOperation = "multiply";
  context.fillStyle = "rgba(49, 74, 67, 0.14)";
  context.fillRect(0, 0, width, height);
  context.restore();

  const label = prompt.trim().slice(0, 52) || "Composite edit";
  context.save();
  context.font = `${Math.max(18, width * 0.018)}px system-ui, sans-serif`;
  context.fillStyle = "rgba(255, 255, 255, 0.78)";
  context.fillText(label, width * 0.06, height * 0.94);
  context.restore();

  addFineBorder(context, width, height);

  return canvas.toDataURL("image/jpeg", 0.88);
}

function chooseCompositeParents(parents: ImageProjectNode[]) {
  const cat = parents.find((node) => node.id.includes("cat"));
  const base =
    parents.find((node) => node.id !== cat?.id && node.kind !== "source") ??
    parents.find((node) => node.id !== cat?.id) ??
    parents[0];

  return [base, cat ?? parents.find((node) => node.id !== base.id) ?? parents[0]];
}

function scaleSize(width: number, height: number) {
  if (width <= maxCanvasWidth) {
    return { width, height };
  }

  const scale = maxCanvasWidth / width;
  return {
    width: maxCanvasWidth,
    height: Math.round(height * scale)
  };
}

function addFilmTone(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  generationIndex: number
) {
  const warm = context.createLinearGradient(0, 0, width, height);
  warm.addColorStop(0, generationIndex % 2 === 0 ? "rgba(255, 238, 210, 0.16)" : "rgba(244, 214, 188, 0.22)");
  warm.addColorStop(0.58, "rgba(255, 255, 255, 0.02)");
  warm.addColorStop(1, "rgba(42, 65, 73, 0.18)");
  context.fillStyle = warm;
  context.fillRect(0, 0, width, height);
}

function addRegionAccents(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  regions: LassoRegionDraft[]
) {
  for (const region of regions) {
    if (region.points.length < 3) {
      continue;
    }

    context.save();
    context.beginPath();
    region.points.forEach((point, index) => {
      const x = (point.x / 1000) * width;
      const y = (point.y / 625) * height;

      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.closePath();
    context.clip();
    context.fillStyle = "rgba(255, 246, 226, 0.18)";
    context.fillRect(0, 0, width, height);
    context.filter = "blur(10px)";
    context.globalAlpha = 0.22;
    context.drawImage(context.canvas, 0, 0);
    context.restore();
  }
}

function addFineBorder(
  context: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.48)";
  context.lineWidth = Math.max(4, width * 0.004);
  context.strokeRect(0, 0, width, height);
  context.restore();
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sx = 0;
  let sy = 0;
  let sw = image.naturalWidth;
  let sh = image.naturalHeight;

  if (imageRatio > targetRatio) {
    sw = image.naturalHeight * targetRatio;
    sx = (image.naturalWidth - sw) / 2;
  } else {
    sh = image.naturalWidth / targetRatio;
    sy = (image.naturalHeight - sh) / 2;
  }

  context.drawImage(image, sx, sy, sw, sh, x, y, width, height);
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}
