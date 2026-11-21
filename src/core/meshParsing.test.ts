import { describe, expect, it } from 'vitest';
import { parseMeshBytes } from './meshParsing';

const text = (source: string) => new TextEncoder().encode(source).buffer;
const cube = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
vn 0 0 -1
f 1//1 4//1 3//1 2//1
f -4 -3 -2 -1
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
`;
const tetrahedron = [
  [[0, 0, 0], [0, 1, 0], [1, 0, 0]],
  [[0, 0, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
];
function signedVolume({ positions, indices }: ReturnType<typeof parseMeshBytes>) {
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = Array.from(indices.slice(i, i + 3), index => positions.slice(index * 3, index * 3 + 3));
    volume += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return volume / 6;
}

describe('mesh file parsing', () => {
  it('accepts ASCII STL and identifies binary STL by structure even when its header starts with solid', () => {
    const ascii = 'solid fixture\n' + tetrahedron.map(face => [
      'facet normal 0 0 0', 'outer loop', ...face.map(p => `vertex ${p.join(' ')}`), 'endloop', 'endfacet',
    ].join('\n')).join('\n') + '\nendsolid fixture';
    const binary = new ArrayBuffer(84 + 50 * tetrahedron.length);
    new Uint8Array(binary).set(new TextEncoder().encode('solid binary fixture'));
    const view = new DataView(binary);
    view.setUint32(80, tetrahedron.length, true);
    tetrahedron.forEach((face, index) => face.flat().forEach((value, coordinate) =>
      view.setFloat32(96 + index * 50 + coordinate * 4, value, true)));
    const read = parseMeshBytes(text(ascii), 'stl', 'mm');
    expect(parseMeshBytes(binary, 'stl', 'mm')).toEqual(read);
    expect(read.positions).toHaveLength(12);
    expect(signedVolume(read)).toBeCloseTo(1 / 6);
    expect(() => parseMeshBytes(binary.slice(0, -1), 'stl', 'mm')).toThrow(/STL|facet/);
  });

  it('preserves OBJ winding when triangulating quads and converting source units', () => {
    const parsed = parseMeshBytes(text(cube), 'obj', 'cm');
    expect(parsed.positions).toHaveLength(24);
    expect(parsed.indices).toHaveLength(36);
    expect(signedVolume(parsed)).toBeCloseTo(1000);
  });

  it('triangulates a concave closed prism without filling its missing corner', () => {
    const xy = [[0,0],[2,0],[2,1],[1,1],[1,2],[0,2]];
    const cap = 'f 6 5 4 3 2 1\nf 7 8 9 10 11 12';
    const walls = xy.map((_, i) => {
      const next = (i + 1) % xy.length;
      return `f ${i + 1} ${next + 1} ${next + 7} ${i + 7}`;
    });
    const vertices = [0, 1].flatMap(z => xy.map(([x,y]) => `v ${x} ${y} ${z}`));
    expect(signedVolume(parseMeshBytes(text([...vertices, cap, ...walls].join('\n')), 'obj', 'mm'))).toBeCloseTo(3);
  });

  it('rejects out-of-range indices, malformed coordinates and unsupported warped faces', () => {
    expect(() => parseMeshBytes(text(cube.replace('4//1', '41//1')), 'obj', 'mm')).toThrow(/index/);
    expect(() => parseMeshBytes(text(cube.replace('0 0 0', '0 NaN 0')), 'obj', 'mm')).toThrow(/coordinate/);
    expect(() => parseMeshBytes(text(cube.replace('1 1 1', '1 1 1.1')), 'obj', 'mm')).toThrow(/non-planar/);
  });
});
