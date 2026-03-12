export interface ShakeState {
  intensity: number;
  duration: number; // frames remaining
}

export function triggerShake(state: ShakeState, intensity = 8, frames = 12): void {
  state.intensity = intensity;
  state.duration = frames;
}

export function applyShake(
  ctx: CanvasRenderingContext2D,
  state: ShakeState,
): void {
  if (state.duration <= 0) return;
  const dx = (Math.random() - 0.5) * state.intensity;
  const dy = (Math.random() - 0.5) * state.intensity;
  ctx.translate(dx, dy);
  state.intensity *= 0.85;
  state.duration--;
}
