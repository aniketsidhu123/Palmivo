import fs from 'node:fs/promises';
import {FileBlob, PresentationFile} from 'file:///C:/Program%20Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const dir='F:/SignToAST/.presentation-build';
const p=await PresentationFile.importPptx(await FileBlob.load('C:/Users/admin/Downloads/HackForge_2K26_PPT_Template.pptx'));
const inv=(await fs.readFile(`${dir}/original-inspect.ndjson`,'utf8')).trim().split('\n').map(JSON.parse);
const changed={};
function find(n,name){const e=inv[n-1].elements.find(e=>e.name===name);if(!e)throw Error(`Missing ${n}/${name}`);return p.resolve(e.id);}
const run=(text,bold=false,color='#FFFFFF',link)=>({run:text,style:{bold,color,typeface:'Calibri',fontSize:'18pt'},...(link?{link:{uri:link,isExternal:true}}:{})});
function fill(n,name,paragraphs,{center=false,insets=14,size=24}={}){
  const s=find(n,name);
  s.text=paragraphs.map(x=>typeof x==='string'?{runs:[run(x)],spaceAfter:4}:x);
  s.text.style={fontSize:size,typeface:'Calibri',color:'#FFFFFF',alignment:center?'center':'left',verticalAlignment:center?'middle':'top',insets,autoFit:'none',wrap:'square'};
  (changed[n]??=[]).push(name);return s;
}
function clear(n,name){find(n,name).text='';(changed[n]??=[]).push(name);}
function addText(n,name,text,pos,{size=24,color='#FFFFFF',bold=false,center=false}={}){
 const s=p.slides.items[n-1].shapes.add({name:`SignToAST ${name}`,geometry:'textbox',position:pos,fill:'none',line:{fill:'none',width:0},text:{text,style:{fontSize:size,typeface:'Calibri',color,bold,alignment:center?'center':'left',verticalAlignment:'middle',insets:0,autoFit:'none'}}});return s;
}
async function image(n,name,file,pos,crop){
 const bytes=await fs.readFile(file);
 p.slides.items[n-1].images.add({blob:bytes,contentType:'image/jpeg',alt:`SignToAST ${name}`,fit:'contain',position:pos,...(crop?{crop}:{})});
}
// Slide 1 is deliberately untouched.
fill(2,'Problem statement panel',[
 'A spatial CAD command needs more than a hand pose. It must retain intent across motion, resolve object references and make execution deliberate.'
],{insets:12});
[
 'Pose transitions can trigger accidental commands.',
 'Two-hand scale needs stable object references.',
 'Tracking gaps must freeze previews without committing.',
 'Users need exact sizes, recovery and reusable projects.',
 'Goal: local gesture CAD with visible command execution.'
].forEach((t,i)=>fill(2,`Point ${i+1}`,[t],{insets:{left:12,right:10,top:0,bottom:0},center:false}));
clear(2,'Caption');
await image(2,'precise size controls, actual Prototype 04','F:/SignToAST/docs/media/precise-size-presets.jpg',
 {left:867,top:192,width:246.4,height:420},{left:.735,top:.158,right:.041,bottom:.19});

fill(3,'Solution text panel',[
 {runs:[run('SignToAST',true)],spaceAfter:8},
 {runs:[run('IMPLEMENTED PROTOTYPE 04',true,'#FF1F3D')],spaceAfter:8},
 'MediaPipe landmarks + temporal gesture rules.',
 'Exact Box/Cylinder presets. Two-hand scale, planar move and real subtraction.',
 'Visible typed AST. Explicit Commit, Cancel and Undo.',
 'Local autosave, JSON reopening and keyboard recovery.',
 {runs:[run('FUTURE ML ROADMAP',true,'#FFD34D')],spaceBefore:10,spaceAfter:6},
 'Continuous CAD dataset and torso features.\nCausal ST-GCN + streaming CTC.\nONNX deployment benchmarks.'
],{insets:18});
find(3,'Solution text panel').text.get('IMPLEMENTED PROTOTYPE 04').color='#FF1F3D';
find(3,'Solution text panel').text.get('FUTURE ML ROADMAP').color='#FFD34D';
clear(3,'Caption');
await image(3,'reopened model with real Boolean through-hole','F:/SignToAST/docs/media/prototype04-reopened.jpg',
 {left:635,top:233,width:572,height:340},{left:.1565,top:0,right:.2838,bottom:.4101});

// Fill the template's workflow canvas with an editable architecture diagram.
clear(4,'Caption');
addText(4,'implemented flow label','IMPLEMENTED / PROTOTYPE 04',{left:83,top:203,width:1095,height:32},{color:'#FF1F3D',bold:true});
const labels=[['LOCAL CAMERA','New frame'],['HAND LANDMARKS','MediaPipe'],['TEMPORAL RULES','Pinch/dwell'],['COMMAND DRAFT','Preview'],['VALIDATED AST','Commit'],['SOLID SCENE','Manifold']];
const nodes=[];
labels.forEach(([heading,detail],i)=>{
 const left=82+i*190;
 const shape=p.slides.items[3].shapes.add({name:`SignToAST flow node ${i+1}`,geometry:'rect',position:{left,top:266,width:166,height:120},fill:'#17171D',line:{fill:'#FF1F3D',width:1},text:{text:[{runs:[run(heading,true)],spaceAfter:10},{runs:[{run:detail,style:{typeface:'Calibri',fontSize:'14pt',color:'#CCCCD2'}}]}],style:{fontSize:24,typeface:'Calibri',color:'#FFFFFF',alignment:'center',verticalAlignment:'middle',insets:8,autoFit:'none'}}});nodes.push(shape);
});
for(let i=0;i<nodes.length-1;i++)p.slides.items[3].shapes.connect(nodes[i],nodes[i+1],{kind:'straight',fromSide:'right',toSide:'left',line:{fill:'#8A8A94',width:2},head:{type:'arrow'}});
for(let i=0;i<5;i++)p.slides.items[3].shapes.add({name:`SignToAST flow arrow ${i+1}`,geometry:'rightArrow',position:{left:250+i*190,top:318,width:20,height:16},fill:'#B6B6C0',line:{fill:'none',width:0}});
addText(4,'recovery flow','Cancel discards a draft. Undo restores a snapshot. Tracking loss freezes movement.',{left:85,top:414,width:1110,height:46},{size:24});
addText(4,'future flow label','FUTURE ML RECOGNIZER / NOT IMPLEMENTED',{left:85,top:493,width:1100,height:32},{color:'#FFD34D',bold:true});
addText(4,'future flow detail','Custom continuous data, torso features, causal ST-GCN, streaming CTC and ONNX benchmarks',{left:85,top:535,width:1100,height:38},{size:24});
addText(4,'retained compiler','The learned recognizer will feed the existing draft, AST and geometry interfaces.',{left:85,top:581,width:1100,height:28},{size:21.33,color:'#CCCCD2'});

fill(5,'Tech panel 1',[
 'Windows laptop',
 'RTX 4050 available',
 'Fixed frontal webcam',
 '640 × 480 capture request',
 'Controlled lighting',
 'Chrome / Edge'
]);
fill(5,'Tech panel 2',[
 'Vite + TypeScript',
 'MediaPipe Hand Landmarker',
 'Temporal gesture rules',
 'Three.js WebGL2 renderer',
 'Manifold 3D WASM',
 'Vitest'
]);
fill(5,'Tech panel 3',[
 'Localhost static server',
 'Bundled Node runtime',
 'Local models and WASM',
 'Worker message passing',
 'IndexedDB + project JSON',
 'No cloud inference'
]);
['Calibrate','Recognize','Preview','Commit AST','Build + save'].forEach((t,i)=>fill(5,`Step label ${i+1}`,[t],{insets:2,center:true}));

const features=[
 ['Inspect commands','Typed AST for every\ncommitted CAD edit.'],
 ['Keep control','Commit, Cancel and\nsnapshot Undo.'],
 ['Shape in motion','Two-hand scaling\nand planar movement.'],
 ['Choose exact sizes','Independent box axes.\nCylinder radius/height.'],
 ['Compute locally','Bundled tracking and\nreal Boolean geometry.'],
 ['Continue later','Autosave and reopen\nexported project JSON.']
];
features.forEach(([title,body],i)=>{
 fill(6,`Feature icon slot ${i+1}`,[String(i+1).padStart(2,'0')],{insets:0,center:true});
 fill(6,`Feature card ${i+1}`,[{runs:[run(title,true)],spaceAfter:8},body],{insets:12});
});
['Gesture\ninput','Draft\npreview','Commit\ngate','Undo\nhistory','Project\nJSON'].forEach((t,i)=>fill(6,`Diagram node ${i+1}`,[t],{insets:2,center:true}));
fill(6,'Diagram core node',['Typed\nAST'],{insets:2,center:true});

fill(7,'Panel: FEASIBILITY',[
 'Implemented Prototype 04',
 '200 automated tests passed',
 '11 browser demo runs',
 '6 simulated gesture scenarios',
 'Portable local release'
],{insets:14});
fill(7,'Panel: CHALLENGES',[
 'Lighting and hand occlusion',
 'Prior camera test: 13–15 FPS',
 'Fresh live/offline checks due',
 'Future: trained ST-GCN + CTC',
 'Physical latency unverified'
],{insets:14});
fill(7,'Panel: COMPETITOR ANALYSIS',[
 'FreeCAD: general CAD',
 'OpenSCAD: scripted solids',
 'SignToAST: focused gesture CAD',
 'Visible AST and deliberate Commit'
],{insets:14});
const table=p.slides.items[6].tables.items[0];
const tableValues=[
 ['FEATURE','FREECAD','OPENSCAD','SIGNTOAST'],
 ['Workflow','GUI + Python','Script file','Gestures + keys'],
 ['Representation','Parametric objects','Script + CSG','Typed CAD AST'],
 ['Booleans','Open CASCADE','CSG','Manifold WASM'],
 ['Project save','FCStd','.scad source','Project JSON'],
 ['Execution','Desktop app','Desktop app','Local browser'],
 ['Scope','General CAD','Programmable solids','Focused demo']
];
for(let r=0;r<tableValues.length;r++)for(let c=0;c<4;c++){
 table.cells.set(r,c,tableValues[r][c]);
 table.getCell(r,c).text.style={fontSize:14.67,typeface:'Calibri',color:'#FFFFFF',alignment:r===0?'center':'left',bold:r===0,verticalAlignment:'middle',insets:{left:8,right:4,top:0,bottom:0},autoFit:'none'};
}

// On slide 8 only the references panel receives content.
const sources=[
 ['IMPLEMENTED TECHNOLOGIES',null],
 ['[1] MediaPipe Hand Landmarker (Web)','https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker?tab=Web'],
 ['[2] Three.js WebGLRenderer','https://threejs.org/docs/pages/WebGLRenderer.html'],
 ['[3] Manifold WASM Developer Guide','https://manifoldcad.org/docs/jsapi/'],
 ['FUTURE ML ROADMAP',null],
 ['[4] Yan et al. (2018), ST-GCN','https://arxiv.org/abs/1801.07455'],
 ['[5] Graves et al. (2006), CTC','https://www.cs.toronto.edu/~graves/icml_2006.pdf'],
 ['[6] ONNX Runtime Web documentation','https://onnxruntime.ai/docs/tutorials/web/'],
 ['COMPARISON SOURCES',null],
 ['[7] FreeCAD Features','https://freecad.github.io/Website/features/'],
 ['[8] OpenSCAD About and User Manual','https://openscad.org/about.html']
];
fill(8,'References panel',sources.map(([label,link])=>({runs:[run(label,!link,link?'#FFFFFF':label==='FUTURE ML ROADMAP'?'#FFD34D':'#FF1F3D',link)],spaceBefore:link?0:8,spaceAfter:6})),{insets:18});
for(const title of ['IMPLEMENTED TECHNOLOGIES','COMPARISON SOURCES'])find(8,'References panel').text.get(title).color='#FF1F3D';
find(8,'References panel').text.get('FUTURE ML ROADMAP').color='#FFD34D';
find(8,'References panel').text.get('User Manual').link={uri:'https://files.openscad.org/documentation/manual/OpenSCAD_User_Manual.pdf',isExternal:true};
const notes={
 2:'Project basis: README.md, docs/ARCHITECTURE.md and docs/VALIDATION.md in the SignToAST source. This is a constrained gesture-operated CAD prototype. It does not implement general sign-language interpretation. Image: actual Prototype 04 precise-size controls, camera off, docs/media/precise-size-presets.jpg.',
 3:'Implemented backend: MediaPipe hand landmarks plus deterministic temporal gesture rules. MediaPipe itself uses pretrained landmark ML. The planned custom learned recognizer is causal ST-GCN + streaming CTC. It has not been trained, exported, quantized or deployed. Screenshot: actual reopened Prototype 04 Boolean model, camera off. Sources: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker?tab=Web https://manifoldcad.org/docs/jsapi/ https://arxiv.org/abs/1801.07455 https://www.cs.toronto.edu/~graves/icml_2006.pdf https://onnxruntime.ai/docs/tutorials/web/',
 4:'The upper flow describes implemented local execution. Rendering and previews run on the main thread, with dedicated tracking and geometry workers. The lower roadmap is future work. Explicit Commit remains part of the planned learned system. Sub-15 ms rules/compiler timing does not establish physical motion-to-action latency. Sources: docs/ARCHITECTURE.md and docs/ROADMAP.md in the project source, plus the original ST-GCN and CTC papers.',
 5:'Pinned current dependencies: @mediapipe/tasks-vision 0.10.32, three 0.181.1, manifold-3d 3.3.2. Vite + TypeScript, IndexedDB, two workers, local static Node server. Capture requests 640x480 with ideal 60 FPS. Actual processed camera/tracking rate must be reported separately. No claim of 60 FPS tracking is made. Sources: package.json, src/main.ts, tracking/client.ts and docs/VALIDATION.md. API references: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker?tab=Web https://threejs.org/docs/pages/WebGLRenderer.html https://manifoldcad.org/docs/jsapi/',
 6:'All six capabilities describe implemented Prototype 04 functionality. Box preset dimensions are independent X/Y/Z values 20/30/40 mm. Cylinder presets are radius 3/5/8 mm and height 20/40/60 mm. These are illustrative CAD dimensions, not physical measurements. Opening project JSON retains recipes/transforms/command history. Session Undo snapshots start after opening. Sources: README.md, src/core/presets.ts, src/core/projectFile.ts and docs/VALIDATION.md.',
 7:'Verified on November 15, 2026: 200 tests across 16 source files. Six default/precise synthetic landmark integration scenarios at 13/30/60 FPS exercise recognition, activation, scale, controller and actual Manifold WASM. Eleven pointer/keyboard browser demo runs include one portable-release run. These are not eleven live-hand demonstrations. Prior live camera measurement was 13–15 processed FPS. Fresh physical gesture rehearsal, Wi-Fi-disabled reload and ten-minute soak remain presenter checks. Source: docs/VALIDATION.md and docs/media/prototype04-measurements.json. Competitive comparison concerns documented standard workflows and project representation, not every plugin/integration. FreeCAD: https://freecad.github.io/Website/features/ OpenSCAD: https://openscad.org/about.html Manual: https://files.openscad.org/documentation/manual/OpenSCAD_User_Manual.pdf pp23–24,39. Desktop builds: https://openscad.org/downloads.html'
};
for(const [n,text]of Object.entries(notes))p.slides.items[Number(n)-1].speakerNotes.text=text;
await fs.writeFile(`${dir}/changes.json`,JSON.stringify({changed,tableSlide:7,tableName:'Feature comparison table'},null,2));
await fs.mkdir(`${dir}/authored`,{recursive:true});
await(await PresentationFile.exportPptx(p)).save(`${dir}/authored.pptx`);
for(const [i,slide]of p.slides.items.entries()){
 await fs.writeFile(`${dir}/authored/slide-${i+1}.png`,new Uint8Array(await(await p.export({slide,format:'png',scale:1})).arrayBuffer()));
}
console.log('Authored 8 template slides. Cover and final link boxes untouched.');
