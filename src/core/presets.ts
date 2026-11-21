export type SizePreset = Readonly<{
  key: string;
  label: string;
  value: number;
} & (
  | { primitive: 'Box'; field: 'x' | 'y' | 'z' }
  | { primitive: 'Cylinder'; field: 'radius' | 'height' }
  | { primitive: 'Sphere'; field: 'radius' }
  | { primitive: 'Cone'; field: 'radius' | 'height' }
  | { primitive: 'Pyramid'; field: 'base' | 'height' }
)>;

const presets: SizePreset[] = [
  { key: 'box:x:20', primitive: 'Box', field: 'x', label: 'X · 20 mm', value: 20 },
  { key: 'box:x:30', primitive: 'Box', field: 'x', label: 'X · 30 mm', value: 30 },
  { key: 'box:x:40', primitive: 'Box', field: 'x', label: 'X · 40 mm', value: 40 },
  { key: 'box:y:20', primitive: 'Box', field: 'y', label: 'Y · 20 mm', value: 20 },
  { key: 'box:y:30', primitive: 'Box', field: 'y', label: 'Y · 30 mm', value: 30 },
  { key: 'box:y:40', primitive: 'Box', field: 'y', label: 'Y · 40 mm', value: 40 },
  { key: 'box:z:20', primitive: 'Box', field: 'z', label: 'Z · 20 mm', value: 20 },
  { key: 'box:z:30', primitive: 'Box', field: 'z', label: 'Z · 30 mm', value: 30 },
  { key: 'box:z:40', primitive: 'Box', field: 'z', label: 'Z · 40 mm', value: 40 },
  { key: 'cylinder:radius:3', primitive: 'Cylinder', field: 'radius', label: 'Radius · 3 mm', value: 3 },
  { key: 'cylinder:radius:5', primitive: 'Cylinder', field: 'radius', label: 'Radius · 5 mm', value: 5 },
  { key: 'cylinder:radius:8', primitive: 'Cylinder', field: 'radius', label: 'Radius · 8 mm', value: 8 },
  { key: 'cylinder:height:20', primitive: 'Cylinder', field: 'height', label: 'Height · 20 mm', value: 20 },
  { key: 'cylinder:height:40', primitive: 'Cylinder', field: 'height', label: 'Height · 40 mm', value: 40 },
  { key: 'cylinder:height:60', primitive: 'Cylinder', field: 'height', label: 'Height · 60 mm', value: 60 },
  { key: 'sphere:radius:5', primitive: 'Sphere', field: 'radius', label: 'Radius · 5 mm', value: 5 },
  { key: 'sphere:radius:10', primitive: 'Sphere', field: 'radius', label: 'Radius · 10 mm', value: 10 },
  { key: 'sphere:radius:15', primitive: 'Sphere', field: 'radius', label: 'Radius · 15 mm', value: 15 },
  { key: 'cone:radius:5', primitive: 'Cone', field: 'radius', label: 'Radius · 5 mm', value: 5 },
  { key: 'cone:radius:10', primitive: 'Cone', field: 'radius', label: 'Radius · 10 mm', value: 10 },
  { key: 'cone:radius:15', primitive: 'Cone', field: 'radius', label: 'Radius · 15 mm', value: 15 },
  { key: 'cone:height:20', primitive: 'Cone', field: 'height', label: 'Height · 20 mm', value: 20 },
  { key: 'cone:height:30', primitive: 'Cone', field: 'height', label: 'Height · 30 mm', value: 30 },
  { key: 'cone:height:40', primitive: 'Cone', field: 'height', label: 'Height · 40 mm', value: 40 },
  { key: 'pyramid:base:20', primitive: 'Pyramid', field: 'base', label: 'Base · 20 mm', value: 20 },
  { key: 'pyramid:base:30', primitive: 'Pyramid', field: 'base', label: 'Base · 30 mm', value: 30 },
  { key: 'pyramid:base:40', primitive: 'Pyramid', field: 'base', label: 'Base · 40 mm', value: 40 },
  { key: 'pyramid:height:20', primitive: 'Pyramid', field: 'height', label: 'Height · 20 mm', value: 20 },
  { key: 'pyramid:height:30', primitive: 'Pyramid', field: 'height', label: 'Height · 30 mm', value: 30 },
  { key: 'pyramid:height:40', primitive: 'Pyramid', field: 'height', label: 'Height · 40 mm', value: 40 },
];

/** Shared allowlist: UI labels and controller behavior use the same immutable entries. */
export const SIZE_PRESETS: readonly SizePreset[] = Object.freeze(presets.map(preset => Object.freeze(preset)));
const byKey = new Map(SIZE_PRESETS.map(preset => [preset.key, preset]));
export function getSizePreset(key: string): SizePreset | undefined { return byKey.get(key); }
