"""Keep the original package, transplant only authored content into its slots."""
import json, posixpath, copy
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

root=Path(r'F:\SignToAST\.presentation-build')
source=Path(r'C:\Users\admin\Downloads\HackForge_2K26_PPT_Template.pptx')
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
rel_ns='http://schemas.openxmlformats.org/package/2006/relationships'
ct_ns='http://schemas.openxmlformats.org/package/2006/content-types'
changed=json.loads((root/'changes.json').read_text())['changed']
with ZipFile(source) as original, ZipFile(root/'authored.pptx') as authored:
 data={n:original.read(n) for n in original.namelist()}
 types=E.fromstring(data['[Content_Types].xml'])
 report={'slides':8,'cover_byte_identical':False,'protected_last_shapes_identical':False,'changed_text_shapes':changed}
 def serialize(el):return E.tostring(el,xml_declaration=True,encoding='UTF-8',standalone=True)
 def shape(tree,name):
  for child in tree.find('p:cSld/p:spTree',ns):
   props=child.find('.//p:cNvPr',ns)
   if props is not None and props.get('name')==name:return child
  raise ValueError(f'No shape {name}')
 for num in range(2,9):
  part=f'ppt/slides/slide{num}.xml'
  tree=E.fromstring(data[part]); new=E.fromstring(authored.read(part))
  rel_part=f'ppt/slides/_rels/slide{num}.xml.rels'
  rels=E.fromstring(data[rel_part]); new_rels=E.fromstring(authored.read(rel_part))
  authored_rels={r.get('Id'):r for r in new_rels}
  ids={r.get('Id') for r in rels}; rel_map={}
  def import_relationship(old_id):
   if old_id in rel_map:return rel_map[old_id]
   entry=copy.deepcopy(authored_rels[old_id]);index=1
   while f'rIdSignToAST{index}' in ids:index+=1
   new_id=f'rIdSignToAST{index}';ids.add(new_id);rel_map[old_id]=new_id;entry.set('Id',new_id)
   if entry.get('TargetMode')!='External':
    target=posixpath.normpath(posixpath.join('ppt/slides',entry.get('Target'))).lstrip('/')
    if '/media/' not in target:raise ValueError(f'Unexpected content relation {target}')
    ext=target.rsplit('.',1)[-1];name=f'signtoast-s{num}-{index}.{ext}'
    data['ppt/media/'+name]=authored.read(target);entry.set('Target','../media/'+name)
    if not any(t.get('Extension')==ext for t in types):
     E.SubElement(types,f'{{{ct_ns}}}Default',Extension=ext,ContentType={'jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png'}[ext])
   rels.append(entry);return new_id
  def import_xml(el):
   el=copy.deepcopy(el)
   for node in el.iter():
    for key,value in list(node.attrib.items()):
     if key.startswith('{'+ns['r']+'}'):
      node.set(key,import_relationship(value))
   return el
  for name in changed.get(str(num),[]):
   target=shape(tree,name); body=target.find('p:txBody',ns)
   if body is not None:target.remove(body)
   target.append(import_xml(shape(new,name).find('p:txBody',ns)))
  if num==7:
   old_table=shape(tree,'Feature comparison table').find('.//a:tbl',ns)
   new_table=shape(new,'Feature comparison table').find('.//a:tbl',ns)
   old_cells=old_table.findall('a:tr/a:tc',ns); new_cells=new_table.findall('a:tr/a:tc',ns)
   assert len(old_cells)==len(new_cells)==28
   for old_cell,new_cell in zip(old_cells,new_cells):
    old_cell.remove(old_cell.find('a:txBody',ns));old_cell.insert(0,import_xml(new_cell.find('a:txBody',ns)))
  parent=tree.find('p:cSld/p:spTree',ns)
  used={int(n.get('id')) for n in tree.findall('.//p:cNvPr',ns)}
  next_id=max(used)+1
  for child in new.find('p:cSld/p:spTree',ns):
   props=child.find('.//p:cNvPr',ns)
   if props is None:continue
   is_screenshot=num in (2,3) and child.tag=='{'+ns['p']+'}pic'
   if is_screenshot or props.get('name','').startswith('SignToAST ') or props.get('descr','').startswith('SignToAST '):
    addition=import_xml(child)
    addition.find('.//p:cNvPr',ns).set('id',str(next_id));next_id+=1
    if is_screenshot:
     addition.find('.//p:cNvPr',ns).set('name',f'SignToAST screenshot {num}')
     addition.find('.//p:cNvPr',ns).set('descr','Actual Prototype 04 '+('precise size controls' if num==2 else 'reopened Boolean through-hole'))
    parent.append(addition)
  # The supplied template has duplicate object IDs on slides 6 and 7.
  # Renumber only those metadata duplicates without touching any geometry/style.
  seen=set()
  for prop in tree.findall('.//p:cNvPr',ns):
   if prop.get('id') in seen:prop.set('id',str(next_id));next_id+=1
   seen.add(prop.get('id'))
  data[part]=serialize(tree);data[rel_part]=serialize(rels)
  if num<8:
   note=f'ppt/notesSlides/notesSlide{num}.xml'
   old_note=E.fromstring(data[note]);new_note=E.fromstring(authored.read(note))
   old_matches=old_note.xpath('.//p:sp[p:nvSpPr/p:nvPr/p:ph[@type="body"]]',namespaces=ns)
   new_matches=new_note.xpath('.//p:sp[p:nvSpPr/p:nvPr/p:ph[@type="body"]]',namespaces=ns)
   old_body=old_matches[0] if old_matches else None
   new_body=new_matches[0] if new_matches else None
   if old_body is None or new_body is None:raise ValueError('Missing notes body')
   old_body.remove(old_body.find('p:txBody',ns));old_body.append(copy.deepcopy(new_body.find('p:txBody',ns)))
   data[note]=serialize(old_note)
 missing_overrides=[]
 for entry in list(types):
  target=entry.get('PartName','').lstrip('/')
  if entry.tag.endswith('Override') and target not in data:
   missing_overrides.append(target);types.remove(entry)
 report['removed_orphan_source_content_type_overrides']=missing_overrides
 data['[Content_Types].xml']=serialize(types)
 # Explicitly protect the cover and every shape outside the last reference box.
 assert data['ppt/slides/slide1.xml']==original.read('ppt/slides/slide1.xml')
 old_last=E.fromstring(original.read('ppt/slides/slide8.xml'));last=E.fromstring(data['ppt/slides/slide8.xml'])
 for child in old_last.find('p:cSld/p:spTree',ns):
  props=child.find('.//p:cNvPr',ns)
  if props is not None and props.get('name')!='References panel':
   assert E.tostring(child)==E.tostring(shape(last,props.get('name'))),props.get('name')
 report['cover_byte_identical']=True;report['protected_last_shapes_identical']=True
 # All source masters, layouts, themes and original images stay byte-for-byte unchanged.
 protected=[n for n in original.namelist() if n.startswith(('ppt/slideMasters/','ppt/slideLayouts/','ppt/theme/','ppt/media/'))]
 assert all(data[n]==original.read(n) for n in protected)
 report['unchanged_theme_layout_master_media_parts']=len(protected)
 with ZipFile(root/'preserved-candidate.pptx','w',ZIP_DEFLATED) as out:
  for n,value in data.items():out.writestr(n,value)
 (root/'template-preservation.json').write_text(json.dumps(report,indent=2))
 print('Preserved original template, cover, protected link boxes, editable table, content and images.')
