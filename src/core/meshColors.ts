import type { Vec3 } from '../shared/types';

export const DEFAULT_IMPORT_COLOR = '#76c9cd';
export const colorByte = (value: number) => Math.round(Math.max(0, Math.min(255, value)));

export function hexToRgb(color: string): Vec3 {
  return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) as Vec3;
}

export function rgbToHex(colors: Uint8Array): string {
  return '#' + Array.from(colors.subarray(0, 3), value => value.toString(16).padStart(2, '0')).join('');
}
