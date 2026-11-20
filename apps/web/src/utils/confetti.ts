/**
 * Paper confetti fired from the bottom corners when a site is published.
 * Shared spec with iOS and Android: keep the numbers in step across platforms.
 */

export const CONFETTI_COLORS = ["#229874", "#6FD3A8", "#F5B83D", "#F2785C", "#5AA9E6", "#A98BE0"] as const;

const PIECES_PER_SIDE = 60;
const MAX_STAGGER_S = 0.15;
const MIN_ANGLE_DEG = 62;
const MAX_ANGLE_DEG = 84;
const GRAVITY_H = 1.6;
const DRAG = 1.3;
const MAX_DT = 1 / 30;
const FADE_S = 0.6;
const CANVAS_LIFETIME_MS = 3000;

type Shape = "rect" | "circle" | "strip";

export interface ConfettiPiece {
  shape: Shape;
  color: string;
  delay: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  phase: number;
  phaseSpeed: number;
  swayFreq: number;
  lifetime: number;
}

const uniform = (min: number, max: number, rand: () => number) => min + (max - min) * rand();

function pickShape(rand: () => number): Shape {
  const r = rand();
  if (r < 0.55) return "rect";
  if (r < 0.8) return "circle";
  return "strip";
}

/** Builds the 120 pieces: 60 from each bottom corner, firing up and inward. */
export function createConfettiPieces(width: number, height: number, rand: () => number = Math.random): ConfettiPiece[] {
  const pieces: ConfettiPiece[] = [];
  for (const side of [-1, 1] as const) {
    // side -1 = bottom-left (fires right), 1 = bottom-right (fires left).
    const originX = side < 0 ? 0 : width;
    for (let i = 0; i < PIECES_PER_SIDE; i++) {
      const angle = (uniform(MIN_ANGLE_DEG, MAX_ANGLE_DEG, rand) * Math.PI) / 180;
      const speed = height * uniform(2.2, 2.9, rand);
      pieces.push({
        shape: pickShape(rand),
        color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)] ?? CONFETTI_COLORS[0],
        delay: uniform(0, MAX_STAGGER_S, rand),
        x: originX,
        y: height,
        vx: -side * Math.cos(angle) * speed,
        vy: -Math.sin(angle) * speed,
        rotation: uniform(0, Math.PI * 2, rand),
        spin: uniform(-6, 6, rand),
        phase: uniform(0, Math.PI * 2, rand),
        phaseSpeed: uniform(6, 12, rand),
        swayFreq: uniform(3, 6, rand),
        lifetime: uniform(2.2, 2.8, rand),
      });
    }
  }
  return pieces;
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function drawPiece(ctx: CanvasRenderingContext2D, piece: ConfettiPiece, age: number) {
  const remaining = piece.lifetime - age;
  ctx.globalAlpha = remaining < FADE_S ? Math.max(0, remaining / FADE_S) : 1;
  ctx.fillStyle = piece.color;
  ctx.save();
  ctx.translate(piece.x + Math.sin(age * piece.swayFreq) * 8, piece.y);
  ctx.rotate(piece.rotation);
  ctx.scale(1, Math.cos(piece.phase));
  if (piece.shape === "circle") {
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (piece.shape === "strip") {
    ctx.fillRect(-2, -7, 4, 14);
  } else {
    ctx.fillRect(-3.5, -6, 7, 12);
  }
  ctx.restore();
}

/** Fires the confetti over the whole viewport. No-op when reduced motion is preferred. */
export function launchConfetti(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (prefersReducedMotion()) return;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: "none",
    zIndex: "9999",
  });
  document.body.appendChild(canvas);

  const pieces = createConfettiPieces(width, height);
  const gravity = GRAVITY_H * height;
  let elapsed = 0;
  let last: number | null = null;
  let frame = 0;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    canvas.remove();
  };

  const tick = (now: number) => {
    const dt = last === null ? 0 : Math.min((now - last) / 1000, MAX_DT);
    last = now;
    elapsed += dt;
    const drag = Math.exp(-DRAG * dt);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const piece of pieces) {
      const age = elapsed - piece.delay;
      if (age <= 0 || age >= piece.lifetime) continue;
      piece.vy += gravity * dt;
      piece.vx *= drag;
      piece.vy *= drag;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.rotation += piece.spin * dt;
      piece.phase += piece.phaseSpeed * dt;
      drawPiece(ctx, piece, age);
    }
    ctx.globalAlpha = 1;
    if (!done) frame = requestAnimationFrame(tick);
  };

  frame = requestAnimationFrame(tick);
  setTimeout(finish, CANVAS_LIFETIME_MS);
}
