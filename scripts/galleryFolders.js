import { MODULE_ID } from "./settings.js";

const DRAG_TYPE = `application/x-${MODULE_ID}`;

export function normalizeVirtualFolders(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  const assignedPaths = new Set();
  return value.flatMap((folder) => {
    if (!folder || typeof folder.id !== "string" || !folder.id || ids.has(folder.id)) return [];
    const name = typeof folder.name === "string" ? folder.name.trim() : "";
    if (!name) return [];
    ids.add(folder.id);
    const images = (Array.isArray(folder.images) ? folder.images : []).filter((path) => {
      if (typeof path !== "string" || !path || assignedPaths.has(path)) return false;
      assignedPaths.add(path);
      return true;
    });
    return [{ id: folder.id, name, images }];
  });
}

export function moveImagesToVirtualFolder(folders, paths, folderId) {
  if (folderId && !folders.some((folder) => folder.id === folderId)) {
    throw new Error("The destination virtual folder no longer exists.");
  }
  const moving = new Set(paths);
  return folders.map((folder) => ({
    ...folder,
    images: folder.id === folderId
      ? Array.from(new Set([...folder.images, ...moving]))
      : folder.images.filter((path) => !moving.has(path))
  }));
}

export const GalleryFoldersMixin = (Base) => class extends Base {
  _getVirtualFolders() {
    const saved = game.settings.get(MODULE_ID, "virtualFolders");
    if (this._virtualFoldersSource !== saved) {
      this._virtualFoldersSource = saved;
      this._virtualFolders = normalizeVirtualFolders(saved);
      this._virtualFolderPaths = new Map(
        this._virtualFolders.map((folder) => [folder.id, new Set(folder.images)])
      );
      this._filterRevision += 1;
    }
    return this._virtualFolders;
  }

  _prepareVirtualFolders(fileObjs) {
    const folders = this._getVirtualFolders();
    if (this._activeVirtualFolder && !folders.some((folder) => folder.id === this._activeVirtualFolder)) {
      this._activeVirtualFolder = "";
      this.page = 0;
    }
    const available = new Set(fileObjs.map((file) => file.path));
    return folders.map((folder) => ({
      ...folder,
      count: folder.images.filter((path) => available.has(path)).length,
      selected: folder.id === this._activeVirtualFolder
    })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  _selectVirtualFolder(event, target = event.currentTarget) {
    const id = target?.dataset?.virtualFolder;
    if (!this._getVirtualFolders().some((folder) => folder.id === id)) return;
    this._activeVirtualFolder = id;
    this._quickFilter = "all";
    this._tagFilter = "";
    this.page = 0;
    this._folderSelection.clear();
    this._safeRender(false);
  }

  async _folderDialog(title, data, label, callback) {
    const content = await foundry.applications.handlebars.renderTemplate(
      `modules/${MODULE_ID}/templates/virtual-folder-dialog.hbs`, data
    );
    return foundry.applications.api.DialogV2.prompt({
      window: { title },
      position: { width: 420 },
      content,
      rejectClose: false,
      modal: true,
      ok: { label, callback }
    });
  }

  async _editVirtualFolder(event, target) {
    const id = target?.dataset?.virtualFolder;
    const folder = this._getVirtualFolders().find((entry) => entry.id === id);
    if (id && !folder) return;
    try {
      const name = await this._folderDialog(
        folder ? "Rename virtual folder" : "Create virtual folder",
        { editName: true, name: folder?.name ?? "" },
        folder ? "Rename" : "Create",
        (_event, button) => button.form.elements.folderName.value.trim()
      );
      if (typeof name !== "string") return;
      if (!name) {
        ui.notifications.warn("Enter a folder name.");
        return;
      }
      const folders = this._getVirtualFolders();
      if (id && !folders.some((entry) => entry.id === id)) {
        ui.notifications.warn("That virtual folder no longer exists.");
        return;
      }
      if (folders.some((entry) => entry.id !== id && entry.name.toLowerCase() === name.toLowerCase())) {
        ui.notifications.warn("A virtual folder with that name already exists.");
        return;
      }
      const nextId = id || foundry.utils.randomID();
      const next = id
        ? folders.map((entry) => entry.id === id ? { ...entry, name } : entry)
        : [...folders, { id: nextId, name, images: [] }];
      await game.settings.set(MODULE_ID, "virtualFolders", next);
      if (!id) this._selectVirtualFolder(null, { dataset: { virtualFolder: nextId } });
      else this._safeRender(false);
      ui.notifications.info(`Virtual folder ${folder ? "renamed" : "created"}: ${name}`);
    } catch (error) {
      console.error(`${MODULE_ID} | Could not save virtual folder`, error);
      ui.notifications.error("Could not save the virtual folder.");
    }
  }

  async _deleteVirtualFolder(event, target = event.currentTarget) {
    const id = target?.dataset?.virtualFolder;
    const folder = this._getVirtualFolders().find((entry) => entry.id === id);
    if (!folder) return;
    try {
      const confirmed = await this._folderDialog(
        "Delete virtual folder", { deleteFolder: true, name: folder.name }, "Delete folder", () => true
      );
      if (!confirmed) return;
      await game.settings.set(MODULE_ID, "virtualFolders",
        this._getVirtualFolders().filter((entry) => entry.id !== id));
      this.page = 0;
      this._safeRender(false);
      ui.notifications.info(`Virtual folder deleted: ${folder.name}. Media files were kept.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Could not delete virtual folder`, error);
      ui.notifications.error("Could not delete the virtual folder.");
    }
  }

  _toggleFolderImageSelection(event, target = event.currentTarget) {
    const path = target?.dataset?.path;
    if (!path) return;
    if (this._folderSelection.has(path)) this._folderSelection.delete(path);
    else this._folderSelection.add(path);
    this._safeRender(false);
  }

  _selectVisibleFolderImages() {
    const { visible } = this._getVisibleFiles(this._getFileObjects(), this._getBaseDir());
    for (const file of visible) this._folderSelection.add(file.path);
    this._safeRender(false);
  }

  async _chooseVirtualFolder(event, target = event.currentTarget) {
    const path = target?.dataset?.path;
    const paths = path ? [path] : Array.from(this._folderSelection);
    if (!paths.length) return;
    try {
      const folders = this._getVirtualFolders().map((folder) => ({ ...folder }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      if (!folders.length) {
        ui.notifications.warn("Create a virtual folder first.");
        return;
      }
      const destination = await this._folderDialog(
        "Move to virtual folder", { moveImages: true, count: paths.length, folders }, "Move",
        (_event, button) => button.form.elements.folderId.value
      );
      if (typeof destination !== "string") return;
      await this._moveToVirtualFolder(paths, destination);
    } catch (error) {
      console.error(`${MODULE_ID} | Could not move images to virtual folder`, error);
      ui.notifications.error("Could not move media to the virtual folder.");
    }
  }

  async _moveToVirtualFolder(paths, folderId) {
    const available = new Set(this.files);
    const moving = Array.from(new Set(paths)).filter((path) => available.has(path));
    if (!moving.length) return;
    const folders = this._getVirtualFolders();
    await game.settings.set(MODULE_ID, "virtualFolders",
      moveImagesToVirtualFolder(folders, moving, folderId));
    for (const path of moving) this._folderSelection.delete(path);
    this.page = 0;
    this._safeRender(false);
    const name = folders.find((folder) => folder.id === folderId)?.name;
    ui.notifications.info(name
      ? `Moved ${moving.length} media item${moving.length === 1 ? "" : "s"} to ${name}.`
      : `Removed ${moving.length} media item${moving.length === 1 ? "" : "s"} from virtual folders.`);
  }

  _handleFolderDrag(event) {
    if (event.type === "dragstart") {
      const thumb = event.target?.closest?.(".mg-thumb");
      const path = thumb?.dataset?.path;
      if (!path || !event.dataTransfer) return;
      const paths = this._folderSelection.has(path) ? Array.from(this._folderSelection) : [path];
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
      event.dataTransfer.effectAllowed = "move";
      return;
    }
    if (event.type === "dragend") {
      this.element?.querySelectorAll(".is-drop-target").forEach((row) => row.classList.remove("is-drop-target"));
      return;
    }
    const row = event.target?.closest?.("[data-virtual-drop]");
    if (!row || !Array.from(event.dataTransfer?.types ?? []).includes(DRAG_TYPE)) return;
    if (event.type === "dragleave") {
      if (!row.contains(event.relatedTarget)) row.classList.remove("is-drop-target");
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "dragover") {
      event.dataTransfer.dropEffect = "move";
      row.classList.add("is-drop-target");
    } else if (event.type === "drop") {
      row.classList.remove("is-drop-target");
      this._dropIntoVirtualFolder(event.dataTransfer, row.dataset.virtualDrop);
    }
  }

  async _dropIntoVirtualFolder(dataTransfer, folderId) {
    try {
      const paths = JSON.parse(dataTransfer.getData(DRAG_TYPE));
      if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string")) return;
      await this._moveToVirtualFolder(paths, folderId);
    } catch (error) {
      console.error(`${MODULE_ID} | Could not drop media into virtual folder`, error);
      ui.notifications.error("Could not move media to the virtual folder.");
    }
  }
};
