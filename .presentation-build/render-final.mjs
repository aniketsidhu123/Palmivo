import fs from 'node:fs/promises';
import {FileBlob,PresentationFile} from 'file:///C:/Program%20Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const file=process.argv[2]||'F:/SignToAST/submission/SignToAST_HackForge_2K26.pptx';
const dir='F:/SignToAST/.presentation-build/final';
await fs.mkdir(dir,{recursive:true});
const p=await PresentationFile.importPptx(await FileBlob.load(file));
for(const [i,slide]of p.slides.items.entries()){
 await fs.writeFile(`${dir}/slide-${i+1}.png`,new Uint8Array(await(await p.export({slide,format:'png',scale:1})).arrayBuffer()));
}
await fs.writeFile('F:/SignToAST/.presentation-build/final-content.ndjson',(await p.inspect({select:'$.slides[*]',include:['index','title','elements.name','elements.kind','elements.text','elements.position']})).ndjson);
console.log(`Rendered ${p.slides.items.length} final slides.`);
