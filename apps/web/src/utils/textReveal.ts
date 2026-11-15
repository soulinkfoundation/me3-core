// Streams arrive in bursts. This lets a reply flow in at an even pace instead of jumping a chunk at a time,
// while never falling more than a moment behind: the further behind it is, the faster it catches up.

export type TextReveal = {
  push(text: string): void;
  /** Writes everything still waiting, at once. */
  flush(): void;
  /** Drops whatever is waiting (the reply was cleared). */
  reset(): void;
};

/** How long the backlog takes to drain, whatever its size. */
const CATCH_UP_MS = 220;
const MIN_CHARS_PER_FRAME = 2;
/** A step this close to the end of a word finishes the word, so text arrives in words, not letters. */
const WORD_SNAP = 8;

export function revealStep(backlog: string, elapsedMs: number): number {
  if (!backlog) return 0;
  let count = Math.max(MIN_CHARS_PER_FRAME, Math.ceil((backlog.length * elapsedMs) / CATCH_UP_MS));
  if (count >= backlog.length) return backlog.length;
  const space = backlog.slice(count).search(/\s/);
  if (space >= 0 && space <= WORD_SNAP) count += space + 1;
  return Math.min(count, backlog.length);
}

export function createTextReveal(write: (text: string) => void, options: { immediate?: boolean } = {}): TextReveal {
  let backlog = "";
  let frame: number | null = null;
  let last = 0;
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;

  const stop = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  const tick = (time: number) => {
    const elapsed = last ? Math.min(time - last, 100) : 16;
    last = time;
    const count = revealStep(backlog, elapsed);
    if (count) {
      write(backlog.slice(0, count));
      backlog = backlog.slice(count);
    }
    frame = backlog && raf ? raf(tick) : null;
    if (!backlog) last = 0;
  };

  return {
    push(text) {
      if (!text) return;
      if (options.immediate || !raf) { write(text); return; }
      backlog += text;
      if (frame === null) frame = raf(tick);
    },
    flush() {
      stop();
      last = 0;
      if (backlog) write(backlog);
      backlog = "";
    },
    reset() {
      stop();
      last = 0;
      backlog = "";
    },
  };
}
