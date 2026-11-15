export class Measurements {
  private values = new Map<string, number[]>();
  add(name: string, value: number) { if (!Number.isFinite(value)) return; const list = this.values.get(name) || []; list.push(value); if (list.length > 1800) list.shift(); this.values.set(name, list); }
  summary() {
    return Object.fromEntries([...this.values].map(([name, list]) => {
      const sorted = [...list].sort((a, b) => a - b);
      return [name, { samples: list.length, p50: sorted[Math.floor((sorted.length - 1) * .5)], p95: sorted[Math.floor((sorted.length - 1) * .95)] }];
    }));
  }
}
export function downloadJSON(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
