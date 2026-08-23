/**
 * Draws one dot per hand the camera found: solid for the two being counted,
 * faint for anything the closest-pair filter dropped. No skeleton — just enough
 * to see what is being tracked and what is being ignored.
 */

const TAU = Math.PI * 2;

export type MarkerRole = "top" | "tracked" | "ignored";

export interface Marker {
  /** Palm centre, normalized to the frame. */
  x: number;
  y: number;
  /** Palm length in frame-height units — sets the dot size. */
  scale: number;
  role: MarkerRole;
}

const TRACKED = "#22e0ff";
const TOP = "#ffd23f";

export function drawMarkers(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  markers: Marker[],
) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  for (const marker of markers) {
    // Size off the hand, not the frame, so a distant hand still reads clearly.
    const radius = Math.max(4, marker.scale * h * 0.2);
    const x = marker.x * w;
    const y = marker.y * h;

    if (marker.role === "ignored") {
      // Seen, deliberately not counted — shown so it's obvious why.
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.85, 0, TAU);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = Math.max(1.2, radius * 0.18);
      ctx.stroke();
      continue;
    }

    const color = marker.role === "top" ? TOP : TRACKED;

    // Dark backing keeps the dot readable over a bright, busy feed.
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.65, 0, TAU);
    ctx.fillStyle = "rgba(3,3,8,0.45)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = radius * 1.6;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(x, y, radius * 1.65, 0, TAU);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, radius * 0.18);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
