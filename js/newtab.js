(() => {
  const ENGINES = [
    { id: "bing", name: "必应", home: "https://www.bing.com", url: "https://www.bing.com/search?q=" },
    { id: "google", name: "Google", home: "https://www.google.com", url: "https://www.google.com/search?q=" },
    { id: "baidu", name: "百度", home: "https://www.baidu.com", url: "https://www.baidu.com/s?wd=" },
    { id: "duckduckgo", name: "DuckDuckGo", home: "https://duckduckgo.com", url: "https://duckduckgo.com/?q=" },
    { id: "sogou", name: "搜狗", home: "https://www.sogou.com", url: "https://www.sogou.com/web?query=" }
  ];

  const PRESETS = [
    { id: "aurora", name: "极光" },
    { id: "dusk", name: "暮色" },
    { id: "ink", name: "水墨" },
    { id: "sea", name: "深海" },
    { id: "moss", name: "森雾" },
    { id: "sand", name: "暖沙" }
  ];

  const DEFAULT_SITES = [
    { id: "github", name: "GitHub", url: "https://github.com" },
    { id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com" },
    { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com" },
    { id: "gemini", name: "Gemini", url: "https://gemini.google.com" }
  ];

  const STORE_KEY = "glass-home";
  const MAX_SITES = 24;
  const MAX_HISTORY = 30;
  const HIST_VISIBLE = 8;
  const MAX_BING = 48;
  const BING_VISIBLE = 8;
  const BING_SEED = 24;
  const BING_REFRESH_MS = 30 * 60 * 1000;
  const MIN_FILE_MB = 20;
  const MAX_FILE_MB = 300;
  const DEFAULT_FILE_MB = 50;
  const MAX_CROP_ZOOM = 10;

  const $ = (id) => document.getElementById(id);
  const grid = $("grid");
  const panel = $("panel");
  const backdrop = $("backdrop");
  const engineMenu = $("engine-menu");
  const sugList = $("sug-list");
  const bgPreset = $("bg-preset");
  const bgImage = $("bg-image");
  const bgVideo = $("bg-video");
  const cropBackdrop = $("crop-backdrop");
  const cropStage = $("crop-stage");
  const cropFrame = $("crop-frame");
  let cropState = null;
  let cropId = "";
  let cropGen = 0;
  let selectionGen = 0;

  const state = fresh();
  let editingId = null;
  let suppressClick = false;
  let bingExpanded = false;
  let lastBingFetch = 0;
  let paintGen = 0;
  let objectUrl = "";
  const localUrls = new Map();
  const inflight = new Map();
  let dbPromise = null;
  let migrated = false;

  function fresh() {
    return {
      engine: "bing",
      sites: DEFAULT_SITES.map((site) => ({ ...site })),
      wallpaper: { type: "bing", preset: "aurora", bingId: "", localId: "", credit: "", auto: true, crop: null },
      bingHistory: [],
      history: [],
      localIds: [],
      blur: 0,
      dim: 0.32,
      fileLimitMb: DEFAULT_FILE_MB,
      defaults: 2
    };
  }

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function engineOf(id) {
    return ENGINES.find((item) => item.id === id) || ENGINES[0];
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function normalizeUrl(raw) {
    const text = raw.trim();
    if (!text) return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https?:\/\//i.test(text)
      && !/^[^/:?#]+:\d+(?:[/?#]|$)/.test(text)) return "";
    return safeHttpUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  }

  function cleanHistory(items) {
    const list = [];
    items.forEach((item) => {
      const text = String(item || "").trim().slice(0, 64);
      if (!text || list.some((old) => old.toLowerCase() === text.toLowerCase())) return;
      if (list.length < MAX_HISTORY) list.push(text);
    });
    return list;
  }

  function pushHistory(text) {
    state.history = cleanHistory([text, ...state.history]);
  }

  function looksLikeUrl(text) {
    if (!text || /\s/.test(text)) return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return true;
    return /^(localhost|(\d{1,3}\.){3}\d{1,3}|[\w.-]+\.[a-z]{2,})(:\d+)?(\/.*)?$/i.test(text);
  }

  function svgEl(name, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }

  function brandKey(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host === "github.com" || host.endsWith(".github.com")) return "github";
      if (host.includes("deepseek")) return "deepseek";
      if (host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com") return "chatgpt";
      if (host.includes("gemini")) return "gemini";
    } catch { /* 自定义网址走字母标 */ }
    return "";
  }

  function brandSvg(key) {
    const svg = svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
    if (key === "github") {
      svg.append(svgEl("path", { fill: "currentColor", d: "M12 .5A11.5 11.5 0 0 0 8.1 22.8c.6.1.8-.2.8-.6v-2.1c-3.3.7-4-1.4-4-1.4-.5-1.3-1.3-1.6-1.3-1.6-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A11.5 11.5 0 0 0 12 .5z" }));
    } else if (key === "deepseek") {
      svg.append(svgEl("path", { fill: "currentColor", d: "M3.4 14.7c1.5-4.6 6.2-6.2 10.1-4.6 1.3-2.2 3.8-3.2 6.5-2.5-1.8 1.5-1.9 3.1-.2 4.3 1.2-.8 2.6-1 4-.5-1.8 2.5-4.4 3.6-7.2 3.5-3.2.4-6.8.1-10-1.1-1.2-.4-2.4-.2-3.2.9z" }));
      svg.append(svgEl("circle", { cx: "17.7", cy: "9.55", r: "0.72", fill: "#1a2370" }));
    } else if (key === "chatgpt") {
      svg.append(svgEl("path", { fill: "currentColor", d: "M22.3 10.2a5.2 5.2 0 0 0-.5-4.3 5.3 5.3 0 0 0-5.7-2.6A5.3 5.3 0 0 0 12 1a5.3 5.3 0 0 0-5 3.6 5.3 5.3 0 0 0-4.3 2.4 5.2 5.2 0 0 0 .6 6.3 5.2 5.2 0 0 0 .5 4.3 5.3 5.3 0 0 0 5.7 2.6A5.3 5.3 0 0 0 12 23a5.3 5.3 0 0 0 5-3.6 5.3 5.3 0 0 0 4.3-2.4 5.2 5.2 0 0 0-.6-6.3zM12 21.2a3.6 3.6 0 0 1-2.2-.7l.1-.1 3.6-2.1a.6.6 0 0 0 .3-.5v-5.1l1.5.9a.1.1 0 0 1 0 .1v4.2a3.7 3.7 0 0 1-3.3 3.3zm-6.3-2.6a3.6 3.6 0 0 1-.4-2.3l.1.1 3.6 2.1a.6.6 0 0 0 .6 0l4.4-2.5v1.7a.1.1 0 0 1 0 .1l-3.5 2a3.7 3.7 0 0 1-4.8-1.2zm-.8-7.7a3.6 3.6 0 0 1 1.4-1.6v4.3a.6.6 0 0 0 .3.5l4.4 2.5-1.5.9a.1.1 0 0 1-.1 0l-3.5-2a3.7 3.7 0 0 1-1-4.6zm13.2 3.2-4.4-2.5 1.5-.9a.1.1 0 0 1 .1 0l3.5 2a3.7 3.7 0 0 1-1.4 6.6v-4.3a.6.6 0 0 0-.3-.5zm1.2-1.8a3.6 3.6 0 0 1-.4 2.3l-.1-.1-3.6-2.1a.6.6 0 0 0-.6 0L8.2 14V12.3a.1.1 0 0 1 0-.1l3.5-2a3.7 3.7 0 0 1 4.8 1.2zM8.3 11.4l-1.5-.9a.1.1 0 0 1 0-.1l3.5-2a3.7 3.7 0 0 1 6.1 1.3v4.3a.6.6 0 0 0-.3.5l-4.4-2.5-1.4-.6zm1.5-1.1 4.4 2.5V8.2l-1.5-.9a.1.1 0 0 1 0-.1l-3.5 2a.6.6 0 0 0-.3.5v.6zm6.4 2.5-4.4 2.5-1.5-.8V9.9l4.4-2.5 1.5.8v4.6z" }));
    } else if (key === "gemini") {
      const gradId = `gemini-grad-${uid()}`;
      const defs = svgEl("defs", {});
      const gradient = svgEl("linearGradient", { id: gradId, x1: "0", y1: "0", x2: "1", y2: "1" });
      gradient.append(svgEl("stop", { offset: "0", "stop-color": "#4b8bff" }));
      gradient.append(svgEl("stop", { offset: "0.55", "stop-color": "#a05cff" }));
      gradient.append(svgEl("stop", { offset: "1", "stop-color": "#ff6b9a" }));
      defs.append(gradient);
      svg.append(defs, svgEl("path", { fill: `url(#${gradId})`, d: "M12 2.4c.62 5.1 2.15 6.7 7.2 7.3-5.05.6-6.58 2.2-7.2 7.3-.62-5.1-2.15-6.7-7.2-7.3 5.05-.6 6.58-2.2 7.2-7.3z" }));
    }
    return svg;
  }

  function cloneIcon(id) {
    const node = $(id).content.firstElementChild.cloneNode(true);
    return node;
  }

  function chromeStorage() {
    try {
      return globalThis.chrome && chrome.storage && chrome.storage.local ? chrome.storage.local : null;
    } catch {
      return null;
    }
  }

  let settingsReady = false;
  let saveQueue = Promise.resolve();
  let pendingSettings = new Set();
  let localRenderGen = 0;
  let resetGen = 0;
  const writingFields = new Map();

  function reportStorageError(error) {
    const message = error && error.message ? error.message : "未知错误";
    $("local-note").textContent = `设置存取失败（${message}），请重新加载扩展`;
    alert(`设置存取失败：${message}。更改可能未保存，请重新加载扩展后重试。`);
    console.error("[玻璃主页] 设置存取失败：", message);
  }

  function loadSettings() {
    const storage = chromeStorage();
    if (!storage) {
      try {
        return Promise.resolve(JSON.parse(localStorage.getItem(STORE_KEY) || "null"));
      } catch {
        return Promise.resolve(null);
      }
    }
    const keys = Object.keys(state).map((key) => `${STORE_KEY}:${key}`);
    return new Promise((resolve, reject) => {
      storage.get([STORE_KEY, ...keys], (data) => {
        const error = chrome.runtime && chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        const legacy = data && data[STORE_KEY];
        const fields = keys.reduce((result, key) => {
          if (Object.hasOwn(data, key)) result[key.slice(STORE_KEY.length + 1)] = data[key];
          return result;
        }, {});
        resolve(Object.keys(fields).length ? { ...(legacy || {}), ...fields } : legacy || null);
      });
    });
  }

  function settingsPayload(keys) {
    const payload = {};
    keys.forEach((key) => { payload[`${STORE_KEY}:${key}`] = state[key]; });
    return payload;
  }

  function saveSettings(keys = null) {
    if (!settingsReady) {
      if (keys) keys.forEach((key) => pendingSettings.add(key));
      else Object.keys(state).forEach((key) => pendingSettings.add(key));
      return Promise.resolve();
    }
    const changed = keys ? new Set(keys) : new Set(Object.keys(state));
    if (pendingSettings.size) {
      pendingSettings.forEach((key) => changed.add(key));
      pendingSettings.clear();
    }
    const payload = structuredClone(settingsPayload(changed));
    changed.forEach((key) => writingFields.set(key, (writingFields.get(key) || 0) + 1));
    const storage = chromeStorage();
    saveQueue = saveQueue.catch(() => {}).then(() => {
      if (!storage) {
        let current = null;
        try { current = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch { /* ignore malformed local data */ }
        const fields = {};
        Object.entries(payload).forEach(([key, value]) => { fields[key.slice(STORE_KEY.length + 1)] = value; });
        localStorage.setItem(STORE_KEY, JSON.stringify({ ...(current || {}), ...fields }));
        return;
      }
      return new Promise((resolve, reject) => storage.set(payload, () => {
        const error = chrome.runtime && chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      }));
    });
    saveQueue.then(() => {
      changed.forEach((key) => {
        const remaining = writingFields.get(key) - 1;
        if (remaining) writingFields.set(key, remaining);
        else writingFields.delete(key);
      });
    }, (error) => {
      changed.forEach((key) => {
        const remaining = writingFields.get(key) - 1;
        if (remaining) writingFields.set(key, remaining);
        else writingFields.delete(key);
      });
      reportStorageError(error);
    });
    return saveQueue;
  }

  function sanitize(saved) {
    if (!saved || typeof saved !== "object") return;
    if (ENGINES.some((item) => item.id === saved.engine)) state.engine = saved.engine;
    if (Array.isArray(saved.sites)) {
      const sites = saved.sites
        .map((site) => {
          const url = safeHttpUrl(String(site && site.url || ""));
          const name = String(site && site.name || "").trim().slice(0, 20);
          if (!url || !name) return null;
          return { id: String(site.id || uid()), name, url };
        })
        .filter(Boolean)
        .slice(0, MAX_SITES);
      state.sites = sites;
      // 旧默认导航的完整原始内容无法确认，保留已有列表以免丢失用户编辑。
    }
    state.defaults = 2;
    const wall = saved.wallpaper || {};
    const preset = PRESETS.some((item) => item.id === wall.preset) ? wall.preset : "aurora";
    const type = ["bing", "preset", "local"].includes(wall.type) ? wall.type : "bing";
    state.wallpaper = {
      type,
      preset,
      bingId: String(wall.bingId || ""),
      localId: String(wall.localId || ""),
      credit: String(wall.credit || ""),
      auto: wall.auto !== false,
      crop: wall.crop && typeof wall.crop === "object" ? {
        zoom: Math.min(MAX_CROP_ZOOM, Math.max(1, Number(wall.crop.zoom) || 1)),
        offsetX: Number.isFinite(Number(wall.crop.offsetX)) ? Math.min(1, Math.max(0, Number(wall.crop.offsetX))) : 0.5,
        offsetY: Number.isFinite(Number(wall.crop.offsetY)) ? Math.min(1, Math.max(0, Number(wall.crop.offsetY))) : 0.5
      } : null
    };
    if (Array.isArray(saved.bingHistory)) {
      state.bingHistory = saved.bingHistory
        .map((image) => {
          const id = String(image && image.id || "");
          if (!id) return null;
          return { id, title: String(image.title || ""), copyright: String(image.copyright || "") };
        })
        .filter(Boolean)
        .slice(0, MAX_BING);
    }
    if (Array.isArray(saved.localIds)) {
      state.localIds = saved.localIds.filter((id) => typeof id === "string");
    }
    if (Array.isArray(saved.history)) {
      state.history = cleanHistory(saved.history);
    }
    if (typeof saved.dim === "number" && Number.isFinite(saved.dim)) {
      state.dim = Math.min(0.65, Math.max(0, saved.dim));
    }
    if (typeof saved.blur === "number" && Number.isFinite(saved.blur)) {
      state.blur = Math.min(30, Math.max(0, saved.blur));
    }
    if (typeof saved.fileLimitMb === "number" && Number.isFinite(saved.fileLimitMb)) {
      state.fileLimitMb = Math.min(MAX_FILE_MB, Math.max(MIN_FILE_MB, Math.round(saved.fileLimitMb)));
    } else if (Object.hasOwn(saved, "dim")) {
      migrated = true;
    }
  }

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open("glass-home", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("blobs");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return dbPromise;
  }

  function idbGet(key) {
    return db().then((database) => new Promise((resolve, reject) => {
      const request = database.transaction("blobs").objectStore("blobs").get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }));
  }

  function idbSet(key, value) {
    return db().then((database) => new Promise((resolve, reject) => {
      const transaction = database.transaction("blobs", "readwrite");
      transaction.objectStore("blobs").put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    }));
  }

  function idbDelete(key) {
    return db().then((database) => new Promise((resolve, reject) => {
      const request = database.transaction("blobs", "readwrite").objectStore("blobs").delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }));
  }

  function idbKeys() {
    return db().then((database) => new Promise((resolve, reject) => {
      const request = database.transaction("blobs").objectStore("blobs").getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }));
  }

  function bingUrl(id, size) {
    return `https://www.bing.com${id}_${size}.jpg`;
  }

  function setBlur(value) {
    document.documentElement.style.setProperty("--wallpaper-blur", `${value}px`);
    document.documentElement.style.setProperty("--dim", String(state.dim));
  }

  function styleCropMedia(media, crop) {
    const { zoom, offsetX, offsetY } = crop || { zoom: 1, offsetX: 0.5, offsetY: 0.5 };
    media.style.objectPosition = `${offsetX * 100}% ${offsetY * 100}%`;
    media.style.transform = `translate(${(0.5 - offsetX) * (zoom - 1) * 100}%, ${(0.5 - offsetY) * (zoom - 1) * 100}%) scale(${zoom})`;
  }

  function applyCropStyle() {
    [bgImage, bgVideo].forEach((media) => {
      styleCropMedia(media, state.wallpaper.crop);
      media.style.inset = "0";
      media.style.width = "100%";
      media.style.height = "100%";
    });
  }

  function applySkin() {
    bgPreset.className = state.wallpaper.type === "preset"
      ? `bg-preset skin-${state.wallpaper.preset}`
      : "bg-preset";
    setBlur(state.blur);
    applyCropStyle();
    setCredit();
  }

  function setCredit() {}

  function hideImage() {
    paintGen += 1;
    bgImage.classList.remove("is-on");
    bgVideo.classList.remove("is-on");
    bgVideo.pause();
    bgVideo.removeAttribute("src");
    bgVideo.load();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
  }

  function showBlob(blob) {
    hideImage();
    applyCropStyle();
    const token = paintGen;
    const video = blob.type.startsWith("video/");
    const media = video ? bgVideo : bgImage;
    const next = URL.createObjectURL(blob);
    objectUrl = next;
    const reveal = () => {
      if (token !== paintGen) return;
      media.classList.add("is-on");
    };
    media.onerror = () => {
      if (token !== paintGen) return;
      hideImage();
      bgPreset.className = "bg-preset skin-aurora";
    };
    if (video) {
      media.onloadeddata = reveal;
      media.muted = true;
    } else {
      media.onload = reveal;
    }
    media.src = next;
  }

  async function showStored(key) {
    const token = paintGen;
    const blob = await idbGet(key).catch(() => null);
    const currentKey = state.wallpaper.type === "local"
      ? `local:${state.wallpaper.localId}`
      : state.wallpaper.type === "bing" ? `bing:${state.wallpaper.bingId}` : "";
    if (token !== paintGen || key !== currentKey) return null;
    if (!blob) return false;
    showBlob(blob);
    return true;
  }

  function cacheBing(id) {
    const key = `bing:${id}`;
    if (inflight.has(key)) return inflight.get(key);
    const job = idbGet(key).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(bingUrl(id, "1920x1080"));
      if (!response.ok) throw new Error("bing image");
      const blob = await response.blob();
      await idbSet(key, blob);
      return blob;
    }).finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }

  async function paintWallpaper() {
    applySkin();
    if (state.wallpaper.type === "preset") {
      hideImage();
      return;
    }
    const key = state.wallpaper.type === "local"
      ? `local:${state.wallpaper.localId}`
      : `bing:${state.wallpaper.bingId}`;
    if (!key.endsWith(":")) {
      const shown = await showStored(key);
      if (shown !== false) return;
      if (state.wallpaper.type === "bing") {
        const selection = selectionGen;
        const id = state.wallpaper.bingId;
        try {
          const blob = await cacheBing(id);
          if (selection === selectionGen && state.wallpaper.type === "bing" && state.wallpaper.bingId === id) showBlob(blob);
        } catch { /* 暂时使用默认背景，稍后刷新时重试 */ }
        return;
      }
    }
    hideImage();
    bgPreset.className = "bg-preset skin-aurora";
  }

  function faviconUrl(pageUrl, size) {
    if (!(globalThis.chrome && chrome.runtime && chrome.runtime.getURL) || !pageUrl) return "";
    try {
      const url = new URL(chrome.runtime.getURL("/_favicon/"));
      url.searchParams.set("pageUrl", pageUrl);
      url.searchParams.set("size", String(size));
      return url.href;
    } catch {
      return "";
    }
  }

  // 引擎图标：各引擎的官方图标（由 icons/_engines.ps1 在构建期下载并内置）
  // 内置的原因：运行时抓 favicon.ico 会被部分网络换成通用图甚至取不到
  const ENGINE_ICONS = {
    bing: "icons/engines/bing.png",
    google: "icons/engines/google.png",
    baidu: "icons/engines/baidu.png",
    duckduckgo: "icons/engines/duckduckgo.png",
    sogou: "icons/engines/sogou.png"
  };

  function setEngineIcon(host, engine) {
    const img = document.createElement("img");
    img.className = "engine-icon";
    img.alt = "";
    img.decoding = "async";
    img.addEventListener("error", () => {
      // 内置资源读取失败时，退回 Chrome 缓存里的站点 favicon
      const cached = faviconUrl(engine.home, 64);
      if (cached && img.getAttribute("src") !== cached) img.src = cached;
      else img.remove();
    });
    img.src = ENGINE_ICONS[engine.id] || faviconUrl(engine.home, 64);
    host.prepend(img);
  }

  function updateEngine() {
    const engine = engineOf(state.engine);
    $("engine-label").textContent = engine.name;
    $("q").placeholder = `在${engine.name}中搜索，或输入网址`;
    const button = $("engine-btn");
    const old = button.querySelector(".engine-icon");
    if (old) old.remove();
    setEngineIcon(button, engine);
  }

  function renderEngines() {
    engineMenu.replaceChildren();
    ENGINES.forEach((engine) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.engine = engine.id;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(engine.id === state.engine));
      if (engine.id === state.engine) button.classList.add("is-active");
      setEngineIcon(button, engine);
      const label = document.createElement("span");
      label.textContent = engine.name;
      button.append(label);
      item.append(button);
      engineMenu.append(item);
    });
  }

  function setMenu(open) {
    engineMenu.hidden = !open;
    $("engine-btn").setAttribute("aria-expanded", String(open));
    if (open) renderEngines();
  }

  const SUGGEST = {
    bing: {
      url: (q) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}&market=zh-CN`,
      async pick(response) {
        const data = await response.json();
        return Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
      }
    },
    google: {
      url: (q) => `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(q)}`,
      async pick(response) {
        const data = await response.json();
        return Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
      }
    },
    baidu: {
      url: (q) => `https://www.baidu.com/sugrec?pre=1&p=3&ie=utf-8&json=1&prod=pc&wd=${encodeURIComponent(q)}`,
      async pick(response) {
        const data = await response.json();
        return Array.isArray(data && data.g) ? data.g.map((item) => item && item.q) : [];
      }
    },
    duckduckgo: {
      url: (q) => `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`,
      async pick(response) {
        const data = await response.json();
        return Array.isArray(data) ? data.map((item) => (item && item.phrase) || item) : [];
      }
    },
    sogou: {
      url: (q) => `https://sor.html5.qq.com/api/getsug?key=${encodeURIComponent(q)}&ver=0&c=1&a=1&b=1&s=1&t=1&from=2&r=0`,
      async pick(response) {
        const text = await response.text();
        const start = text.indexOf("[");
        const end = text.lastIndexOf("]");
        if (start < 0 || end < start) return [];
        const data = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
      }
    }
  };
  const SUG_LIMIT = 10;
  const SUG_CACHE_MAX = 120;
  const SUG_DELAY = 180;
  const SUG_FAIL_MS = 60000;
  const sugCache = new Map();
  const sugFail = new Map();
  let sugItems = [];
  let sugIndex = -1;
  let sugSeq = 0;
  let sugTimer = 0;
  let sugAbort = null;

  function hideSug() {
    clearTimeout(sugTimer);
    sugTimer = 0;
    sugSeq += 1;
    if (sugAbort) {
      sugAbort.abort();
      sugAbort = null;
    }
    sugItems = [];
    sugIndex = -1;
    sugList.replaceChildren();
    sugList.hidden = true;
  }

  function alignSug() {
    // 下拉在表单外层（内部会被表单的 backdrop-filter 吃掉玻璃效果）。
    // 先量出图标栏宽度，再把整块左移，让联想文字与输入框里的文字严格对齐。
    const input = $("q");
    const box = input.getBoundingClientRect();
    const host = sugList.parentElement.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(input).paddingLeft) || 0;
    sugList.style.left = `${Math.round(box.left - host.left)}px`;
    sugList.style.width = `${Math.round(box.width)}px`;
    const label = sugList.querySelector("button span");
    if (!label) return;
    const rowOffset = label.getBoundingClientRect().left - sugList.getBoundingClientRect().left;
    sugList.style.left = `${Math.round(box.left + pad - rowOffset - host.left)}px`;
    sugList.style.width = `${Math.round(box.width + rowOffset - pad)}px`;
  }

  function renderSug(items, kind = "search") {
    sugItems = items;
    sugIndex = -1;
    sugList.replaceChildren();
    if (!items.length) {
      sugList.hidden = true;
      return;
    }
    const iconId = kind === "history" ? "tpl-history" : "tpl-search";
    const fragment = document.createDocumentFragment();
    items.forEach((text) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.sug = text;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      button.append(cloneIcon(iconId));
      const label = document.createElement("span");
      label.textContent = text;
      button.append(label);
      item.append(button);
      if (kind === "history") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "history-x";
        remove.dataset.removeHistory = text;
        remove.setAttribute("aria-label", `删除搜索历史：${text}`);
        remove.textContent = "×";
        item.append(remove);
      }
      fragment.append(item);
    });
    sugList.append(fragment);
    sugList.hidden = false;
    alignSug();
    sugList.scrollTop = 0;
  }

  function historyMatches(query) {
    const needle = query.toLowerCase();
    return state.history.filter((text) => text.toLowerCase().includes(needle)).slice(0, HIST_VISIBLE);
  }

  function showHistory() {
    sugSeq += 1;
    clearTimeout(sugTimer);
    sugTimer = 0;
    if (sugAbort) {
      sugAbort.abort();
      sugAbort = null;
    }
    if ($("q").value.trim()) return;
    const list = state.history.slice(0, HIST_VISIBLE);
    if (!list.length) {
      hideSug();
      return;
    }
    renderSug(list, "history");
  }

  function paintSug() {
    const buttons = Array.from(sugList.querySelectorAll("[data-sug]"));
    buttons.forEach((button, index) => {
      const active = index === sugIndex;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    const current = buttons[sugIndex];
    if (current) current.scrollIntoView({ block: "nearest" });
  }

  function moveSug(step) {
    if (!sugItems.length) return;
    if (sugIndex < 0) sugIndex = step > 0 ? 0 : sugItems.length - 1;
    else sugIndex = (sugIndex + step + sugItems.length) % sugItems.length;
    paintSug();
  }

  function applySug(text) {
    $("q").value = text;
    hideSug();
    $("search-form").requestSubmit();
  }

  async function loadSug(engineId, query) {
    const source = SUGGEST[engineId];
    if (!source) return [];
    const key = `${engineId}\u0000${query}`;
    if (sugCache.has(key)) return sugCache.get(key);
    const controller = new AbortController();
    sugAbort = controller;
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(source.url(query), { signal: controller.signal, credentials: "omit", cache: "no-store" });
      if (!response.ok) return [];
      const raw = await source.pick(response);
      const list = [];
      raw.forEach((item) => {
        const text = typeof item === "string" ? item.trim() : "";
        if (text && text !== query && !list.includes(text) && list.length < SUG_LIMIT) list.push(text);
      });
      if (sugCache.size >= SUG_CACHE_MAX) sugCache.clear();
      sugCache.set(key, list);
      return list;
    } catch {
      if (controller.signal.aborted) return [];
      // 请求失败（含 host 权限未生效导致的 CORS 拦截）时短暂停用该引擎，避免刷屏
      if (!sugFail.has(engineId)) {
        console.warn(`[玻璃主页] ${engineId} 联想接口请求失败，已暂停 60 秒。若为 CORS 报错，请在 chrome://extensions 重新加载本扩展，使新增的 host 权限生效。`);
      }
      sugFail.set(engineId, Date.now());
      return [];
    } finally {
      clearTimeout(timer);
      if (sugAbort === controller) sugAbort = null;
    }
  }

  function scheduleSug() {
    clearTimeout(sugTimer);
    const query = $("q").value.trim();
    if (!query || query.length > 64 || looksLikeUrl(query)) {
      hideSug();
      return;
    }
    const engineId = state.engine;
    if (Date.now() - (sugFail.get(engineId) || 0) < SUG_FAIL_MS) {
      hideSug();
      return;
    }
    const gen = (sugSeq += 1);
    sugTimer = setTimeout(async () => {
      const list = await loadSug(engineId, query);
      if (gen !== sugSeq || engineId !== state.engine) return;
      if ($("q").value.trim() !== query) return;
      if (list.length) renderSug(list, "search");
      else renderSug(historyMatches(query), "history");
    }, SUG_DELAY);
  }

  function renderGrid() {
    const fragment = document.createDocumentFragment();
    state.sites.forEach((site) => {
      const link = document.createElement("a");
      link.className = "card glass";
      link.href = site.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.draggable = true;
      link.dataset.id = site.id;
      link.title = site.url;

      const mark = document.createElement("span");
      mark.className = "mark";
      mark.append(cloneIcon("tpl-site"));
      const icon = document.createElement("img");
      icon.alt = "";
      icon.addEventListener("load", () => mark.classList.add("has-icon"));
      icon.addEventListener("error", () => icon.remove());
      const src = faviconUrl(site.url, 32);
      if (src) {
        icon.src = src;
        mark.append(icon);
      }

      const name = document.createElement("span");
      name.className = "card-name";
      name.textContent = site.name;

      const del = toolButton("delete", "删除", "tpl-trash");
      del.classList.add("card-tool", "is-left");
      const edit = toolButton("edit", "编辑", "tpl-pencil");
      edit.classList.add("card-tool", "is-right");

      link.append(mark, name, del, edit);
      fragment.append(link);
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "add-card";
    add.dataset.act = "add";
    const plus = document.createElement("span");
    plus.textContent = "+";
    plus.setAttribute("aria-hidden", "true");
    add.append(plus);
    add.setAttribute("aria-label", "添加导航");
    fragment.append(add);
    grid.replaceChildren(fragment);
  }

  function toolButton(act, label, iconId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mini";
    button.dataset.act = act;
    button.setAttribute("aria-label", label);
    button.append(cloneIcon(iconId));
    return button;
  }

  function renderPresets() {
    const list = $("preset-list");
    list.replaceChildren();
    PRESETS.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `thumb-btn skin-${preset.id}`;
      button.dataset.preset = preset.id;
      button.title = preset.name;
      button.setAttribute("aria-label", preset.name);
      list.append(button);
    });
  }

  function syncActive() {
    document.querySelectorAll("[data-preset], [data-bing], [data-local]").forEach((node) => {
      const on = (node.dataset.preset && state.wallpaper.type === "preset" && node.dataset.preset === state.wallpaper.preset)
        || (node.dataset.bing && state.wallpaper.type === "bing" && node.dataset.bing === state.wallpaper.bingId)
        || (node.dataset.local && state.wallpaper.type === "local" && node.dataset.local === state.wallpaper.localId);
      node.classList.toggle("is-active", Boolean(on));
      node.setAttribute("aria-pressed", String(Boolean(on)));
    });
  }

  function renderBing() {
    const list = $("bing-list");
    const more = $("bing-more");
    const status = $("bing-status");
    list.replaceChildren();
    const history = state.bingHistory;
    list.classList.toggle("is-scroll", bingExpanded);
    if (!history.length) {
      more.hidden = true;
      status.textContent = "";
      return;
    }
    const shown = bingExpanded ? history : history.slice(0, BING_VISIBLE);
    status.textContent = state.wallpaper.type === "bing" && state.wallpaper.auto
      ? `已更新到 ${history.length} 张，每日自动跟随最新一张`
      : `已更新到 ${history.length} 张`;
    shown.forEach((image, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thumb-btn";
      button.dataset.bing = image.id;
      button.title = image.title || "必应壁纸";
      button.setAttribute("aria-label", index === 0 && !bingExpanded ? "最新必应壁纸" : (image.title || "必应壁纸"));
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = bingUrl(image.id, "400x240");
      button.append(img);
      list.append(button);
    });
    more.hidden = history.length <= BING_VISIBLE;
    more.textContent = bingExpanded ? "收起" : `更多（共 ${history.length} 张）`;
    $("bing-auto").checked = Boolean(state.wallpaper.auto);
    syncActive();
  }

  async function renderLocal() {
    const renderGen = ++localRenderGen;
    localUrls.forEach((url) => URL.revokeObjectURL(url));
    localUrls.clear();
    const list = $("local-list");
    list.replaceChildren();
    if (!state.localIds.length) {
      const note = document.createElement("p");
      note.className = "empty-note";
      note.textContent = "还没有本地壁纸";
      list.append(note);
      return;
    }
    for (const id of state.localIds) {
      const wrap = document.createElement("div");
      wrap.className = "thumb";
      wrap.dataset.local = id;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thumb-btn";
      button.dataset.local = id;
      button.setAttribute("aria-label", "使用这张本地壁纸");
      const blob = await idbGet(`local:${id}`).catch(() => null);
      if (renderGen !== localRenderGen) return;
      if (blob) {
        const url = URL.createObjectURL(blob);
        localUrls.set(id, url);
        const video = blob.type.startsWith("video/");
        const media = document.createElement(video ? "video" : "img");
        if (video) {
          media.muted = true;
          media.loop = true;
          media.autoplay = true;
          media.playsInline = true;
        } else {
          media.alt = "";
        }
        media.src = url;
        button.append(media);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "thumb-x";
      remove.dataset.removeLocal = id;
      remove.setAttribute("aria-label", "删除这张壁纸");
      remove.textContent = "×";
      wrap.append(button, remove);
      list.append(wrap);
    }
    syncActive();
  }

  function setPanel(open) {
    panel.hidden = !open;
    document.body.classList.toggle("is-editing", open);
    $("edit-btn").setAttribute("aria-expanded", String(open));
    if (open) {
      hideSug();
      $("blur").value = String(state.blur);
      renderLocal();
      renderBing();
      $("file-limit").value = String(state.fileLimitMb);
      $("file-limit-value").textContent = `${state.fileLimitMb}MB`;
      syncActive();
      maybeRefreshBing();
    }
  }

  function openDialog(id) {
    editingId = id || null;
    const site = state.sites.find((item) => item.id === id);
    $("dialog-title").textContent = site ? "编辑导航" : "添加导航";
    $("site-name").value = site ? site.name : "";
    $("site-url").value = site ? site.url : "";
    $("site-error").textContent = "";
    backdrop.hidden = false;
    $("site-name").focus();
  }

  function closeDialog() {
    backdrop.hidden = true;
    editingId = null;
  }

  function selectPreset(id) {
    selectionGen += 1;
    cropGen += 1;
    if (!cropBackdrop.hidden) closeCrop();
    state.wallpaper.type = "preset";
    state.wallpaper.preset = id;
    state.wallpaper.crop = null;
    state.wallpaper.credit = "";
    hideImage();
    applySkin();
    saveSettings(["wallpaper"]);
    syncActive();
  }

  async function selectBing(image) {
    const selection = ++selectionGen;
    cropGen += 1;
    if (!cropBackdrop.hidden) closeCrop();
    hideImage();
    state.wallpaper.type = "bing";
    state.wallpaper.bingId = image.id;
    state.wallpaper.crop = null;
    state.wallpaper.credit = image.copyright || "";
    applySkin();
    saveSettings(["wallpaper"]);
    syncActive();
    $("bing-auto").checked = Boolean(state.wallpaper.auto);
    try {
      const blob = await cacheBing(image.id);
      if (selection === selectionGen) showBlob(blob);
    } catch {
      if (selection === selectionGen) {
        bgPreset.className = "bg-preset skin-aurora";
        $("bing-status").textContent = "这张壁纸暂时加载失败";
      }
    }
  }

  async function selectLocal(id) {
    const selection = ++selectionGen;
    paintGen += 1;
    cropGen += 1;
    if (!cropBackdrop.hidden) closeCrop();
    const blob = await idbGet(`local:${id}`).catch(() => null);
    if (selection !== selectionGen || !state.localIds.includes(id)) return;
    if (!blob) {
      $("local-note").textContent = "这张壁纸已不可用";
      return;
    }
    const sameWallpaper = state.wallpaper.type === "local" && state.wallpaper.localId === id;
    state.wallpaper.type = "local";
    state.wallpaper.localId = id;
    if (!sameWallpaper) state.wallpaper.crop = null;
    state.wallpaper.credit = "";
    applySkin();
    showBlob(blob);
    saveSettings(["wallpaper"]);
    syncActive();
  }

  async function removeLocal(id) {
    if (!cropBackdrop.hidden && cropId === id) closeCrop();
    state.localIds = state.localIds.filter((item) => item !== id);
    const selection = selectionGen;
    await idbDelete(`local:${id}`).catch(() => {});
    if (selection === selectionGen && state.wallpaper.type === "local" && state.wallpaper.localId === id) {
      cropGen += 1;
      state.wallpaper.type = "preset";
      state.wallpaper.preset = state.wallpaper.preset || "aurora";
      hideImage();
      applySkin();
      saveSettings(["wallpaper"]);
    }
    saveSettings(["localIds"]);
    renderLocal();
  }

  function decodeImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.decoding = "async";
      const finish = (error) => {
        URL.revokeObjectURL(url);
        if (error) reject(error);
        else resolve(image);
      };
      image.onload = () => {
        if (image.naturalWidth && image.naturalHeight) finish();
        else finish(new Error("empty image"));
      };
      image.onerror = () => finish(new Error("decode image"));
      image.src = url;
      if (image.decode) {
        image.decode().catch(() => {
          // 某些浏览器的 decode() 对 PNG 会拒绝，但 onload 仍能证明图片可绘制。
        });
      }
    });
  }

  async function addLocal(file) {
    const reset = resetGen;
    const selection = ++selectionGen;
    cropGen += 1;
    if (!cropBackdrop.hidden) closeCrop();
    if (!file) throw new Error("请选择图片或视频文件");
    if (file.size > state.fileLimitMb * 1024 * 1024) {
      throw new Error(`文件不能超过 ${state.fileLimitMb}MB`);
    }
    const video = file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name || "");
    const gif = file.type === "image/gif" || /\.gif$/i.test(file.name || "");
    if (!video && !file.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif)$/i.test(file.name || "")) {
      throw new Error("请选择图片或视频文件");
    }
    let blob = file;
    if (video && !file.type.startsWith("video/")) {
      const ext = file.name.split(".").pop().toLowerCase();
      const types = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg" };
      blob = file.slice(0, file.size, types[ext]);
    } else if (gif && file.type !== "image/gif") {
      blob = file.slice(0, file.size, "image/gif");
    }
    if (!video) {
      let image;
      try {
        image = await decodeImage(blob);
      } catch {
        throw new Error("无法解码这张图片，请确认文件完整且格式受浏览器支持");
      }
      // 保留图片原始文件和原生分辨率，不再缩放或重新编码。
      // GIF 也保持原始动图数据，避免破坏动画效果。
    }
    if (reset !== resetGen) return;
    const id = uid();
    try {
      await idbSet(`local:${id}`, blob);
    } catch {
      throw new Error("浏览器无法保存该文件；请检查存储空间或重新加载扩展");
    }
    if (reset !== resetGen) {
      await idbDelete(`local:${id}`).catch(() => {});
      return;
    }
    state.localIds.unshift(id);
    await saveSettings(["localIds"]);
    await renderLocal();
    if (selection === selectionGen) await selectLocal(id);
  }

  async function openCrop() {
    if (state.wallpaper.type !== "local") {
      $("local-note").textContent = "请先选择本地图片或视频壁纸";
      return;
    }
    const id = state.wallpaper.localId;
    const token = ++cropGen;
    const selection = selectionGen;
    const blob = await idbGet(`local:${id}`).catch(() => null);
    if (token !== cropGen || selection !== selectionGen || state.wallpaper.type !== "local" || state.wallpaper.localId !== id) return;
    if (!blob) {
      $("local-note").textContent = "当前壁纸已不可用";
      return;
    }
    if (!cropBackdrop.hidden) closeCrop();
    cropId = id;
    const media = document.createElement(blob.type.startsWith("video/") ? "video" : "img");
    media.className = "crop-media";
    if (media.tagName === "VIDEO") {
      media.muted = true;
      media.autoplay = true;
      media.loop = true;
      media.playsInline = true;
    }
    media.draggable = false;
    cropStage.prepend(media);
    cropState = { ...(state.wallpaper.crop || { zoom: 1, offsetX: 0.5, offsetY: 0.5 }) };
    $("crop-error").textContent = "";
    $("crop-save").disabled = true;
    const ready = () => {
      if (cropStage.contains(media)) {
        $("crop-save").disabled = false;
        updateCropFrame();
      }
    };
    media.onload = ready;
    media.onloadedmetadata = ready;
    media.onerror = () => {
      if (cropStage.contains(media)) {
        $("crop-save").disabled = true;
        $("crop-error").textContent = "无法加载该壁纸，请确认文件格式受浏览器支持";
      }
    };
    media.src = URL.createObjectURL(blob);
    cropBackdrop.hidden = false;
    updateCropFrame();
    cropStage.focus();
  }

  function updateCropFrame() {
    if (!cropState) return;
    const rect = cropStage.getBoundingClientRect();
    const ratio = window.innerWidth / window.innerHeight;
    const width = Math.min(rect.width, rect.height * ratio);
    const height = width / ratio;
    const left = (rect.width - width) / 2;
    const top = (rect.height - height) / 2;
    const media = cropStage.querySelector("img, video");
    [cropFrame, media].forEach((element) => {
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
    });
    styleCropMedia(media, cropState);
    $("crop-zoom").value = String(cropState.zoom);
    $("crop-zoom-value").textContent = `${Math.round(cropState.zoom * 100)}%`;
  }

  function closeCrop() {
    cropGen += 1;
    const wasOpen = !cropBackdrop.hidden;
    cropBackdrop.hidden = true;
    const media = cropStage.querySelector("img, video");
    if (media) {
      URL.revokeObjectURL(media.src);
      media.remove();
    }
    cropState = null;
    cropId = "";
    if (wasOpen) $("crop-current").focus();
  }

  function saveCrop() {
    if (!cropState || $("crop-save").disabled || state.wallpaper.type !== "local" || state.wallpaper.localId !== cropId) return;
    state.wallpaper.crop = { ...cropState };
    saveSettings(["wallpaper"]);
    applyCropStyle();
    closeCrop();
  }

  $("crop-zoom").addEventListener("input", (event) => {
    if (!cropState) return;
    cropState.zoom = Number(event.target.value);
    updateCropFrame();
  });

  cropStage.addEventListener("wheel", (event) => {
    if (!cropState || !event.deltaY) return;
    event.preventDefault();
    cropState.zoom = Math.min(MAX_CROP_ZOOM, Math.max(1, Math.round(cropState.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08) * 100) / 100));
    updateCropFrame();
  }, { passive: false });

  function moveCrop(dx, dy) {
    if (!cropState) return;
    const media = cropStage.querySelector("img, video");
    const frame = cropFrame.getBoundingClientRect();
    const naturalWidth = media.videoWidth || media.naturalWidth;
    const naturalHeight = media.videoHeight || media.naturalHeight;
    if (!naturalWidth || !naturalHeight || !frame.width || !frame.height) return;
    const scale = Math.max(frame.width / naturalWidth, frame.height / naturalHeight) * cropState.zoom;
    const overflowX = naturalWidth * scale - frame.width;
    const overflowY = naturalHeight * scale - frame.height;
    if (overflowX > 0.001) cropState.offsetX = Math.max(0, Math.min(1, cropState.offsetX - dx / overflowX));
    if (overflowY > 0.001) cropState.offsetY = Math.max(0, Math.min(1, cropState.offsetY - dy / overflowY));
    updateCropFrame();
  }

  cropStage.addEventListener("keydown", (event) => {
    const delta = event.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
    if (!cropState || !moves[event.key]) return;
    event.preventDefault();
    moveCrop(...moves[event.key]);
  });

  cropStage.addEventListener("pointerdown", (event) => {
    if (!cropState || event.button !== 0) return;
    const media = cropStage.querySelector("img, video");
    const frame = cropFrame.getBoundingClientRect();
    const naturalWidth = media.videoWidth || media.naturalWidth;
    const naturalHeight = media.videoHeight || media.naturalHeight;
    if (!naturalWidth || !naturalHeight) return;
    event.preventDefault();
    cropStage.setPointerCapture(event.pointerId);
    let x = event.clientX;
    let y = event.clientY;
    const move = (next) => {
      if (!cropState || next.pointerId !== event.pointerId) return;
      moveCrop(next.clientX - x, next.clientY - y);
      x = next.clientX;
      y = next.clientY;
    };
    const stop = (next) => {
      if (next.pointerId !== event.pointerId) return;
      cropStage.removeEventListener("pointermove", move);
      cropStage.removeEventListener("pointerup", stop);
      cropStage.removeEventListener("pointercancel", stop);
      cropStage.removeEventListener("lostpointercapture", stop);
    };
    cropStage.addEventListener("pointermove", move);
    cropStage.addEventListener("pointerup", stop);
    cropStage.addEventListener("pointercancel", stop);
    cropStage.addEventListener("lostpointercapture", stop);
  });

  function commitOrder() {
    const ids = [...grid.querySelectorAll(".card")].map((card) => card.dataset.id);
    const byId = new Map(state.sites.map((site) => [site.id, site]));
    const next = ids.map((id) => byId.get(id)).filter(Boolean);
    if (next.length === state.sites.length) {
      state.sites = next;
      saveSettings(["sites"]);
    }
  }

  function bingBatch(idx, count) {
    return fetch(`https://www.bing.com/HPImageArchive.aspx?format=js&idx=${idx}&n=${count}&mkt=zh-CN`)
      .then((response) => {
        if (!response.ok) throw new Error("bing");
        return response.json();
      })
      .then((data) => (data.images || []).map((image) => ({
        id: image.urlbase || "",
        title: image.title || "",
        copyright: image.copyright || ""
      })).filter((image) => image.id));
  }

  function mergeBingHistory(images) {
    const seen = new Set();
    const merged = [];
    [...images, ...state.bingHistory].forEach((image) => {
      if (!image.id || seen.has(image.id)) return;
      seen.add(image.id);
      merged.push(image);
    });
    const next = merged.slice(0, MAX_BING);
    const changed = next.length !== state.bingHistory.length
      || (next[0] && state.bingHistory[0] ? next[0].id !== state.bingHistory[0].id : next.length > 0);
    state.bingHistory = next;
    return changed;
  }

  function pruneBingBlobs() {
    const keep = new Set(state.bingHistory.map((image) => `bing:${image.id}`));
    if (state.wallpaper.bingId) keep.add(`bing:${state.wallpaper.bingId}`);
    idbKeys().then((keys) => Promise.all(
      keys.filter((key) => String(key).startsWith("bing:") && !keep.has(String(key))).map((key) => idbDelete(key))
    )).catch(() => {});
  }

  async function loadBing() {
    lastBingFetch = Date.now();
    try {
      const latest = await bingBatch(0, 8);
      const older = [];
      if (state.bingHistory.length < BING_SEED) {
        for (const idx of [8, 16]) {
          try {
            older.push(...await bingBatch(idx, 8));
          } catch { /* 历史补录失败不影响最新一批 */ }
        }
      }
      if (mergeBingHistory([...latest, ...older])) saveSettings(["bingHistory"]);
      renderBing();
      pruneBingBlobs();
      if (state.wallpaper.type !== "bing") return;
      const pinned = state.bingHistory.find((image) => image.id === state.wallpaper.bingId);
      const current = state.wallpaper.auto ? state.bingHistory[0] : (pinned || state.bingHistory[0]);
      if (current && current.id !== state.wallpaper.bingId) await selectBing(current);
      else if (current) {
        const selection = selectionGen;
        const shown = await showStored(`bing:${current.id}`);
        if (shown === false && selection === selectionGen) {
          const blob = await cacheBing(current.id);
          if (selection === selectionGen && state.wallpaper.type === "bing" && state.wallpaper.bingId === current.id) showBlob(blob);
        }
      }
    } catch {
      renderBing();
      if (!state.bingHistory.length) $("bing-status").textContent = "暂时连不上必应，请稍后再试";
      if (state.wallpaper.type === "bing" && state.wallpaper.bingId) {
        const shown = await showStored(`bing:${state.wallpaper.bingId}`);
        if (shown === false) hideImage();
      }
    }
  }

  function maybeRefreshBing() {
    if (Date.now() - lastBingFetch < BING_REFRESH_MS) return;
    loadBing();
  }

  function tick() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    $("clock").textContent = `${hh}:${mm}`;
    $("clock").dateTime = now.toISOString();
    const hour = now.getHours();
    const hello = hour < 5 ? "夜深了" : hour < 11 ? "早上好" : hour < 13 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
    const date = now.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
    $("subline").textContent = `${date} · ${hello}`;
  }

  function arm(button, label, iconId) {
    button.classList.add("is-armed");
    button.textContent = "确定";
    const timer = setTimeout(() => {
      button.classList.remove("is-armed");
      button.replaceChildren(cloneIcon(iconId));
      button.setAttribute("aria-label", label);
    }, 1800);
    button.dataset.timer = String(timer);
  }

  let navigationCard = null;

  function resetNavigationCard() {
    if (!navigationCard) return;
    navigationCard.classList.add("navigation-reset");
    if (navigationCard.contains(document.activeElement)) document.activeElement.blur();
  }

  grid.addEventListener("pointermove", (event) => {
    if (!navigationCard || (!event.movementX && !event.movementY)) return;
    navigationCard.classList.remove("navigation-reset");
    navigationCard = null;
  });
  grid.addEventListener("focusin", (event) => {
    if (navigationCard && event.target.closest(".card") === navigationCard) {
      navigationCard.classList.remove("navigation-reset");
      navigationCard = null;
    }
  });
  window.addEventListener("pageshow", (event) => { if (event.persisted) resetNavigationCard(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) resetNavigationCard(); });

  grid.addEventListener("click", (event) => {
    const action = event.target.closest("[data-act]");
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      if (action.dataset.act === "add") {
        if (state.sites.length >= MAX_SITES) return;
        openDialog(null);
        return;
      }
      const card = action.closest(".card");
      if (!card) return;
      if (action.dataset.act === "edit") openDialog(card.dataset.id);
      if (action.dataset.act === "delete") {
        if (!action.classList.contains("is-armed")) {
          arm(action, "删除", "tpl-trash");
          return;
        }
        clearTimeout(Number(action.dataset.timer));
        state.sites = state.sites.filter((site) => site.id !== card.dataset.id);
        saveSettings(["sites"]);
        renderGrid();
      }
      return;
    }
    if (suppressClick) {
      event.preventDefault();
      suppressClick = false;
      return;
    }
    const card = event.target.closest(".card");
    if (card && !event.defaultPrevented) {
      if (navigationCard) navigationCard.classList.remove("navigation-reset");
      navigationCard = card;
      if (!panel.hidden) setPanel(false);
      resetNavigationCard();
    }
  });

  grid.addEventListener("pointerdown", (event) => {
    const card = event.target.closest(".card");
    if (card && event.target.closest(".mini")) card.draggable = false;
  });

  function restoreDraggable() {
    grid.querySelectorAll(".card").forEach((card) => { card.draggable = true; });
  }

  document.addEventListener("pointerup", restoreDraggable);
  document.addEventListener("pointercancel", restoreDraggable);

  let dragState = null;

  grid.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".card");
    if (!card || event.target.closest(".mini")) {
      event.preventDefault();
      return;
    }
    const placeholder = document.createElement("span");
    placeholder.className = "drag-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.dataset.id);
    event.dataTransfer.setDragImage(card, event.clientX - card.getBoundingClientRect().left, event.clientY - card.getBoundingClientRect().top);
    dragState = { card, placeholder, dropped: false };
    grid.insertBefore(placeholder, card);
    card.classList.add("dragging");
    setTimeout(() => {
      if (dragState && dragState.card === card) card.style.display = "none";
    }, 0);
    suppressClick = true;
  });

  grid.addEventListener("dragover", (event) => {
    if (!dragState) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const { placeholder } = dragState;
    const items = [...grid.querySelectorAll(".card:not(.dragging), .drag-placeholder")];
    let nearest = null;
    let best = Infinity;
    items.forEach((item) => {
      const rect = item.getBoundingClientRect();
      const dist = (event.clientX - (rect.left + rect.width / 2)) ** 2 + (event.clientY - (rect.top + rect.height / 2)) ** 2;
      if (dist < best) {
        best = dist;
        nearest = item;
      }
    });
    if (!nearest || nearest === placeholder) return;
    const before = items.indexOf(nearest) < items.indexOf(placeholder);
    grid.insertBefore(placeholder, before ? nearest : nearest.nextSibling);
  });

  grid.addEventListener("drop", (event) => {
    if (!dragState) return;
    event.preventDefault();
    dragState.dropped = true;
  });

  grid.addEventListener("dragend", () => {
    if (!dragState) return;
    const { card, placeholder, dropped } = dragState;
    dragState = null;
    card.classList.remove("dragging");
    card.style.removeProperty("display");
    if (dropped) {
      placeholder.replaceWith(card);
      commitOrder();
    } else {
      placeholder.remove();
    }
    restoreDraggable();
    setTimeout(() => { suppressClick = false; }, 80);
  });

  $("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    hideSug();
    const query = $("q").value.trim();
    if (!query) return;
    const engine = engineOf(state.engine);
    const isUrl = looksLikeUrl(query);
    const target = isUrl ? normalizeUrl(query) : engine.url + encodeURIComponent(query);
    if (!target) return;
    if (!isUrl) {
      pushHistory(query);
      saveSettings(["history"]);
    }
    const link = document.createElement("a");
    link.href = target;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
    $("q").value = "";
  });

  $("engine-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    hideSug();
    setMenu(engineMenu.hidden);
  });

  engineMenu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-engine]");
    if (!button) return;
    state.engine = button.dataset.engine;
    updateEngine();
    setMenu(false);
    saveSettings(["engine"]);
    $("q").focus();
    scheduleSug();
  });

  $("q").addEventListener("input", (event) => {
    if (event.isComposing) return;
    if (!$("q").value.trim()) {
      // 删空后回到历史列表
      showHistory();
      return;
    }
    scheduleSug();
  });

  // 只在真正点击输入框时唤起历史：切换标签页回来的被动 focus 不应弹出来
  $("q").addEventListener("pointerdown", () => showHistory());

  window.addEventListener("resize", () => {
    hideSug();
    if (!cropBackdrop.hidden) updateCropFrame();
  });

  $("q").addEventListener("compositionstart", () => hideSug());

  $("q").addEventListener("compositionend", () => scheduleSug());

  $("q").addEventListener("blur", (event) => {
    if (!sugList.contains(event.relatedTarget)) hideSug();
  });

  sugList.addEventListener("focusout", (event) => {
    if (event.relatedTarget !== $("q") && !sugList.contains(event.relatedTarget)) hideSug();
  });

  $("q").addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" && sugItems.length) {
      event.preventDefault();
      moveSug(1);
      return;
    }
    if (event.key === "ArrowUp" && sugItems.length) {
      event.preventDefault();
      moveSug(-1);
      return;
    }
    if (event.key === "Enter" && sugIndex >= 0 && sugItems[sugIndex]) {
      event.preventDefault();
      applySug(sugItems[sugIndex]);
      return;
    }
    if (event.key === "Escape" && !sugList.hidden) {
      event.preventDefault();
      event.stopPropagation();
      hideSug();
    }
  });

  sugList.addEventListener("mousedown", (event) => {
    if (event.target.closest("[data-remove-history]")) {
      event.preventDefault();
      return;
    }
    const button = event.target.closest("[data-sug]");
    if (!button) return;
    event.preventDefault();
    applySug(button.dataset.sug);
  });

  sugList.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-history]");
    if (!remove) {
      const button = event.target.closest("[data-sug]");
      if (button && event.detail === 0) applySug(button.dataset.sug);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    sugSeq += 1;
    clearTimeout(sugTimer);
    if (sugAbort) {
      sugAbort.abort();
      sugAbort = null;
    }
    const query = $("q").value.trim();
    state.history = state.history.filter((text) => text !== remove.dataset.removeHistory);
    saveSettings(["history"]);
    $("q").focus();
    renderSug(query ? historyMatches(query) : state.history.slice(0, HIST_VISIBLE), "history");
  });

  $("edit-btn").addEventListener("click", () => setPanel(panel.hidden));
  $("crop-current").addEventListener("click", openCrop);
  $("crop-cancel").addEventListener("click", closeCrop);
  $("crop-save").addEventListener("click", saveCrop);
  cropBackdrop.addEventListener("click", (event) => { if (event.target === cropBackdrop) closeCrop(); });
  $("panel-close").addEventListener("click", () => setPanel(false));

  $("preset-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset]");
    if (button) selectPreset(button.dataset.preset);
  });

  $("bing-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-bing]");
    if (!button) return;
    const image = state.bingHistory.find((item) => item.id === button.dataset.bing);
    if (!image) return;
    state.wallpaper.auto = Boolean(state.bingHistory[0] && state.bingHistory[0].id === image.id);
    selectBing(image);
  });

  $("bing-more").addEventListener("click", () => {
    bingExpanded = !bingExpanded;
    renderBing();
  });

  $("bing-auto").addEventListener("change", (event) => {
    state.wallpaper.auto = event.target.checked;
    saveSettings(["wallpaper"]);
    renderBing();
    if (state.wallpaper.auto && state.bingHistory[0]) selectBing(state.bingHistory[0]);
  });

  $("local-list").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-local]");
    if (remove) {
      removeLocal(remove.dataset.removeLocal);
      return;
    }
    const button = event.target.closest("[data-local]");
    if (button && button.dataset.local) selectLocal(button.dataset.local);
  });

  $("file").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      $("local-note").textContent = "";
      await addLocal(file);
    } catch (error) {
      $("local-note").textContent = error && error.message ? error.message : "无法使用该壁纸";
    }
  });

  $("file-limit").addEventListener("input", (event) => {
    state.fileLimitMb = Number(event.target.value);
    $("file-limit-value").textContent = `${state.fileLimitMb}MB`;
  });
  $("file-limit").addEventListener("change", () => saveSettings(["fileLimitMb"]));

  $("blur").addEventListener("input", (event) => {
    state.blur = Number(event.target.value);
    setBlur(state.blur);
  });
  $("blur").addEventListener("change", () => saveSettings(["blur"]));

  $("reset").addEventListener("click", () => {
    const button = $("reset");
    if (!button.classList.contains("is-armed")) {
      button.classList.add("is-armed");
      button.textContent = "再点一次确认";
      setTimeout(() => {
        button.classList.remove("is-armed");
        button.textContent = "恢复默认";
      }, 2000);
      return;
    }
    resetGen += 1;
    selectionGen += 1;
    cropGen += 1;
    if (!cropBackdrop.hidden) closeCrop();
    hideImage();
    const localIds = state.localIds.slice();
    Object.assign(state, fresh(), { localIds, history: state.history });
    applySkin();
    $("file-limit").value = String(state.fileLimitMb);
    $("file-limit-value").textContent = `${state.fileLimitMb}MB`;
    updateEngine();
    renderGrid();
    setBlur(state.blur);
    $("blur").value = String(state.blur);
    saveSettings(["engine", "sites", "wallpaper", "bingHistory", "blur", "dim", "fileLimitMb", "defaults"]);
    loadBing();
    button.classList.remove("is-armed");
    button.textContent = "恢复默认";
  });

  $("site-cancel").addEventListener("click", closeDialog);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeDialog();
  });

  $("site-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("site-name").value.trim().slice(0, 20);
    const url = normalizeUrl($("site-url").value);
    if (!name || !url) {
      $("site-error").textContent = "请填写名称和有效网址";
      return;
    }
    if (editingId) {
      const site = state.sites.find((item) => item.id === editingId);
      if (site) {
        site.name = name;
        site.url = url;
      }
    } else {
      if (state.sites.length >= MAX_SITES) {
        $("site-error").textContent = `最多 ${MAX_SITES} 个导航`;
        return;
      }
      state.sites.push({ id: uid(), name, url });
    }
    saveSettings(["sites"]);
    renderGrid();
    closeDialog();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!backdrop.hidden || !cropBackdrop.hidden) return;
    if (!engineMenu.hidden && !event.target.closest("#engine-menu") && !event.target.closest("#engine-btn")) setMenu(false);
    if (!panel.hidden && !event.target.closest("#panel") && !event.target.closest("#edit-btn")) setPanel(false);
  });

  document.addEventListener("keydown", (event) => {
    if (!cropBackdrop.hidden && event.key === "Tab") {
      const controls = [cropStage, $("crop-zoom"), $("crop-cancel"), $("crop-save")].filter((element) => !element.disabled);
      const index = controls.indexOf(document.activeElement);
      if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === controls.length - 1)) {
        event.preventDefault();
        controls[event.shiftKey ? controls.length - 1 : 0].focus();
      }
    }
    if (event.key === "Escape") {
      if (!cropBackdrop.hidden) closeCrop();
      else if (!backdrop.hidden) closeDialog();
      else if (!engineMenu.hidden) setMenu(false);
      else if (!panel.hidden) setPanel(false);
      return;
    }
    if (event.key === "/" && document.activeElement !== $("q") && backdrop.hidden && cropBackdrop.hidden) {
      event.preventDefault();
      $("q").focus();
    }
  });

  let storageChangeGen = 0;
  let startupStorageChanged = false;
  const changedStorageFields = new Set();

  if (globalThis.chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== "local" || !Object.keys(state).some((key) => Object.hasOwn(changes, `${STORE_KEY}:${key}`))) return;
      if (!settingsReady) {
        startupStorageChanged = true;
        return;
      }
      Object.keys(state).forEach((key) => {
        if (Object.hasOwn(changes, `${STORE_KEY}:${key}`)) changedStorageFields.add(key);
      });
      const gen = ++storageChangeGen;
      try {
        await saveQueue.catch(() => {});
        const saved = await loadSettings();
        if (gen !== storageChangeGen) return;
        const updates = {};
        changedStorageFields.forEach((key) => {
          const value = saved && Object.hasOwn(saved, key) ? saved[key] : fresh()[key];
          if (!writingFields.has(key) && JSON.stringify(value) !== JSON.stringify(state[key])) updates[key] = value;
        });
        changedStorageFields.clear();
        if (!Object.keys(updates).length) return;
        sanitize({ ...state, ...updates });
        if (Object.hasOwn(updates, "engine")) updateEngine();
        if (Object.hasOwn(updates, "sites")) renderGrid();
        if (Object.hasOwn(updates, "blur") || Object.hasOwn(updates, "dim")) {
          setBlur(state.blur);
          $("blur").value = String(state.blur);
        }
        if (Object.hasOwn(updates, "fileLimitMb")) {
          $("file-limit").value = String(state.fileLimitMb);
          $("file-limit-value").textContent = `${state.fileLimitMb}MB`;
        }
        if (Object.hasOwn(updates, "localIds")) renderLocal();
        if (Object.hasOwn(updates, "bingHistory")) renderBing();
        if (Object.hasOwn(updates, "wallpaper")) {
          selectionGen += 1;
          cropGen += 1;
          if (!cropBackdrop.hidden) closeCrop();
          hideImage();
          paintWallpaper();
          renderBing();
          syncActive();
        }
      } catch (error) {
        reportStorageError(error);
      }
    });
  }

  async function start() {
    document.documentElement.inert = true;
    try {
      let saved;
      do {
        startupStorageChanged = false;
        saved = await loadSettings();
      } while (startupStorageChanged);
      sanitize(saved);
    } catch (error) {
      reportStorageError(error);
      return;
    }
    settingsReady = true;
    document.documentElement.inert = false;
    updateEngine();
    renderGrid();
    renderPresets();
    tick();
    setInterval(tick, 1000);
    setInterval(() => { if (!document.hidden) maybeRefreshBing(); }, BING_REFRESH_MS);
    if (migrated) saveSettings(["fileLimitMb"]);
    await paintWallpaper();
    loadBing();
  }

  start();
})();
