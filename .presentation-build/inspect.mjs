import fs from 'node:fs/promises';
import {FileBlob, PresentationFile} from 'file:///C:/Program%20Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const dir='F:/SignToAST/.presentation-build';
await fs.mkdir(`${dir}/original`,{recursive:true});
const presentation=await PresentationFile.importPptx(await FileBlob.load('C:/Users/admin/Downloads/HackForge_2K26_PPT_Template.pptx'));
const inspected=await presentation.inspect({select:'$.slides[*]',include:['id','index','title','layout','elements.id','elements.kind','elements.name','elements.text','elements.position','elements.style','elements.paragraphs']});
await fs.writeFile(`${dir}/original-inspect.ndjson`,inspected.ndjson);
console.log('Slides',presentation.slides.items.length,'masters',presentation.masters.items.length);
for(const [index,slide] of presentation.slides.items.entries()){
  await fs.writeFile(`${dir}/original/slide-${index+1}.png`,new Uint8Array(await(await presentation.export({slide,format:'png',scale:1})).arrayBuffer()));
  console.log('Rendered',index+1);
}
