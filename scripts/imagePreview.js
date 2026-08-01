import { MODULE_ID } from "./settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ImagePreviewApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "mk-scene-gallery-image-preview",
    classes: [
      "mk-scene-gallery",
      "mg-glass-window",
      "mg-scene-preview-window"
    ],
    position: {
      width: 1000,
      height: 760
    },
    window: {
      title: "Scene Preview",
      icon: "fas fa-expand",
      resizable: true,
      minimizable: true
    }
  };

  static PARTS = {
    preview: {
      template: `modules/${MODULE_ID}/templates/image-preview.hbs`
    }
  };

  constructor({ gallery, image, ...options } = {}) {
    super(options);
    this.gallery = gallery;
    this.image = image;
  }

  setImage(image) {
    this.image = image;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      image: this.image ?? null
    };
  }

  _onClose(options) {
    this.gallery?._releaseImagePreviewApp(this);
    super._onClose(options);
  }
}
