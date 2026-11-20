"""Independent, standard-library inspection of the bytes of a binary STL.

Usage: python qa/verify_stl.py file.stl --dimensions 28 42 56 --through-hole
"""
import argparse
from collections import Counter, defaultdict
import json
import math
from pathlib import Path
import struct


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def hits_z(faces, x, y, z):
    """Count distinct surface intersections above a point (including shared triangle edges)."""
    origin = (x, y, z)
    hits = []
    for a, b, c in faces:
        ab, ac = sub(b, a), sub(c, a)
        h = (-ac[1], ac[0], 0)
        det = dot(ab, h)
        if abs(det) < 1e-9:
            continue
        s = sub(origin, a)
        u = dot(s, h) / det
        if u < -1e-7 or u > 1 + 1e-7:
            continue
        q = cross(s, ab)
        v = q[2] / det
        if v < -1e-7 or u + v > 1 + 1e-7:
            continue
        distance = dot(ac, q) / det
        if distance > 1e-7:
            hits.append(distance)
    hits.sort()
    distinct = 0
    previous = -math.inf
    for distance in hits:
        if distance - previous >= 1e-5:
            distinct += 1
            previous = distance
    return distinct


def inspect_bytes(raw, *, check_passage=True):
    """Audit normals, welded edges, winding, bounds and optional Z passage evidence."""
    if len(raw) < 84:
        raise ValueError("Incomplete binary STL")
    count = struct.unpack_from("<I", raw, 80)[0]
    if not count or len(raw) != 84 + 50 * count:
        raise ValueError("Triangle count does not match file length")
    faces = []
    vertices = set()
    edges = Counter()
    orientation = defaultdict(int)
    volume = 0
    for row in struct.iter_unpack("<12fH", memoryview(raw)[84:]):
        normal, a, b, c = row[:3], row[3:6], row[6:9], row[9:12]
        if not all(math.isfinite(n) for point in (normal, a, b, c) for n in point):
            raise ValueError("Nonfinite STL value")
        direction = cross(sub(b, a), sub(c, a))
        length = math.hypot(*direction)
        if length == 0:
            raise ValueError("Degenerate triangle")
        if abs(math.hypot(*normal) - 1) >= 1e-5:
            raise ValueError("Normal is not unit length")
        if dot(normal, direction) / length <= 0.99999:
            raise ValueError("Normal disagrees with winding")
        faces.append((a, b, c))
        vertices.update((a, b, c))
        volume += dot(a, cross(b, c)) / 6
        for start, end in ((a, b), (b, c), (c, a)):
            edge = tuple(sorted((start, end)))
            edges[edge] += 1
            orientation[edge] += 1 if start < end else -1
    closed = all(value == 2 for value in edges.values()) and all(value == 0 for value in orientation.values())
    if closed and volume <= 0:
        raise ValueError("Surface volume/winding invalid")
    bounds_min = [min(v[axis] for v in vertices) for axis in range(3)]
    bounds_max = [max(v[axis] for v in vertices) for axis in range(3)]
    dimensions = [b - a for a, b in zip(bounds_min, bounds_max)]
    euler = len(vertices) - len(edges) + count
    result = {
        "bytes": len(raw), "triangles": count, "vertices_after_welding": len(vertices),
        "dimensions_mm": dimensions, "signed_volume_mm3": volume,
        "closed_consistent_surface": closed, "euler_characteristic": euler,
    }
    if check_passage:
        passage = False
        if closed and euler == 0:
            x = (bounds_min[0] + bounds_max[0]) / 2
            y = (bounds_min[1] + bounds_max[1]) / 2
            z = math.nextafter(bounds_min[2] - 1, -math.inf)
            empty = hits_z(faces, x, y, z)
            dx, dy = dimensions[0] * .35, dimensions[1] * .35
            stock = [hits_z(faces, x + sx, y + sy, z) for sx, sy in ((dx, 0), (-dx, 0), (0, dy), (0, -dy))]
            result.update(center_hole_ray_hits=empty, adjacent_stock_ray_hits=stock[0])
            passage = empty == 0 and all(n == 2 for n in stock)
        result["center_passage"] = passage
    return result


def verify(path, expected_dimensions=None, expected_volume=None, through_hole=False):
    result = inspect_bytes(Path(path).read_bytes(), check_passage=through_hole)
    if not result["closed_consistent_surface"]:
        raise ValueError("Surface has boundary, nonmanifold or inconsistently wound edges")
    dimensions = result["dimensions_mm"]
    if expected_dimensions and not all(math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-5) for a, b in zip(dimensions, expected_dimensions)):
        raise ValueError(f"Unexpected dimensions: {dimensions}")
    volume = result["signed_volume_mm3"]
    if expected_volume is not None and not math.isclose(volume, expected_volume, rel_tol=1e-5, abs_tol=.001):
        raise ValueError(f"Unexpected volume: {volume}")
    if through_hole and not result["center_passage"]:
        raise ValueError("Expected a centred open Z through-hole and adjacent solid stock")
    return {"file": str(path), **result}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file")
    parser.add_argument("--dimensions", nargs=3, type=float)
    parser.add_argument("--volume", type=float)
    parser.add_argument("--through-hole", action="store_true")
    args = parser.parse_args()
    print(json.dumps(verify(args.file, args.dimensions, args.volume, args.through_hole), indent=2))
