import { loadProjectFolder, saveProjectFolder } from '../storage';
import { readSiblingMaterials } from '../core/meshFile';

type ProjectFolder = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemHandle>;
};
type WindowWithFolderPicker = Window & {
  showDirectoryPicker?(options: { id: string; mode: 'read' }): Promise<ProjectFolder>;
};
const PAGE_SIZE = 5;
type ProjectSelection = { file: File; materials: File[] };

/** List files from a user-approved folder inside Palmivo, where hand gestures can reach them. */
export async function chooseProjectFromFolder(): Promise<ProjectSelection | null> {
  const picker = (window as WindowWithFolderPicker).showDirectoryPicker;
  const dialog = document.createElement('dialog');
  dialog.className = 'project-review project-folder';
  dialog.setAttribute('aria-labelledby', 'project-folder-title');
  dialog.innerHTML = `
    <h2 id="project-folder-title">Open project</h2>
    <p>Select a JSON, STL or OBJ file from a folder you approve.</p>
    <p id="project-folder-status" role="status"></p>
    <div class="project-folder-files"></div>
    <div class="project-folder-pages" hidden>
      <button class="outline-button" data-gesture="project-prev">Previous</button>
      <span></span>
      <button class="outline-button" data-gesture="project-next">Next</button>
    </div>
    <div class="project-review-actions">
      <button class="cancel-button" data-gesture="folder-cancel">Cancel</button>
      <button class="outline-button" id="project-folder-choose" data-gesture="folder-choose">Choose folder</button>
    </div>`;
  const status = dialog.querySelector<HTMLElement>('[role=status]')!;
  const filesArea = dialog.querySelector<HTMLElement>('.project-folder-files')!;
  const pages = dialog.querySelector<HTMLElement>('.project-folder-pages')!;
  const prev = pages.querySelector<HTMLButtonElement>('[data-gesture=project-prev]')!;
  const next = pages.querySelector<HTMLButtonElement>('[data-gesture=project-next]')!;
  const choose = dialog.querySelector<HTMLButtonElement>('#project-folder-choose')!;
  let files: FileSystemFileHandle[] = [];
  let page = 0;
  let activeFolder: ProjectFolder | null = null;
  let selected: ProjectSelection | null = null;
  let busy = false;
  const setStatus = (message: string) => { status.textContent = message; };
  const changePage = (offset: number) => { if (busy) return; page += offset; render(); };
  prev.onclick = () => changePage(-1);
  next.onclick = () => changePage(1);
  dialog.querySelector<HTMLButtonElement>('[data-gesture=folder-cancel]')!.onclick = () => dialog.close();
  choose.disabled = true;
  if (!picker) choose.hidden = true;

  function render() {
    const pageCount = Math.ceil(files.length / PAGE_SIZE);
    pages.hidden = pageCount <= 1;
    prev.disabled = busy || page === 0;
    next.disabled = busy || page + 1 >= pageCount;
    pages.querySelector('span')!.textContent = `${page + 1} / ${pageCount}`;
    filesArea.replaceChildren(...files.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((handle, index) => {
      const button = document.createElement('button');
      button.className = 'outline-button';
      button.dataset.gesture = `project-file-${page * PAGE_SIZE + index}`;
      button.textContent = handle.name;
      button.disabled = busy;
      button.onclick = async () => {
        if (busy) return;
        busy = choose.disabled = true;
        render();
        try {
          const file = await handle.getFile();
          const materials = activeFolder ? await readSiblingMaterials(file, activeFolder) : [];
          if (dialog.open) { selected = { file, materials }; dialog.close(); }
        } catch {
          setStatus('The file could not be read. Check the folder or choose it again.');
        } finally {
          busy = choose.disabled = false;
          render();
        }
      };
      return button;
    }));
  }
  async function list(folder: ProjectFolder) {
    const matches: FileSystemFileHandle[] = [];
    for await (const entry of folder.values()) {
      if (entry.kind === 'file' && /\.(json|stl|obj)$/i.test(entry.name)) matches.push(entry as FileSystemFileHandle);
    }
    if (!dialog.open) return;
    files = matches.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    activeFolder = folder;
    page = 0;
    setStatus(files.length ? `${folder.name} · ${files.length} file${files.length === 1 ? '' : 's'}` : `${folder.name} has no JSON, STL or OBJ files.`);
  }
  choose.addEventListener('click', async () => {
    if (!picker || busy) return;
    if (!navigator.userActivation?.isActive) {
      setStatus('Press Enter to choose a folder and grant read access.');
      choose.focus();
      return;
    }
    choose.disabled = busy = true;
    render();
    try {
      const folder = await picker.call(window, { id: 'palmivo-projects', mode: 'read' });
      if (!dialog.open) return;
      await list(folder);
      void saveProjectFolder(folder).catch(() => undefined);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('Could not read that folder. Choose a folder you can access.');
    } finally {
      busy = choose.disabled = false;
      render();
    }
  });

  document.body.append(dialog);
  try {
    return await new Promise<ProjectSelection | null>(resolve => {
      dialog.addEventListener('close', () => resolve(selected), { once: true });
      dialog.showModal();
      if (!picker) {
        setStatus('Use Chrome or Edge for folder access, or press Escape and open a file with the keyboard.');
        return;
      }
      setStatus('Checking your last folder…');
      busy = true;
      void loadProjectFolder().then(folder => {
        if (!dialog.open) return;
        if (!folder) setStatus('Choose a folder to start. The browser asks for permission.');
        else return list(folder as ProjectFolder);
      }).catch(() => setStatus('Choose the folder again to renew access.'))
        .finally(() => { busy = choose.disabled = false; render(); });
    });
  } finally { dialog.remove(); }
}
