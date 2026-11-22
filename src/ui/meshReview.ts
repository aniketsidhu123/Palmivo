import { readMeshFile } from '../core/meshFile';

type ReviewedMesh = Awaited<ReturnType<typeof readMeshFile>>;
type MeshUnit = 'mm' | 'cm' | 'in';

/** Review file units before placing the validated mesh in the editable viewport. */
export async function reviewMeshFile(file: File, initial: ReviewedMesh, materials: readonly File[] = []): Promise<ReviewedMesh | null> {
  const dialog = document.createElement('dialog');
  dialog.className = 'project-review';
  dialog.id = 'mesh-review';
  dialog.setAttribute('aria-labelledby', 'mesh-review-title');
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="mesh-review-title">Import a solid</h2>
      <p>Palmivo combines the file’s geometry into one editable solid. Choose the units used by the source file.</p>
      <div class="project-review-file"><strong></strong><span role="status"></span></div>
      <p class="project-review-note" id="mesh-colour-note"></p>
      <div class="mesh-source-units" role="group" aria-label="Source units">
        <button type="button" class="outline-button" data-unit="mm" data-gesture="mesh-mm" aria-pressed="true">Millimetres</button>
        <button type="button" class="outline-button" data-unit="cm" data-gesture="mesh-cm" aria-pressed="false">Centimetres</button>
        <button type="button" class="outline-button" data-unit="in" data-gesture="mesh-in" aria-pressed="false">Inches</button>
      </div>
      <div class="project-review-actions">
        <button value="cancel" class="cancel-button" data-gesture="cancel-import">Cancel import</button>
        <button value="preview" class="commit-button" data-gesture="preview-import">Preview solid</button>
      </div>
    </form>`;
  const summary = dialog.querySelector('[role="status"]')!;
  dialog.querySelector('#mesh-colour-note')!.textContent = initial.mesh.colors
    ? 'The preview will use the source colours.'
    : /\.stl$/i.test(file.name)
      ? 'This STL contains geometry only. Choose a body colour in the preview.'
      : 'No source colours were found. Reopen the OBJ with its matching MTL, or choose a body colour in the preview.';
  const units = [...dialog.querySelectorAll<HTMLButtonElement>('[data-unit]')];
  const preview = dialog.querySelector<HTMLButtonElement>('button[value="preview"]')!;
  dialog.querySelector('strong')!.textContent = file.name;
  let reviewed: ReviewedMesh | null = initial;
  function describe(mesh: ReviewedMesh) {
    const dimensions = mesh.dimensions.map(value => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 7 }).format(value));
    summary.textContent = `${dimensions.join(' × ')} mm · ${(mesh.mesh.indices.length / 3).toLocaleString()} triangles`;
  }
  describe(initial);
  for (const button of units) button.addEventListener('click', async () => {
    const unit = button.dataset.unit as MeshUnit;
    if (reviewed && button.getAttribute('aria-pressed') === 'true') return;
    reviewed = null;
    preview.disabled = true;
    for (const item of units) {
      item.disabled = true;
      item.setAttribute('aria-pressed', String(item === button));
    }
    summary.textContent = 'Checking dimensions…';
    try {
      reviewed = unit === 'mm' ? initial : await readMeshFile(file, unit, materials);
      describe(reviewed);
    } catch (error) {
      summary.textContent = error instanceof Error ? error.message : 'Could not apply source units.';
    } finally {
      for (const item of units) item.disabled = false;
      preview.disabled = !reviewed;
    }
  });
  document.body.append(dialog);
  try {
    return await new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'preview' ? reviewed : null), { once: true });
      dialog.showModal();
    });
  } finally {
    dialog.remove();
  }
}
