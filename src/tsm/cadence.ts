const INTERVAL_MS = 1000 / 15;
const EARLY_TOLERANCE_MS = 3;
const MIN_SPACING_MS = 49;

/** Sample by camera time so callback jitter cannot push a 30 FPS camera down to 10 FPS. */
export class TsmCadence {
  private previous = -Infinity;
  private next = -Infinity;

  reset(): void {
    this.previous = this.next = -Infinity;
  }

  take(mediaTimeSeconds: number): boolean {
    const timestamp = mediaTimeSeconds * 1000;
    if (!Number.isFinite(timestamp) || timestamp - this.previous < MIN_SPACING_MS ||
        timestamp + EARLY_TOLERANCE_MS < this.next) return false;
    this.previous = timestamp;
    const scheduled = this.next + INTERVAL_MS;
    // Resume from the newest camera frame after a stall, without catching up.
    this.next = scheduled >= timestamp + MIN_SPACING_MS ? scheduled : timestamp + INTERVAL_MS;
    return true;
  }
}
