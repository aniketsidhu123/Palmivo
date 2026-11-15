import * as THREE from 'three';
import type { ControllerState, GeometryMesh, Solid, Vec3 } from '../shared/types';

interface MeshEntry {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  source: GeometryMesh | null;
  recipe: Solid['recipe'];
}

/** Renderer has no authority to commit edits. All preview transforms come from the controller. */
export class CADViewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(34, 1, .1, 1500);
  readonly scene = new THREE.Scene();
  onFrame?: (frameMs: number) => void;
  readonly diagnostics = { structuralUpdates: 0, previewUpdates: 0, outlineCreations: 0, geometryCreations: 0 };
  private readonly host: HTMLElement;
  private readonly solids = new Map<string, MeshEntry>();
  private readonly solidGroup = new THREE.Group();
  private readonly target = new THREE.Vector3(0, 0, 0);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly observer: ResizeObserver;
  private outline: THREE.BoxHelper | null = null;
  private outlinedMesh: THREE.Object3D | null = null;
  private frame = 0;
  private lastTime = 0;
  private disposed = false;
  private state: ControllerState | null = null;
  private readonly floor: THREE.Mesh;
  private readonly grid: THREE.GridHelper;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x142b2d, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive solid modelling viewport');
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);

    this.scene.fog = new THREE.FogExp2(0x142b2d, .0045);
    this.scene.add(new THREE.HemisphereLight(0xcdf2e1, 0x263e43, 2.7));
    const key = new THREE.DirectionalLight(0xe2ffdf, 3.2);
    key.position.set(25, 65, 50);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 1, far: 220 });
    key.shadow.bias = -.0003;
    key.shadow.normalBias = .05;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x73b0bb, 2.6);
    rim.position.set(-60, 10, -35); this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xe4d5ae, 1.2);
    fill.position.set(65, -5, 40); this.scene.add(fill);

    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x142c2c, roughness: 1, metalness: 0 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -17;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.grid = new THREE.GridHelper(400, 80, 0x456c5f, 0x294b43);
    this.grid.position.y = -16.98;
    this.grid.material.transparent = true;
    this.grid.material.opacity = .5;
    this.scene.add(this.grid);
    this.scene.add(this.solidGroup);

    this.resetCamera();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.animate(0);
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private animate = (time: number): void => {
    if (this.disposed) return;
    const elapsed = time - this.lastTime;
    this.lastTime = time;
    if (time && elapsed > 0) this.onFrame?.(elapsed);
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  };

  update(state: ControllerState, meshes: Map<string, GeometryMesh>): void {
    if (this.disposed) return;
    this.diagnostics.structuralUpdates++;
    this.state = state;
    const solids = [...state.scene.solids];
    if (state.draft?.kind === 'create') solids.push(state.draft.solid);
    const ids = new Set(solids.map(solid => solid.id));
    for (const [id, entry] of this.solids) {
      if (!ids.has(id)) { this.disposeEntry(entry); this.solids.delete(id); }
    }
    for (const solid of solids) {
      const source = meshes.get(solid.id) ?? null;
      let entry = this.solids.get(solid.id);
      if (!entry || entry.source !== source || entry.recipe !== solid.recipe && !source) {
        if (entry) this.disposeEntry(entry);
        const geometry = source ? this.fromMesh(source) : this.previewGeometry(solid);
        this.diagnostics.geometryCreations++;
        const material = new THREE.MeshStandardMaterial({ color: solid.color || '#bce8cc', roughness: .5, metalness: .12, side: THREE.FrontSide, flatShading: true });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData.solidId = solid.id;
        entry = { mesh, source, recipe: solid.recipe };
        this.solids.set(solid.id, entry);
        this.solidGroup.add(mesh);
      }
      const mesh = entry.mesh;
      const move = state.draft?.kind === 'move' && state.draft.targetId === solid.id ? state.draft.position : solid.position;
      const scale = state.draft?.kind === 'scale' && state.draft.targetId === solid.id ? state.draft.uniformScale : solid.scale;
      mesh.position.set(...move);
      mesh.scale.setScalar(scale);
      const isPreview = state.draft?.kind === 'create' && state.draft.solid.id === solid.id;
      const isCutter = state.draft?.kind === 'subtract' && state.draft.cutterId === solid.id;
      mesh.material.color.set(isCutter ? '#ef9f83' : solid.color || '#bce8cc');
      const transparent = isPreview || isCutter;
      const depthWrite = !isCutter;
      const materialFlagsChanged = mesh.material.transparent !== transparent || mesh.material.depthWrite !== depthWrite;
      mesh.material.transparent = transparent;
      mesh.material.opacity = isCutter ? .43 : isPreview ? .76 : 1;
      mesh.material.depthWrite = depthWrite;
      mesh.material.emissive.set(isPreview ? '#153c26' : '#000000');
      if (materialFlagsChanged) mesh.material.needsUpdate = true;
      mesh.updateMatrixWorld(true);
    }
    const outlinedId = state.draft?.kind === 'create' ? state.draft.solid.id : state.selectedId;
    this.updateOutline(outlinedId ? this.solids.get(outlinedId)?.mesh ?? null : null);
    this.updateFloor();
  }

  /** Hot path: the controller draft identity and scene are unchanged. */
  updatePreview(state: ControllerState): void {
    if (this.disposed) return;
    this.diagnostics.previewUpdates++;
    this.state = state;
    const draft = state.draft;
    if (draft?.kind !== 'move' && draft?.kind !== 'scale') return;
    const mesh = this.solids.get(draft.targetId)?.mesh;
    if (!mesh) return;
    if (draft.kind === 'move') mesh.position.set(...draft.position);
    else mesh.scale.setScalar(draft.uniformScale);
    mesh.updateMatrixWorld(true);
    // No geometry, material, or helper allocations while the hands manipulate a draft.
    this.outline?.update();
    this.updateFloor();
  }

  private updateFloor(): void {
    // A larger preset or a lowered solid must remain above the decorative floor.
    // Bounding boxes are cached per geometry; continuous transforms allocate nothing.
    let floorY = -17;
    for (const { mesh } of this.solids.values()) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const minY = mesh.geometry.boundingBox?.min.y;
      if (minY !== undefined && Number.isFinite(minY)) floorY = Math.min(floorY, mesh.position.y + minY * mesh.scale.y - 1);
    }
    this.floor.position.y = floorY;
    this.grid.position.y = floorY + .02;
  }

  private updateOutline(selected: THREE.Object3D | null): void {
    if (!selected) { this.disposeOutline(); return; }
    if (!this.outline) {
      this.outline = new THREE.BoxHelper(selected, 0xb8dea2);
      this.diagnostics.outlineCreations++;
      this.outline.material.transparent = true;
      this.outline.material.opacity = .38;
      this.scene.add(this.outline);
    } else if (this.outlinedMesh !== selected) this.outline.setFromObject(selected);
    else this.outline.update();
    this.outlinedMesh = selected;
  }

  private disposeOutline(): void {
    if (!this.outline) return;
    this.scene.remove(this.outline);
    this.outline.geometry.dispose();
    this.outline.material.dispose();
    this.outline = null;
    this.outlinedMesh = null;
  }

  private fromMesh(source: GeometryMesh): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(source.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(source.indices, 1));
    if (source.normals?.length === source.positions.length) geometry.setAttribute('normal', new THREE.BufferAttribute(source.normals, 3));
    else geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private previewGeometry(solid: Solid): THREE.BufferGeometry {
    const recipe = solid.recipe;
    if (recipe.kind === 'box') return new THREE.BoxGeometry(...recipe.dimensions);
    if (recipe.kind === 'cylinder') {
      const geometry = new THREE.CylinderGeometry(recipe.radius, recipe.radius, recipe.height, recipe.segments, 1);
      geometry.rotateX(Math.PI / 2);
      return geometry;
    }
    // A restored Boolean remains invisible until its authoritative worker mesh is ready.
    return new THREE.BufferGeometry();
  }

  private setRay(clientX: number, clientY: number): boolean {
    const bounds = this.host.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return false;
    this.pointer.set((clientX - bounds.left) / bounds.width * 2 - 1, -(clientY - bounds.top) / bounds.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return true;
  }

  pick(clientX: number, clientY: number): string | null {
    if (!this.setRay(clientX, clientY)) return null;
    const hits = this.raycaster.intersectObjects(this.solidGroup.children, false);
    for (const hit of hits) {
      const id = hit.object.userData.solidId as string;
      if (this.state?.scene.solids.some(solid => solid.id === id)) return id;
    }
    return null;
  }

  pointOnPlane(clientX: number, clientY: number, z: number): Vec3 | null {
    if (!this.setRay(clientX, clientY)) return null;
    const intersection = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), new THREE.Vector3());
    return intersection ? [intersection.x, intersection.y, intersection.z] : null;
  }

  resetCamera(): void {
    this.target.set(0, 0, 0);
    this.camera.position.set(65, 46, 105);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  fit(): void {
    if (!this.solids.size) { this.resetCamera(); return; }
    const bounds = new THREE.Box3().setFromObject(this.solidGroup);
    if (bounds.isEmpty()) { this.resetCamera(); return; }
    bounds.getCenter(this.target);
    const size = bounds.getSize(new THREE.Vector3());
    const distance = Math.max(90, Math.max(size.x / this.camera.aspect, size.y, size.z) * 2.7);
    this.camera.position.copy(this.target).add(new THREE.Vector3(.52, .37, .84).normalize().multiplyScalar(distance));
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  private disposeEntry(entry: MeshEntry): void {
    this.solidGroup.remove(entry.mesh);
    entry.mesh.geometry.dispose(); entry.mesh.material.dispose();
  }

  dispose(): void {
    this.disposed = true; cancelAnimationFrame(this.frame); this.observer.disconnect();
    for (const entry of this.solids.values()) this.disposeEntry(entry);
    this.solids.clear();
    this.disposeOutline();
    this.floor.geometry.dispose(); (this.floor.material as THREE.Material).dispose();
    this.grid.geometry.dispose(); this.grid.material.dispose();
    this.scene.traverse(object => { if (object instanceof THREE.DirectionalLight) object.shadow.dispose(); });
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
