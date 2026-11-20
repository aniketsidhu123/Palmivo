# Example projects and exports

| File | Content |
| --- | --- |
| [through-hole-project.json](through-hole-project.json) | Editable example containing a Boolean subtraction recipe |
| [precise-through-hole-project.json](precise-through-hole-project.json) | A 20 × 30 × 40 mm box scaled to 1.4×, with a radius 3 mm cutter |
| [subtract-command.json](subtract-command.json) | Example resolved subtraction execution request |
| [scaled-box-mm.stl](scaled-box-mm.stl) | The 28 × 42 × 56 mm scaled box surface |
| [through-hole-mm.stl](through-hole-mm.stl) | The same outer dimensions after the centered through-hole subtraction |
| [flanged-guide-bushing-project.json](flanged-guide-bushing-project.json) | Editable v2 project combining a square flange and cylindrical sleeve with Union, then cutting a 6 mm bore |
| [flanged-guide-bushing-mm.stl](flanged-guide-bushing-mm.stl) | Verified 20 × 20 × 40 mm bushing with 400 triangles and an open central bore |

Use **Open project** for editable project JSON. Import STL coordinates as millimetres in a mesh viewer or slicer.

The through-hole STL contains 144 triangles and has signed volume 64,282.792 mm³. The independent audit verifies a closed, consistently oriented surface, an open central bore, and material beside the bore. Verification reports live in [../docs/benchmarks/](../docs/benchmarks/README.md).
