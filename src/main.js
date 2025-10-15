import OBR from "@owlbear-rodeo/sdk";

// --- Références UI existantes ---
const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const fileListEl = document.getElementById("fileList");

const btnArm = document.getElementById("btn-arm");
const btnPreload = document.getElementById("btn-preload");
const btnTest = document.getElementById("btn-test");
const volumeEl = document.getElementById("volume");

// --- Réglages CHAOS ---
const CHAOS_ENABLED = true;          // on force le chaos
const CHAOS_INTERVAL_MS = 200;       // un tir toutes les 200ms
const MAX_CHANNELS_HARD_CAP = 64;    // sécurité pour éviter le crash navigateur (augmente si tu veux VRAIMENT le chaos)

// --- État ---
let armed = false;                   // l’utilisateur a cliqué pour autoriser l’audio
let files = [];                      // liste depuis /sounds/sounds.json
let audioPool = [];                  // préchargement optionnel
let chaosInterval = null;            // setInterval id
const activeAudios = new Set();      // instances Audio concurrentes
let lastIndex = -1;                  // pour éviter une répétition immédiate en "shuffle" basique

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
  // mini-shuffle: évite seulement la répétition immédiate
  let idx = Math.floor(Math.random() * files.length);
  if (files.length > 1) {
    while (idx === lastIndex) idx = Math.floor(Math.random() * files.length);
  }
  lastIndex = idx;
  return idx;
}

function createAudio(url) {
  const a = new Audio(url);
  a.preload = "auto";
  a.crossOrigin = "anonymous";
  a.volume = Number(volumeEl?.value ?? 0.8);
  return a;
}

async function preloadAll() {
  audioPool = files.map(createAudio);
  audioPool.forEach(a => a.load());
  log(`Préchargement lancé (${audioPool.length})`);
}

// --- Cœur: tir CHAOS (polyphonie overlapping, toutes 200ms) ---
async function chaosTick() {
  if (!armed || files.length === 0) return;

  // Hard cap de sécurité
  if (activeAudios.size >= MAX_CHANNELS_HARD_CAP) {
    // on nettoie les canaux terminés (au cas où)
    for (const a of [...activeAudios]) {
      if (a.ended || a.paused) activeAudios.delete(a);
    }
    if (activeAudios.size >= MAX_CHANNELS_HARD_CAP) return; // toujours trop plein
  }

  const idx = pickNextIndex();
  if (idx < 0) return;

  const url = files[idx];
  // Ne pas réutiliser un même élément si on veut l’overlap immédiat → nouvelle instance:
  const audio = createAudio(url);
  activeAudios.add(audio);

  audio.onended = () => activeAudios.delete(audio);
  audio.onerror = () => activeAudios.delete(audio);

  try {
    await audio.play(); // si autoplay non armé, ça throw → l’utilisateur doit cliquer "Activer l’audio"
    log(`🎯 CHAOS: ${url} (actifs: ${activeAudios.size})`);
  } catch (err) {
    activeAudios.delete(audio);
    log("Lecture bloquée (autoplay ?). Clique sur “Activer l’audio”.");
  }
}

function startChaos() {
  stopChaos(); // reset par sécurité
  if (!armed) { log("En attente d’autorisation audio…"); return; }
  if (!files.length) { log("Aucun fichier audio listé."); return; }

  // Tir immédiat, puis rafales toutes 200ms
  chaosTick();
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
  // stop scheduling
  stopChaos();
  // stoppe et vide toutes les instances
  for (const a of [...activeAudios]) {
    try { a.pause(); a.currentTime = 0; } catch {}
    activeAudios.delete(a);
  }
  // au cas où des audios du pool joueraient
  for (const a of [...audioPool]) {
    try { a.pause(); a.currentTime = 0; } catch {}
  }
  log("🛑 Tous les sons arrêtés.");
}

// --- UI ---
btnArm?.addEventListener("click", async () => {
  armed = true;
  if (btnArm) btnArm.disabled = true;
  log("Autorisations audio acquises.");
  // petit ping silencieux pour "chauffer" l'autoplay si possible
  if (files.length) {
    try {
      const test = createAudio(files[0]);
      await test.play();
      test.pause();
      test.currentTime = 0;
    } catch {}
  }
});

btnPreload?.addEventListener("click", preloadAll);
btnTest?.addEventListener("click", chaosTick);
volumeEl?.addEventListener("input", () => {
  const v = Number(volumeEl.value);
  // met à jour le volume des canaux actifs et du pool
  activeAudios.forEach(a => a.volume = v);
  audioPool.forEach(a => a.volume = v);
});

// --- Intégration OBR: quand PAS de scène => CHAOS; quand scène prête => SILENCE ---
async function updateReadyUI(ready) {
  statusEl.textContent = ready ? "🎬 scène ouverte" : "🔇 aucune scène";
  statusEl.style.color = ready ? "#93c5fd" : "#a7f3d0";

  if (ready) {
    // scène ouverte: on coupe le chaos immédiatement
    stopAll();
  } else {
    // aucune scène: on démarre le chaos instantanément
    if (CHAOS_ENABLED) startChaos();
  }
}

async function init() {
  await loadList();

  // Mode test hors Owlbear (ex: ouvrez index.html dans un onglet)
  const inOBR = OBR.isAvailable;
  if (!inOBR) {
    log("⚠ Extension ouverte hors Owlbear (mode test).");
    await updateReadyUI(false); // démarre le chaos si armé
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
