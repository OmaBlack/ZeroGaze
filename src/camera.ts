import type { FaceDetectionCandidate } from './ergonomics';

export async function enumerateVideoDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  } catch (err) {
    console.warn('Failed to enumerate video devices:', err);
    return [];
  }
}

export function stopMediaStream(videoEl: HTMLVideoElement | null): void {
  if (videoEl && videoEl.srcObject instanceof MediaStream) {
    videoEl.srcObject.getTracks().forEach((track) => track.stop());
    videoEl.srcObject = null;
  }
}

export function drawDetections(
  canvasEl: HTMLCanvasElement | null,
  videoEl: HTMLVideoElement | null,
  primary: FaceDetectionCandidate | null,
  ignoredBackground: FaceDetectionCandidate[] = []
): void {
  if (!canvasEl || !videoEl) return;
  canvasEl.width = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  // Draw ignored background faces in muted dashed grey
  for (const bg of ignoredBackground) {
    if (!bg.boundingBox) continue;
    const { originX, originY, width, height } = bg.boundingBox;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(originX, originY, width, height);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.fillRect(originX, originY, width, height);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Ignored (Background)', originX + 4, Math.max(12, originY - 6));
    ctx.restore();
  }

  // Draw primary foreground face in solid cyan
  if (primary?.boundingBox) {
    const { originX, originY, width, height } = primary.boundingBox;
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.strokeRect(originX, originY, width, height);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.fillRect(originX, originY, width, height);
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('Primary User', originX + 4, Math.max(14, originY - 6));
    ctx.restore();
  }
}
