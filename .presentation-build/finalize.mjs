import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {finalizePresentation} from 'file:///C:/Users/admin/.codex/plugins/cache/openai-primary-runtime/presentations/26.1112.11217/skills/presentations/container_tools/artifact_tool_utils.mjs';
const skill='C:/Users/admin/.codex/plugins/cache/openai-primary-runtime/presentations/26.1112.11217/skills/presentations';
const source='C:/Users/admin/Downloads/HackForge_2K26_PPT_Template.pptx';
const result=await finalizePresentation({
 workspaceDir:'F:/SignToAST',
 candidatePath:'F:/SignToAST/.presentation-build/preserved-candidate.pptx',
 finalPath:'F:/SignToAST/submission/SignToAST_HackForge_2K26_Final.pptx',
 pythonExecutable:'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/python/python.exe',
 integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),
 layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),
 explicitTotalSlideCount:8,
 sourceTemplatePath:source,
 requiredTemplateReferenceSlides:[1,2,3,4,5,6,7,8],
 minimumTemplateCoverageRatio:1,
 requireExactTemplateDimensions:true,
 requireTemplatePlaceholderGeometry:true,
 requiredNativeTableOwnerSlides:[7],
 requiredNativeChartOwnerSlides:[],
 fontPolicy:{basis:'reference',families:['Arial','Arial Black','Calibri'],referencePath:source,referenceSha256:createHash('sha256').update(await fs.readFile(source)).digest('hex')},
 layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit','--require-native-table-slide','7'],
 verifyArtifactToolImport:true,
 receiptPath:'F:/SignToAST/.presentation-build/final-validation.json'
});
console.log(JSON.stringify(result,null,2));
