(() => {
  const DB_NAME = "myMorningDoorMedia";
  const STORE_NAME = "backgrounds";
  const IMAGE_KEY = "personal";
  const MODE_KEY = "myMorningDoorBackgroundMode";
  const POSITION_KEY = "myMorningDoorBackgroundPosition";
  const MAX_UPLOAD = 15 * 1024 * 1024;
  const MAX_EDGE = 2560;
  const DEFAULT_MODE = "ocean";
  const PRESETS = {
    ocean: "assets/ocean-waves.webp",
    forest: "assets/forest-light.webp",
    desert: "assets/desert-dunes.webp",
    snow: "assets/snowy-sunrise.webp",
  };

  let currentUrl = "";
  let currentMode = DEFAULT_MODE;

  const input = document.querySelector("#backgroundUpload");
  const preview = document.querySelector("#backgroundPreview");
  const remove = document.querySelector("#backgroundRemove");
  const position = document.querySelector("#backgroundPosition");
  const status = document.querySelector("#backgroundStatus");
  const choices = [...document.querySelectorAll("[data-background]")];

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function storeBlob(blob) {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(blob, IMAGE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }

  async function readBlob() {
    const db = await openDatabase();
    const blob = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(IMAGE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return blob;
  }

  async function deleteBlob() {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(IMAGE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }

  function updateSelection() {
    choices.forEach(choice => {
      choice.setAttribute("aria-pressed", String(choice.dataset.background === currentMode));
    });
  }

  function applyPosition(value) {
    const map = { left: "25% center", center: "50% center", right: "75% center" };
    const selected = map[value] || map.center;
    document.documentElement.style.setProperty("--background-position", selected);
    preview.style.backgroundPosition = selected;
  }

  function setMode(mode) {
    const validMode = mode === "custom" || PRESETS[mode] ? mode : DEFAULT_MODE;
    if (validMode === "custom" && !currentUrl) return;

    currentMode = validMode;
    localStorage.setItem(MODE_KEY, currentMode);
    const image = currentMode === "custom" ? currentUrl : PRESETS[currentMode];
    document.documentElement.style.setProperty("--background-image", `url("${image}")`);
    // Built-in backgrounds use a deliberate light or dark glass treatment.
    // Personal photographs keep a stronger neutral surface because their
    // brightness and detail cannot be predicted safely.
    const glassTheme = ["desert", "snow"].includes(currentMode)
      ? "light"
      : currentMode === "custom"
        ? "safe"
        : "dark";
    document.documentElement.dataset.glassTheme = glassTheme;
    updateSelection();
  }

  function preparePersonalPreview(blob, activate = true) {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    preview.style.backgroundImage = `url("${currentUrl}")`;
    preview.hidden = false;
    remove.hidden = false;
    if (activate) setMode("custom");
    else updateSelection();
  }

  async function processImage(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error("Image processing failed")),
        "image/webp",
        0.86,
      );
    });
  }

  choices.forEach(choice => {
    choice.addEventListener("click", () => {
      const mode = choice.dataset.background;
      if (mode === "custom" && !currentUrl) return;
      setMode(mode);
      status.textContent = mode === "custom" ? "Using your personal photograph." : `Using ${choice.textContent.trim()}.`;
    });
  });

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      status.textContent = "Choose a JPEG, PNG or WebP image.";
      input.value = "";
      return;
    }
    if (file.size > MAX_UPLOAD) {
      status.textContent = "That photograph is larger than 15 MB. Choose a smaller copy.";
      input.value = "";
      return;
    }

    status.textContent = "Preparing your photograph…";
    try {
      const blob = await processImage(file);
      await storeBlob(blob);
      preparePersonalPreview(blob);
      status.textContent = "Your personal background is ready and stored on this device.";
    } catch {
      status.textContent = "This photograph could not be prepared. Try another image.";
    }
    input.value = "";
  });

  position.addEventListener("change", () => {
    localStorage.setItem(POSITION_KEY, position.value);
    applyPosition(position.value);
  });

  remove.addEventListener("click", async () => {
    try {
      await deleteBlob();
    } catch {
      status.textContent = "The personal photograph could not be removed right now.";
      return;
    }

    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = "";
    preview.style.backgroundImage = "";
    preview.hidden = true;
    remove.hidden = true;
    setMode(DEFAULT_MODE);
    status.textContent = "Your personal photograph was removed. Open water is restored.";
  });

  async function initialise() {
    const savedPosition = localStorage.getItem(POSITION_KEY) || "center";
    position.value = savedPosition;
    applyPosition(savedPosition);

    currentMode = localStorage.getItem(MODE_KEY) || DEFAULT_MODE;
    try {
      const blob = await readBlob();
      if (blob) preparePersonalPreview(blob, currentMode === "custom");
      if (currentMode === "custom" && !blob) currentMode = DEFAULT_MODE;
    } catch {
      if (currentMode === "custom") currentMode = DEFAULT_MODE;
      status.textContent = "Your personal photograph could not be loaded. A built-in background is being used.";
    }

    setMode(currentMode);
  }

  initialise();
})();
