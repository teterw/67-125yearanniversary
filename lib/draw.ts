import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

/** MediaPipe's 21-point hand skeleton, inlined so the drawing path stays light. */
const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

export interface DrawOptions {
  showSkeleton: boolean;
  /** Which hand is currently on top: highlights it so the motion is readable. */
  topIndex: number | null;
  dim: boolean;
}

export function drawHands(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  hands: NormalizedLandmark[][],
  { showSkeleton, topIndex, dim }: DrawOptions,
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
  if (!showSkeleton || hands.length === 0) return;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  hands.forEach((hand, i) => {
    if (hand.length < 21) return;

    // Everything is sized off the hand's own palm length. Scaling off the frame
    // instead makes a distant hand render as a clump of dots with the bones
    // buried underneath.
    const palm = Math.hypot((hand[9].x - hand[0].x) * w, (hand[9].y - hand[0].y) * h);
    const bone = Math.max(1.4, palm * 0.13);
    const joint = Math.max(1, bone * 0.62);

    const hot = topIndex === i;
    const stroke = hot ? "#ffd23f" : "#22e0ff";
    ctx.globalAlpha = dim ? 0.55 : 1;

    const path = new Path2D();
    for (const [a, b] of CONNECTIONS) {
      path.moveTo(hand[a].x * w, hand[a].y * h);
      path.lineTo(hand[b].x * w, hand[b].y * h);
    }

    // Dark casing first, so the skeleton survives a bright, busy camera feed.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(3,3,8,0.75)";
    ctx.lineWidth = bone * 1.9;
    ctx.stroke(path);

    ctx.strokeStyle = stroke;
    ctx.shadowColor = stroke;
    ctx.shadowBlur = bone * 2;
    ctx.lineWidth = bone;
    ctx.stroke(path);

    ctx.shadowBlur = 0;
    ctx.fillStyle = hot ? "#fff3c4" : "#e8fbff";
    ctx.strokeStyle = "rgba(3,3,8,0.75)";
    ctx.lineWidth = Math.max(0.8, bone * 0.28);
    for (const p of hand) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, joint, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  });
}

export function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}
