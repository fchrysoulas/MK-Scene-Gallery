import { MODULE_ID } from "./settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ImageDetailsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "mk-scene-gallery-image-details",
    classes: [
      "mk-scene-gallery",
      "mg-glass-window",
      "mg-scene-details-window"
    ],
    position: {
      width: 420,
      height: 720
    },
    window: {
      title: "Scene Details",
      icon: "fas fa-map",
      resizable: true,
      minimizable: true
    },
    actions: {
      "copy-scene-preset": async function (event, target) {
        this.gallery?._copyCurrentScenePreset(event, target);
      },
      "clear-image-metadata": async function (event, target) {
        await this.gallery?._clearImageMetadata(event, target);
        this.render({ force: false });
      },
      "add-to-token-layer": async function (event, target) {
        await this.gallery?._addToTokenLayer(event, target);
      },
      "toggle-favorite": async function (event, target) {
        await this.gallery?._toggleFavorite(event, target);
        this.render({ force: false });
      }
    }
  };

  static PARTS = {
    details: {
      template: `modules/${MODULE_ID}/templates/image-details.hbs`,
      scrollable: [".mg-image-details-scroll"]
    }
  };

  constructor({ gallery, path, image, ...options } = {}) {
    super(options);
    this.gallery = gallery;
    this.path = path;
    this.image = image;
  }

  setImagePath(path, image) {
    this.path = path;
    this.image = image;
  }

  _getDetailsData() {
    const liveData = this.gallery?._getImageDetailsData(this.path);
    if (liveData?.selectedImage) return liveData;

    if (this.image) {
      const cachedData = this.gallery?._getImageDetailsData(this.path, [this.image]);
      if (cachedData?.selectedImage) return cachedData;
    }

    return {
      selectedImage: null,
      selectedSceneAvailable: false
    };
  }

  getData() {
    return this._getDetailsData();
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      ...this._getDetailsData()
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    this.element?.querySelector?.("[data-role='image-details-form']")
      ?.addEventListener("submit", async (event) => {
        await this.gallery?._saveImageDetails(event);
        this.render({ force: false });
      });
  }

  _onClose(options) {
    this.gallery?._releaseImageDetailsApp(this);
    super._onClose(options);
  }
}
