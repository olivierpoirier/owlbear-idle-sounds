import OBR from "@owlbear-rodeo/sdk";

// === Storage helpers ===
const LS_KEYS = {
  volume: "idleSounds.volume",
  interval: "idleSounds.intervalMs",
  shout: "idleSounds.shoutOver",
};
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      if (v === null) return fallback;
      if (v === "true" || v === "false") return v === "true";
      const num = Number(v);
      return Number.isFinite(num) && String(num) === v ? num : v;
    } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, String(val)); } catch {}
  }
};

// --- UI refs ---
const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const fileListEl = document.getElementById("fileList");
const btnArm = document.getElementById("btn-arm");
const btnPreload = document.getElementById("btn-preload");
const btnTest = document.getElementById("btn-test");
const volumeEl = document.getElementById("volume");
const intervalEl = document.getElementById("interval");
const shoutOverEl = document.getElementById("shoutOver");

// --- CHAOS defaults ---
let CHAOS_INTERVAL_MS = 200;
const MAX_CHANNELS_HARD_CAP = 128;

// --- State ---
let armed = false;
let chaosInterval = null;

let baseFiles = [];                 // depuis sounds.json
let files = [];                     // baseFiles + shout option
let audioCtx = null;
let gainNode = null;
let buffers = new Map();            // url -> AudioBuffer
let activeSources = new Set();      // BufferSource actifs
let lastIndex = -1;
let lastReady = null;

// --- Utils ---
function log(msg) {
  const ts = new Date().toLocaleTimeString();
  logEl.textContent = `[${ts}] ${msg}\n` + logEl.textContent;
  console.debug("[IdleSounds-CHAOS]", msg);
}

function refreshDetectedList() {
  fileListEl.innerHTML = "";
  files.forEach((f) => {
    const li = document.createElement("li");
    li.textContent = f;
    fileListEl.appendChild(li);
  });
}

function applyOptionsToFiles() {
  files = [...baseFiles];
  if (shoutOverEl.checked) {
    // injecte le cri par dessus les singes
    const shout = "/sounds/ta_gueule_le_singe.mp3";
    if (!files.includes(shout)) files.push(shout);
  }
  refreshDetectedList();
}

async function loadList() {
  try {
    const res = await fetch("/sounds/sounds.json", { cache: "no-store" });
    const data = await res.json();
    baseFiles = Array.isArray(data.files) ? data.files : [];
    applyOptionsToFiles();
    log(`Chargé ${baseFiles.length} fichier(s) audio (base).`);
  } catch (e) {
    log("Erreur de chargement de /sounds/sounds.json");
    console.error(e);
  }
}

function pickNextIndex() {
  if (files.length === 0) return -1;
  let idx = Math.floor(Math.random() * files.length);
  if (files.length > 1) {
    while (idx === lastIndex) idx = Math.floor(Math.random() * files.length);
  }
  lastIndex = idx;
  return idx;
}

// --- Web Audio ---
async function ensureAudioContextUnlocked() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = Number(volumeEl?.value ?? 0.8);
    gainNode.connect(audioCtx.destination);
  }
  if (audioCtx.state !== "running") {
    await audioCtx.resume();
  }
  const silence = audioCtx.createBuffer(1, 128, audioCtx.sampleRate);
  const src = audioCtx.createBufferSource();
  src.buffer = silence;
  src.connect(gainNode);
  src.start();
}

async function fetchAndDecode(url) {
  if (buffers.has(url)) return buffers.get(url);
  const resp = await fetch(url, { cache: "force-cache" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  const arr = await resp.arrayBuffer();
  const buf = await audioCtx.decodeAudioData(arr);
  buffers.set(url, buf);
  return buf;
}

async function preloadAll() {
  if (!files.length) return log("Aucun fichier audio listé.");
  await ensureAudioContextUnlocked();
  await Promise.all(files.map(fetchAndDecode).map(p => p.catch(e => log(`Précharge ignoré: ${e.message}`))));
  log(`Préchargement terminé (${[...buffers.keys()].length} buffers).`);
}

function playBuffer(buf) {
  if (!audioCtx || !buf) return;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(gainNode);
  src.onended = () => activeSources.delete(src);
  src.start();
  activeSources.add(src);
}

async function chaosTick() {
  if (!armed || !files.length) return;

  if (activeSources.size >= MAX_CHANNELS_HARD_CAP) {
    for (const s of [...activeSources]) {
      // laisse onended faire le ménage ; ici, simple soupape
      if (!s.buffer) activeSources.delete(s);
    }
    if (activeSources.size >= MAX_CHANNELS_HARD_CAP) return;
  }

  const idx = pickNextIndex();
  if (idx < 0) return;
  const url = files[idx];

  try {
    await ensureAudioContextUnlocked();
    const buf = buffers.get(url) || await fetchAndDecode(url);
    playBuffer(buf);
  } catch (err) {
    log(`Échec lecture: ${url} — ${err.message}`);
    console.error(err);
  }
}

function startChaos() {
  stopChaos();
  if (!armed) { log("En attente d’autorisation audio…"); return; }
  if (!files.length) { log("Aucun fichier audio listé."); return; }
  chaosTick(); // tir immédiat
  chaosInterval = setInterval(chaosTick, CHAOS_INTERVAL_MS);
  log(`😈 CHAOS ON — tir toutes ${CHAOS_INTERVAL_MS}ms`);
}

function stopChaos() {
  if (chaosInterval) {
    clearInterval(chaosInterval);
    chaosInterval = null;
  }
}

function stopAll() {
  stopChaos();
  for (const s of [...activeSources]) {
    try { s.stop(0); } catch {}
    activeSources.delete(s);
  }
  log("🛑 Tous les sons arrêtés.");
  if (audioCtx && audioCtx.state === "running") {
    audioCtx.suspend().catch(() => {});
  }
}

// --- UI events + persistence ---
function loadPrefs() {
  // Volume
  const vol = store.get(LS_KEYS.volume, 0.8);
  volumeEl.value = String(vol);
  // Intervalle
  const itv = store.get(LS_KEYS.interval, 200);
  intervalEl.value = String(itv);
  CHAOS_INTERVAL_MS = Math.max(20, Number(itv) || 200);
  // Shout
  const sh = store.get(LS_KEYS.shout, false);
  shoutOverEl.checked = !!sh;
}

function persistAndApplyInterval() {
  const itv = Math.max(20, Number(intervalEl.value) || 200);
  CHAOS_INTERVAL_MS = itv;
  store.set(LS_KEYS.interval, itv);
  if (chaosInterval) {
    // redémarre l’intervalle avec la nouvelle cadence
    startChaos();
  }
  log(`Intervalle mis à ${itv}ms`);
}

btnArm?.addEventListener("click", async () => {
  try {
    await ensureAudioContextUnlocked();
    armed = true;
    btnArm.disabled = true;
    log("Autorisations audio acquises (AudioContext running).");

    if (lastReady === false) {
      startChaos();
    } else if (lastReady === true) {
      stopAll();
    } else {
      if (OBR.isAvailable) {
        const r = await OBR.scene.isReady();
        lastReady = r;
        if (!r) startChaos(); else stopAll();
      } else {
        startChaos();
      }
    }
  } catch (e) {
    log("Impossible d’activer l’audio (gesture?). Réessaie.");
    console.error(e);
  }
});

btnPreload?.addEventListener("click", preloadAll);

btnTest?.addEventListener("click", async () => {
  if (!files.length) return;
  const url = files[Math.floor(Math.random() * files.length)];
  try {
    await ensureAudioContextUnlocked();
    const buf = buffers.get(url) || await fetchAndDecode(url);
    playBuffer(buf);
    log(`▶ Test: ${url}`);
  } catch (e) {
    log("Test: échec lecture (voir console).");
    console.error(e);
  }
});

volumeEl?.addEventListener("input", () => {
  const v = Number(volumeEl.value);
  if (gainNode) gainNode.gain.value = v;
  store.set(LS_KEYS.volume, v);
});

intervalEl?.addEventListener("change", persistAndApplyInterval);
intervalEl?.addEventListener("input", () => {
  // feedback instantané optionnel (ne persiste pas à chaque keypress)
});

shoutOverEl?.addEventListener("change", async () => {
  store.set(LS_KEYS.shout, shoutOverEl.checked);
  applyOptionsToFiles();
  // si on avait préchargé, on peut tenter de précharger le nouveau fichier
  if (shoutOverEl.checked && audioCtx) {
    try { await fetchAndDecode("/sounds/ta_gueule_le_singe.mp3"); } catch {}
  }
});

// --- OBR integration ---
async function updateReadyUI(ready) {
  lastReady = ready;
  statusEl.textContent = ready ? "🎬 scène ouverte" : "🔇 aucune scène";
  statusEl.style.color = ready ? "#93c5fd" : "#a7f3d0";
  if (ready) stopAll(); else startChaos();
}

async function init() {
  loadPrefs();
  await loadList();

  const inOBR = OBR.isAvailable;
  if (!inOBR) {
    log("⚠ Extension ouverte hors Owlbear (mode test).");
    await updateReadyUI(false);
    return;
  }

  OBR.onReady(async () => {
    const ready = await OBR.scene.isReady();
    await updateReadyUI(ready);
    const unsub = OBR.scene.onReadyChange(async (isReady) => {
      await updateReadyUI(isReady);
    });
    window.addEventListener("beforeunload", unsub);
  });
}

init();
