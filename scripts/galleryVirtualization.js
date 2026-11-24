import { MODULE_ID } from "./settings.js";

export const GALLERY_GRID_TEMPLATE = `modules/${MODULE_ID}/templates/galleryGrid.hbs`;

export function getGalleryWindow({ count, columns = 1, rowHeight = 200, gap = 12,
  scrollTop = 0, height = 500 }) {
  columns = Math.max(1, Math.floor(columns));
  const stride = Math.max(1, rowHeight + gap);
  const rows = Math.ceil(count / columns);
  const firstRow = Math.min(Math.max(0, rows - 1), Math.floor(Math.max(0, scrollTop) / stride));
  const startRow = Math.max(0, firstRow - 2);
  const endRow = Math.min(rows, firstRow + Math.ceil(height / stride) + 3);
  return {
    start: startRow * columns,
    end: Math.min(count, endRow * columns),
    top: startRow * stride,
    bottom: Math.max(0, rows - endRow) * stride,
    columns
  };
}

export const GalleryVirtualizationMixin = (Base) => class extends Base {
  _resetGalleryView(key) {
    if (this._galleryViewKey === key) return;
    this._galleryViewKey = key;
    this.page = 0;
    this._galleryViewport = { ...this._galleryViewport, scrollTop: 0 };
  }

  _windowGalleryFiles(filtered, pageSize) {
    this._galleryFiles = filtered;
    this._galleryPageSize = pageSize;
    const loadedCount = Math.min(filtered.length, (this.page + 1) * pageSize);
    this._canLoadMore = loadedCount < filtered.length;
    const viewport = this._galleryViewport ?? {};
    const stride = (viewport.rowHeight ?? 200) + (viewport.gap ?? 12);
    const maxScroll = Math.max(0, Math.ceil(loadedCount / (viewport.columns ?? 1)) * stride
      - (viewport.gap ?? 12) - (viewport.height ?? 500));
    this._galleryViewport = { ...viewport, scrollTop: Math.min(viewport.scrollTop ?? 0, maxScroll) };
    const window = getGalleryWindow({ count: loadedCount, ...this._galleryViewport });
    return { filtered, visible: filtered.slice(window.start, window.end), loadedCount, galleryWindow: window };
  }

  _connectGalleryViewport(scroll, window) {
    this._galleryWindowRevision = (this._galleryWindowRevision ?? 0) + 1;
    this._galleryWindow = window ?? null;
    this._galleryResizeObserver?.disconnect();
    this._galleryResizeObserver = null;
    if (this._galleryScrollElement !== scroll) {
      this._galleryScrollElement?.removeEventListener("scroll", this._galleryScrollHandler);
      this._galleryScrollElement = scroll;
      scroll?.addEventListener("scroll", this._galleryScrollHandler, { passive: true });
    }
    if (!scroll) return;
    scroll.scrollTop = this._galleryViewport?.scrollTop ?? 0;
    if (typeof ResizeObserver === "function") {
      this._galleryResizeObserver = new ResizeObserver(() => this._scheduleGalleryWindowUpdate());
      this._galleryResizeObserver.observe(scroll);
    }
    this._scheduleGalleryWindowUpdate();
  }

  _scheduleGalleryWindowUpdate() {
    const scroll = this._galleryScrollElement;
    if (this._isClosing || !scroll) return;
    // Remember the latest position even while a template render is in flight.
    this._galleryViewport = { ...this._galleryViewport, scrollTop: scroll.scrollTop };
    if (this._galleryWindowTimer) return;
    this._galleryWindowTimer = setTimeout(() => {
      this._galleryWindowTimer = null;
      void this._refreshGalleryWindow().catch((error) => {
        console.error(`${MODULE_ID} | Could not render gallery thumbnails`, error);
        ui.notifications.error("Could not render gallery thumbnails.");
      });
    }, 16);
  }

  async _refreshGalleryWindow() {
    const scroll = this._galleryScrollElement;
    const host = scroll?.querySelector("[data-role='gallery-window']");
    const grid = host?.querySelector(".mg-grid");
    if (this._isClosing || this._galleryDragging || !scroll?.isConnected || !grid || !this._galleryFiles?.length) return;
    const style = getComputedStyle(grid);
    const gap = Number.parseFloat(style.rowGap) || 12;
    const columnGap = Number.parseFloat(style.columnGap) || 12;
    const minWidth = Number.parseFloat(style.getPropertyValue("--mg-card-min-width")) || 158;
    const rowHeight = grid.querySelector(".mg-thumb")?.getBoundingClientRect?.().height
      || Number.parseFloat(style.gridAutoRows)
      || grid.querySelector(".mg-thumb")?.offsetHeight || 200;
    const columns = Math.max(1, Math.floor((grid.clientWidth + columnGap) / (minWidth + columnGap)));
    const previous = this._galleryWindow;
    const previousViewport = this._galleryViewport ?? {};
    let scrollTop = scroll.scrollTop;
    // Preserve the leading item when resizing the window or collapsing folders.
    if (previousViewport.columns && (previousViewport.columns !== columns || previousViewport.rowHeight !== rowHeight)) {
      const oldStride = previousViewport.rowHeight + previousViewport.gap;
      const leading = Math.floor(scrollTop / oldStride) * previousViewport.columns;
      scrollTop = Math.floor(leading / columns) * (rowHeight + gap);
    }
    const scrollStyle = getComputedStyle(scroll);
    const padding = (Number.parseFloat(scrollStyle.paddingTop) || 0)
      + (Number.parseFloat(scrollStyle.paddingBottom) || 0);
    this._galleryViewport = { columns, rowHeight, gap, scrollTop, height: Math.max(1, scroll.clientHeight - padding) };
    this._maybeLoadMore(scroll);
    const data = this._windowGalleryFiles(this._galleryFiles, this._galleryPageSize);
    const next = data.galleryWindow;
    this._loadMorePending = false;
    if (previous && Object.keys(next).every((key) => next[key] === previous[key])) return;

    const revision = this._galleryWindowRevision = (this._galleryWindowRevision ?? 0) + 1;
    const html = await foundry.applications.handlebars.renderTemplate(GALLERY_GRID_TEMPLATE, {
      ...data, visibleFiles: data.visible
    });
    if (this._isClosing || this._galleryDragging || revision !== this._galleryWindowRevision
      || this._galleryScrollElement !== scroll || !host.isConnected) return;
    const template = document.createElement("template");
    template.innerHTML = html;
    const cards = new Map(Array.from(grid.children, (card) => [card.dataset.path, card]));
    const active = document.activeElement;
    const focusedCard = active?.closest?.(".mg-thumb");
    const focusPath = host.contains(focusedCard) ? focusedCard.dataset.path : null;
    const focusAction = active?.dataset?.action;
    // Retain overlapping nodes so their decoded images and video resources are
    // reused as the window moves, rather than restarted on every scroll row.
    for (const card of template.content.querySelectorAll(".mg-thumb")) {
      const retained = cards.get(card.dataset.path);
      if (retained) card.replaceWith(retained);
    }
    if (!template.content.contains(this._activeThumbnailVideo)) this._pauseActiveThumbnailVideo();
    this._thumbnailVideoObserver?.disconnect();
    this._thumbnailVideoObserver = null;
    this._thumbnailVideoEvents?.abort();
    for (const card of cards.values()) {
      if (!template.content.contains(card)) this._releaseThumbnailMedia(card);
    }
    host.replaceChildren(template.content);
    this._galleryWindow = next;
    // Disable browser scroll anchoring for this container; spacers provide its
    // exact position, including when a partial final row enters the window.
    scroll.scrollTop = this._galleryViewport.scrollTop;
    if (focusPath) {
      const card = Array.from(host.querySelectorAll(".mg-thumb"))
        .find((entry) => entry.dataset.path === focusPath);
      const target = focusAction
        ? Array.from(card?.querySelectorAll("[data-action]") ?? []).find((entry) => entry.dataset.action === focusAction)
        : card;
      (target ?? scroll).focus({ preventScroll: true });
    }
    this._bindThumbnailVideos(this.element);
    const stats = this.element?.querySelector("[data-role='gallery-shown']");
    if (stats) {
      stats.hidden = !this._canLoadMore;
      stats.textContent = `\u2022 ${data.loadedCount} shown`;
    }
    this._scheduleGalleryLoadCheck(scroll);
  }

  _handleGalleryTab(event, thumb) {
    if (event.key !== "Tab" || !this._galleryWindow || !this._galleryFiles?.length) return false;
    const cards = Array.from(this._galleryScrollElement.querySelectorAll(".mg-thumb"));
    const backwards = event.shiftKey;
    if (backwards ? thumb !== cards[0] || event.target !== thumb : thumb !== cards.at(-1)) return false;
    const buttons = Array.from(thumb.querySelectorAll("button:not(:disabled)"));
    if (!backwards && event.target !== (buttons.at(-1) ?? thumb)) return false;
    const index = backwards ? this._galleryWindow.start - 1 : this._galleryWindow.end;
    if (index < 0 || index >= this._galleryFiles.length) return false;
    event.preventDefault();
    void this._focusGalleryCard(index, backwards).catch((error) => {
      console.error(`${MODULE_ID} | Could not focus gallery thumbnail`, error);
    });
    return true;
  }

  async _focusGalleryCard(index, backwards) {
    const path = this._galleryFiles[index]?.path;
    if (!path || this._isClosing) return;
    this.page = Math.max(this.page, Math.floor(index / this._galleryPageSize));
    const viewport = this._galleryViewport;
    this._galleryScrollElement.scrollTop = Math.floor(index / viewport.columns) * (viewport.rowHeight + viewport.gap);
    await this._refreshGalleryWindow();
    if (this._isClosing) return;
    const card = Array.from(this._galleryScrollElement.querySelectorAll(".mg-thumb"))
      .find((entry) => entry.dataset.path === path);
    const target = backwards ? Array.from(card?.querySelectorAll("button:not(:disabled)") ?? []).at(-1) ?? card : card;
    target?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest" });
  }

  _releaseThumbnailMedia(root) {
    for (const video of root?.querySelectorAll?.(".mg-video") ?? []) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }

  _disconnectGalleryViewport() {
    this._galleryWindowRevision = (this._galleryWindowRevision ?? 0) + 1;
    clearTimeout(this._galleryWindowTimer);
    this._galleryWindowTimer = null;
    this._galleryResizeObserver?.disconnect();
    this._galleryResizeObserver = null;
    this._thumbnailVideoEvents?.abort();
    this._releaseThumbnailMedia(this._galleryScrollElement);
    this._galleryFiles = null;
    this._galleryWindow = null;
    this._galleryDragging = false;
  }
};
