export interface FrameManifest {
  count: number;
  pattern: string;
  width?: number;
  height?: number;
}

export function frameIndexForProgress(progress: number, frameCount: number) {
  if (frameCount <= 1) return 0;
  const clamped = Math.min(1, Math.max(0, progress));
  return Math.min(frameCount - 1, Math.round(clamped * frameCount));
}

export function frameUrl(pattern: string, zeroBasedIndex: number) {
  return pattern.replace(/\{INDEX:(\d+)\}/, (_, width) =>
    String(zeroBasedIndex + 1).padStart(Number(width), '0'),
  );
}

export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  canvasWidth: number,
  canvasHeight: number,
) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const canvasRatio = canvasWidth / canvasHeight;
  const drawWidth = imageRatio > canvasRatio ? canvasHeight * imageRatio : canvasWidth;
  const drawHeight = imageRatio > canvasRatio ? canvasHeight : canvasWidth / imageRatio;
  const drawX = (canvasWidth - drawWidth) / 2;
  const drawY = (canvasHeight - drawHeight) / 2;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}
