export const CONFIRMATION_DURATION_MS = 800;

export interface ManipulationFeedback {
  kind: 'scale' | 'move';
  phase: 'ready' | 'active' | 'held' | 'paused';
  value?: number;
}

/** Instructions are scoped to the current draft, never to a stale gesture mode. */
export function manipulationInstruction(feedback: ManipulationFeedback | null, activeKind?: string): string | null {
  if (!feedback || feedback.kind !== activeKind) return null;
  const { kind, phase, value } = feedback;
  const scale = Number.isFinite(value) ? ` ${value!.toFixed(2)}×` : '';
  if (phase === 'paused') return 'Tracking paused. Show both hands; release and re-pinch if needed.';
  if (kind === 'scale') {
    if (phase === 'active') return `Scaling${scale} — move your hands apart or together. Release to hold.`;
    if (phase === 'held') return `Scale held${scale}. Choose Commit to apply, or pinch both hands to adjust.`;
    return 'Pinch both hands with space between them, then move apart or together to scale.';
  }
  if (phase === 'active') return 'Moving — keep pinching and drag your pointer hand. Release to hold.';
  if (phase === 'held') return 'Position held. Choose Commit to apply, or pinch and drag to adjust.';
  return 'Pinch inside the viewport and drag to move. Release to hold the position.';
}

/** Acknowledgements outrank incoming tracking frames until their exact expiry. */
export function resolveInstruction(input: {
  confirmation: { message: string; until: number } | null;
  now: number;
  context: string | null;
  base: string;
}): { message: string; confirmed: boolean } {
  const confirmed = !!input.confirmation && input.now < input.confirmation.until;
  return { message: confirmed ? input.confirmation!.message : input.context ?? input.base, confirmed };
}
