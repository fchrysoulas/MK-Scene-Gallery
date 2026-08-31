import { MODULE_ID } from "./settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const SETTINGS_SECTION_IDS = Object.freeze({
  info: "mg-scene-details-section-info",
  grid: "mg-scene-details-section-grid",
  vision: "mg-scene-details-section-vision",
  journal: "mg-scene-details-section-journal",
  audio: "mg-scene-details-section-audio",
  "initial-view": "mg-scene-details-section-initial-view"
});

export class SceneDetailsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "mk-scene-gallery-image-details",
    classes: [
      "mk-scene-gallery",
      "mg-glass-window",
      "mg-scene-details-window"
    ],
    position: {
      width: 470,
      height: 780
    },
    window: {
      title: "Scene Details",
      icon: "fas fa-image",
      resizable: true,
      minimizable: true
    },
    actions: {
      "copy-scene-preset": function (event, target) {
        this._copyCurrentScenePreset(event, target);
      },
      "clear-image-metadata": async function (event, target) {
        await this._clearImageMetadata(event, target);
      },
      "set-scene-background": async function (event, target) {
        await this._setSceneBackground(event, target);
      },
      "open-settings-section": function (event, target) {
        this._openSettingsSection(event, target);
      },
      "clear-linked-selection": function (event, target) {
        this._clearLinkedSelection(event, target);
      }
    }
  };

  static PARTS = {
    details: {
      template: `modules/${MODULE_ID}/templates/scene-details.hbs`,
      scrollable: [".mg-inspector-scroll"]
    }
  };

  constructor({ gallery, image, ...options } = {}) {
    super(options);
    this.gallery = gallery;
    this.image = image;
    this._activeSection = "info";
    this._formDirty = false;
    this._drafts = new Map();
  }

  async close(options = {}) {
    this._captureDraft();
    return super.close(options);
  }

  _onClose(options) {
    this.gallery?._releaseSceneDetailsApp(this);
    super._onClose(options);
  }

  setImage(image) {
    this._captureDraft();
    if (this.image?.path !== image?.path) this._activeSection = "info";
    this.image = image;
  }

  _safeRender(force = false) {
    this._captureDraft();
    this.render({ force });
  }

  _captureDraft() {
    if (!this._formDirty) return;

    const form = this.element?.querySelector?.("[data-role='image-details-form']");
    const activeSection = form?.querySelector?.(
      "[data-role='settings-section'].is-active"
    )?.dataset?.section;
    if (activeSection) this._activeSection = activeSection;
    const path = form?.dataset?.path;
    if (!form || !path) return;

    const fields = {};
    for (const field of Array.from(form.elements ?? [])) {
      if (!field?.name) continue;

      fields[field.name] = field.type === "checkbox"
        ? { checked: field.checked }
        : { value: field.value };
    }

    this._drafts.set(path, {
      fields,
      activeSection: this._activeSection
    });
  }

  _restoreDraft(root) {
    const form = root?.querySelector?.("[data-role='image-details-form']");
    const path = form?.dataset?.path;
    const draft = path ? this._drafts.get(path) : null;
    this._setSettingsSection(root, draft?.activeSection ?? this._activeSection);
    if (!draft || !form) {
      this._formDirty = false;
      return;
    }

    for (const field of Array.from(form.elements ?? [])) {
      const saved = field?.name ? draft.fields[field.name] : null;
      if (!saved) continue;

      if (field.type === "checkbox") field.checked = saved.checked;
      else field.value = saved.value;
    }

    this._formDirty = true;
  }

  _clearDraft(path = this.image?.path) {
    if (path) this._drafts.delete(path);
    this._formDirty = false;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const details = this.gallery?._getImageDetailsData(this.image?.path) ?? {
      selectedImage: null,
      imageGridSizeMin: 50,
      imageGridSizeMax: 50,
      imageGridSizeStep: 25,
      selectedSceneAvailable: false
    };

    return {
      ...context,
      ...details
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const root = this.element;
    this._restoreDraft(root);

    const form = root.querySelector("[data-role='image-details-form']");
    form?.addEventListener("input", () => {
      this._formDirty = true;
    });
    form?.addEventListener("change", () => {
      this._formDirty = true;
    });
    form?.addEventListener("submit", (event) => this._saveImageDetails(event));

    this._bindDocumentDropControls(root);
    this._bindSectionTabs(root);
  }

  _bindSectionTabs(root) {
    for (const tab of Array.from(root?.querySelectorAll?.("[data-role='settings-tab']") ?? [])) {
      tab.addEventListener("keydown", (event) => this._handleSectionTabKeydown(event));
    }
  }

  _handleSectionTabKeydown(event) {
    const directions = {
      ArrowDown: 1,
      ArrowRight: 1,
      ArrowUp: -1,
      ArrowLeft: -1
    };
    const direction = directions[event.key];
    const tabs = Array.from(
      this.element?.querySelectorAll?.("[data-role='settings-tab']") ?? []
    );
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (!direction || currentIndex < 0 || !tabs.length) {
      if (event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const tab = event.key === "Home" ? tabs[0] : tabs[tabs.length - 1];
      tab?.focus();
      tab?.click();
      return;
    }

    event.preventDefault();
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  }

  _bindDocumentDropControls(root) {
    for (const target of Array.from(root?.querySelectorAll?.("[data-role='document-drop']") ?? [])) {
      target.addEventListener("dragover", (event) => {
        event.preventDefault();
        try {
          event.dataTransfer.dropEffect = "copy";
        } catch {
          // Some browser drag sources expose a read-only dataTransfer object.
        }
        target.classList.add("is-dragover");
      });

      target.addEventListener("dragleave", (event) => {
        if (!target.contains(event.relatedTarget)) target.classList.remove("is-dragover");
      });

      target.addEventListener("drop", (event) => {
        target.classList.remove("is-dragover");
        void this._handleDocumentDrop(event, target).catch((error) => {
          console.error(`${MODULE_ID} | Could not use dropped document`, error);
          ui.notifications.error("Could not use the dropped document.");
        });
      });
    }
  }

  _readDropData(event) {
    const transfer = event?.dataTransfer;
    if (!transfer) return {};

    const rawValues = ["application/json", "text/plain"]
      .map((type) => {
        try {
          return transfer.getData(type);
        } catch {
          return "";
        }
      })
      .filter(Boolean);

    for (const raw of rawValues) {
      try {
        const parsed = foundry.utils.fromJSON?.(raw) ?? JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        // Continue with the UUID fallback used by some Foundry drag sources.
      }

      if (/^(JournalEntry|Playlist|PlaylistSound)\./.test(raw)) {
        return { uuid: raw, type: raw.split(".")[0] };
      }
    }

    return {};
  }

  _dropUuidParts(uuid) {
    const parts = String(uuid || "").split(".");
    const isPlaylistSound = parts[0] === "Playlist"
      && parts[2] === "PlaylistSound";

    return {
      documentId: parts[0] && parts[1] ? parts[1] : "",
      parentId: isPlaylistSound ? parts[1] : "",
      childId: isPlaylistSound ? parts[3] : ""
    };
  }

  async _resolveDropData(event) {
    const data = this._readDropData(event);
    const uuid = typeof data.uuid === "string" ? data.uuid : "";
    let document = null;

    if (uuid && typeof globalThis.fromUuid === "function") {
      try {
        document = await globalThis.fromUuid(uuid);
      } catch (error) {
        console.warn(`${MODULE_ID} | Could not resolve dropped document`, error);
      }
    }

    return { data, uuid, document };
  }

  async _handleDocumentDrop(event, target) {
    event.preventDefault();
    event.stopPropagation();

    const form = this.element?.querySelector?.("[data-role='image-details-form']");
    const targetType = target?.dataset?.dropType;
    if (!form || !targetType) return;

    const { data, uuid, document } = await this._resolveDropData(event);
    const documentType = document?.documentName ?? data.type;
    const uuidParts = this._dropUuidParts(uuid);

    if (targetType === "journal") {
      if (documentType !== "JournalEntry") {
        ui.notifications.warn("Drop a Journal Entry here.");
        return;
      }

      const id = document?.id ?? data.id ?? uuidParts.documentId;
      const select = form.elements?.journal;
      if (!id || !select) return;

      if (!Array.from(select.options).some((option) => option.value === id)) {
        ui.notifications.warn("Only Journal Entries from this world can be selected.");
        return;
      }

      select.value = id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      ui.notifications.info(`Selected Journal Entry: ${document?.name || id}.`);
      return;
    }

    if (targetType !== "playlist") return;

    if (!["Playlist", "PlaylistSound"].includes(documentType)) {
      ui.notifications.warn("Drop a Playlist or Playlist Sound here.");
      return;
    }

    const playlistId = documentType === "PlaylistSound"
      ? document?.parent?.id
        ?? data.parent?.id
        ?? data.parentId
        ?? data.playlistId
        ?? uuidParts.parentId
      : document?.id ?? data.id ?? uuidParts.documentId;
    const soundId = documentType === "PlaylistSound"
      ? document?.id ?? data.soundId ?? uuidParts.childId
      : "";
    const select = form.elements?.playlistSoundLink;
    const value = `${playlistId || ""}:${soundId || ""}`;

    if (!playlistId || !select) return;

    if (!Array.from(select.options).some((option) => option.value === value)) {
      ui.notifications.warn("Only Playlists and Playlist Sounds from this world can be selected.");
      return;
    }

    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    ui.notifications.info(
      `Selected ${documentType === "PlaylistSound" ? "Playlist Sound" : "Playlist"}: ${document?.name || playlistId}.`
    );
  }

  _openSettingsSection(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    this._setSettingsSection(this.element, target?.dataset?.section, { scroll: true });
  }

  _setSettingsSection(root, sectionName, { scroll = false } = {}) {
    const sectionId = SETTINGS_SECTION_IDS[sectionName];
    const section = sectionId ? root?.querySelector?.(`#${sectionId}`) : null;
    if (!section) return false;

    for (const other of Array.from(
      root?.querySelectorAll?.("[data-role='settings-section']") ?? []
    )) {
      const active = other === section;
      other.hidden = !active;
      other.classList.toggle("is-active", active);
      other.setAttribute("aria-hidden", String(!active));

      const tab = root.querySelector(`[aria-controls="${other.id}"]`);
      if (tab) {
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      }
    }

    this._activeSection = sectionName;
    if (scroll) section.scrollIntoView?.({ behavior: "smooth", block: "start" });
    return true;
  }

  _clearLinkedSelection(event, target = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    const fieldName = target?.dataset?.field;
    if (!["journal", "playlistSoundLink"].includes(fieldName)) return;

    const form = target.closest?.("[data-role='image-details-form']");
    const field = form?.elements?.[fieldName];
    if (!field) return;

    field.value = "";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    this._formDirty = true;
  }

  _copyCurrentScenePreset(event, target = event.currentTarget) {
    this.gallery?._copyCurrentScenePreset(event, target);
    this._formDirty = true;
  }

  async _clearImageMetadata(event, target = event.currentTarget) {
    const cleared = await this.gallery?._clearImageMetadata(event, target);
    if (!cleared) return;

    this._clearDraft();
    this._safeRender(true);
  }

  async _saveImageDetails(event) {
    const path = event.currentTarget?.dataset?.path;
    const saved = await this.gallery?._saveImageDetails(event);
    if (!saved) return;

    this._clearDraft(path);
    this._safeRender(true);
  }

  async _setSceneBackground(event, target = event.currentTarget) {
    return this.gallery?._setSceneBackground(event, target);
  }
}
