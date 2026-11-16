"""Independent binary STL audit using only Python's standard library.

Usage: python qa/verify_stl.py file.stl --dimensions 28 42 56 --through-hole
This reads downloaded bytes, without importing any Palmivo exporter code.
"""
import argparse
from collections import Counter, defaultdict
import json
import math
from pathlib import Path
import struct

def sub(a,b): return tuple(x-y for x,y in zip(a,b))
def cross(a,b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def dot(a,b): return sum(x*y for x,y in zip(a,b))

def hits_z(faces,x,y,z):
    origin=(x,y,z);direction=(0,0,1);hits=[]
    for a,b,c in faces:
        ab=sub(b,a);ac=sub(c,a);h=cross(direction,ac);det=dot(ab,h)
        if abs(det)<1e-9: continue
        f=1/det;s=sub(origin,a);u=f*dot(s,h)
        if u < -1e-7 or u > 1+1e-7:continue
        q=cross(s,ab);v=f*dot(direction,q)
        if v < -1e-7 or u+v > 1+1e-7:continue
        distance=f*dot(ac,q)
        if distance>1e-7 and not any(abs(distance-old)<1e-5 for old in hits):hits.append(distance)
    return len(hits)

def verify(path,expected_dimensions=None,expected_volume=None,through_hole=False):
    raw=Path(path).read_bytes()
    assert len(raw)>=84,'Incomplete binary STL'
    count=struct.unpack_from('<I',raw,80)[0]
    assert count>0 and len(raw)==84+50*count,'Triangle count does not match file length'
    faces=[];vertices=set();edges=Counter();orientation=defaultdict(int);volume=0
    for i in range(count):
        row=struct.unpack_from('<12fH',raw,84+i*50)
        assert all(math.isfinite(n) for n in row[:12]),'Nonfinite STL value'
        normal=row[:3];a=row[3:6];b=row[6:9];c=row[9:12]
        direction=cross(sub(b,a),sub(c,a));length=math.sqrt(dot(direction,direction))
        assert length>0,'Degenerate triangle'
        assert abs(math.sqrt(dot(normal,normal))-1)<1e-5,'Normal is not unit length'
        assert dot(normal,direction)/length>0.99999,'Normal disagrees with winding'
        faces.append((a,b,c));vertices.update((a,b,c));volume+=dot(a,cross(b,c))/6
        for start,end in ((a,b),(b,c),(c,a)):
            key=tuple(sorted((start,end)));edges[key]+=1;orientation[key]+=1 if start<end else -1
    assert all(n==2 for n in edges.values()),'Surface has boundary or nonmanifold edges'
    assert all(n==0 for n in orientation.values()),'Surface edge winding is inconsistent'
    bounds_min=[min(v[axis] for v in vertices) for axis in range(3)]
    bounds_max=[max(v[axis] for v in vertices) for axis in range(3)]
    dimensions=[b-a for a,b in zip(bounds_min,bounds_max)]
    assert volume>0,'Surface volume/winding invalid'
    if expected_dimensions:
        assert all(math.isclose(a,b,rel_tol=1e-6,abs_tol=1e-5) for a,b in zip(dimensions,expected_dimensions)),f'Unexpected dimensions: {dimensions}'
    if expected_volume is not None:
        assert math.isclose(volume,expected_volume,rel_tol=1e-5,abs_tol=.001),f'Unexpected volume: {volume}'
    euler=len(vertices)-len(edges)+count
    result={'file':str(path),'bytes':len(raw),'triangles':count,'vertices_after_welding':len(vertices),'dimensions_mm':dimensions,'signed_volume_mm3':volume,'closed_consistent_surface':True,'euler_characteristic':euler}
    if through_hole:
        x=(bounds_min[0]+bounds_max[0])/2;y=(bounds_min[1]+bounds_max[1])/2;z=bounds_min[2]-1
        empty=hits_z(faces,x,y,z);stock=hits_z(faces,x+dimensions[0]*.35,y,z)
        assert empty==0 and stock==2,'Expected centered open Z through-hole and adjacent solid stock'
        assert euler==0,'Expected a single-handle through-hole surface'
        result.update({'center_hole_ray_hits':empty,'adjacent_stock_ray_hits':stock})
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file');parser.add_argument('--dimensions',nargs=3,type=float);parser.add_argument('--volume',type=float);parser.add_argument('--through-hole',action='store_true')
    args=parser.parse_args();print(json.dumps(verify(args.file,args.dimensions,args.volume,args.through_hole),indent=2))
