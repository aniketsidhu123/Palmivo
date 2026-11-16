// Developer-only reader verification. No application controller or export code is used.
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const host = document.querySelector<HTMLElement>('#view')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor('#10282b'); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); host.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#eef7de','#34535d',3));
const light = new THREE.DirectionalLight('#ffffff',3); light.position.set(1,-2,3); scene.add(light);
const camera = new THREE.PerspectiveCamera(38,1,.1,3000); camera.up.set(0,0,1);
const controls = new OrbitControls(camera,renderer.domElement); controls.enableDamping = true;
let mesh: THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>|null = null;
const resize = () => {renderer.setSize(host.clientWidth,host.clientHeight);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();};
new ResizeObserver(resize).observe(host); resize();
const render = () => {controls.update();renderer.render(scene,camera);requestAnimationFrame(render);}; render();
document.querySelector<HTMLInputElement>('#stl-file')!.addEventListener('change',async event=>{
 const file=(event.target as HTMLInputElement).files?.[0]; if(!file)return;
 const status=document.querySelector('#status')!;
 try{
  const geometry=new STLLoader().parse(await file.arrayBuffer()); geometry.computeBoundingBox();
  const bounds=geometry.boundingBox!;if(bounds.isEmpty())throw Error('Empty STL');
  if(mesh){scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
  mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:'#b8d7b3',roughness:.65,metalness:.08,flatShading:true}));scene.add(mesh);
  const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const distance=Math.max(30,Math.max(size.x,size.y,size.z)*2.8);
  camera.position.copy(center).add(new THREE.Vector3(.7,-1.1,1.5).normalize().multiplyScalar(distance));controls.target.copy(center);camera.lookAt(center);
  const positions=geometry.getAttribute('position');let volume=0;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(let i=0;i<positions.count;i+=3){a.fromBufferAttribute(positions,i);b.fromBufferAttribute(positions,i+1);c.fromBufferAttribute(positions,i+2);volume+=a.dot(b.cross(c))/6;}
  document.querySelector('#filename')!.textContent=file.name;
  document.querySelector('#dimensions')!.textContent=size.toArray().map(n=>n.toFixed(2)).join(' × ');
  document.querySelector('#triangles')!.textContent=String(positions.count/3);
  document.querySelector('#volume')!.textContent=volume.toFixed(3);
  status.textContent='Loaded from STL file. Drag to inspect; scroll to zoom. Units are interpreted as millimetres.';
 }catch(error){status.textContent=`Verification failed: ${error instanceof Error?error.message:'Invalid STL'}`;}
});
