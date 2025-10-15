import OBR from "@owlbear-rodeo/sdk";

// --- UI refs ---
const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const fileListEl = document.getElementById("fileList");

const btnArm = document.getElementById("btn-arm");
const btnPreload = document.getElementById("btn-preload");
const btnTest = document.getElementById("btn-test");
const volumeEl = document.getElementById("volume");

// --- CHAOS settings ---
const CHAOS_INTERVAL_MS = 200;
const MAX_CHANNELS_HARD_CAP = 128;

// --- State ---
let armed = false;
let chaosInterval = null;

let files = [];                     // ['/sounds/monkey1.mp3', ...]
let audioCtx = null;                // AudioContext
let gainNode = null;                // volume master
let buffers = new Map();            // url -> AudioBuffer (pré-décodé)
let activeSources = new Set();      // BufferSource actifs
let lastIndex = -1;                 // anti-répétition immédiate
let lastReady = null;               // null | true | false (dernier état de scène)

// --- Utils ---
function log(msg) {
  const ts = new Date().toLocaleTimeString();
  logEl.textContent = `[${ts}] ${msg}\n` + logEl.textContent;
  console.debug("[IdleSounds-CHAOS]", msg);
}

async function loadList() {
  try {
    const res = await fetch("/sounds/sounds.json", { cache: "no-store" });
    const data = await res.json();
    files = Array.isArray(data.files) ? data.files : [];
    fileListEl.innerHTML = "";
    files.forEach((f) => {
      const li = document.createElement("li");
      li.textContent = f;
      fileListEl.appendChild(li);
    });
    log(`Chargé ${files.length} fichier(s) audio.`);
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

// --- Web Audio helpers ---
async function ensureAudioContextUnlocked() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = Number(volumeEl?.value ?? 0.8);
    gainNode.connect(audioCtx.destination);
  }
  if (audioCtx.state !== "running") {
    await audioCtx.resume(); // doit être appelé après un geste utilisateur
  }
  // ping de silence ultra court (certains navigateurs)
  const silence = audioCtx.createBuffer(1, 128, audioCtx.sampleRate);
  const src = audioCtx.createBufferSource();
  src.buffer = silence;
  src.connect(gainNode);
  src.start();
}

async function fetchAndDecode(url) {
  if (buffers.has(url)) return buffers.get(url);
  const resp = await fetch(url, { cache: "force-cache" });
  const arr = await resp.arrayBuffer();
  const buf = await audioCtx.decodeAudioData(arr);
  buffers.set(url, buf);
  return buf;
}

async function preloadAll() {
  if (!files.length) return log("Aucun fichier audio listé.");
  await ensureAudioContextUnlocked();
  await Promise.all(files.map(fetchAndDecode));
  log(`Préchargement terminé (${buffers.size} buffers).`);
}

function playBuffer(buf) {
  if (!audioCtx || !buf) return;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(gainNode);
  src.onended = () => activeSources.delete(src);
  src.start(); // now
  activeSources.add(src);
}

async function chaosTick() {
  if (!armed || !files.length) return;

  // hard cap
  if (activeSources.size >= MAX_CHANNELS_HARD_CAP) {
    for (const s of [...activeSources]) {
      // on trust onended pour purger; ici juste un garde-fou
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
    log(`🎯 CHAOS: ${url} (actifs: ${activeSources.size})`);
  } catch (err) {
    log("Échec lecture/decode (autoplay ou fichier ?). Voir console.");
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

// --- UI ---
btnArm?.addEventListener("click", async () => {
  try {
    await ensureAudioContextUnlocked();
    armed = true;
    if (btnArm) btnArm.disabled = true;
    log("Autorisations audio acquises (AudioContext running).");

    // 🔥 DÉMARRAGE IMMÉDIAT si aucune scène au moment du clic
    if (lastReady === false) {
      startChaos();
    } else if (lastReady === true) {
      stopAll();
    } else {
      // si on n'a pas encore la valeur, on la lit maintenant
      if (OBR.isAvailable) {
        const r = await OBR.scene.isReady();
        lastReady = r;
        if (!r) startChaos(); else stopAll();
      } else {
        // hors OBR → part direct
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
});

// --- OBR integration ---
async function updateReadyUI(ready) {
  lastReady = ready; // ✅ mémorise l'état courant
  statusEl.textContent = ready ? "🎬 scène ouverte" : "🔇 aucune scène";
  statusEl.style.color = ready ? "#93c5fd" : "#a7f3d0";

  if (ready) {
    stopAll();      // scène ouverte → silence
  } else {
    startChaos();   // aucune scène → CHAOS (si déjà armé, sinon démarrera au clic)
  }
}

async function init() {
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
