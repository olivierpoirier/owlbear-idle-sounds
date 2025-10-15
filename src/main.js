import OBR from "@owlbear-rodeo/sdk";

const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const fileListEl = document.getElementById("fileList");

const btnArm = document.getElementById("btn-arm");
const btnPreload = document.getElementById("btn-preload");
const btnTest = document.getElementById("btn-test");
const volumeEl = document.getElementById("volume");
const minDelayEl = document.getElementById("minDelay");
const maxDelayEl = document.getElementById("maxDelay");
const modeEl = document.getElementById("mode");

let armed = false;          // interaction utilisateur autorisant l'audio
let currentTimer = null;    // timer entre deux sons
let audioPool = [];         // audios préchargés
let files = [];             // chemins depuis /sounds/sounds.json
let lastIndex = -1;         // anti-répétition immédiate en shuffle
let lastPlayAt = 0;         // anti-double tir sur transition
const INSTANT_ON = true;    // 🔥 joue immédiatement quand aucune scène

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  logEl.textContent = `[${ts}] ${msg}\n` + logEl.textContent;
  console.debug("[IdleSounds]", msg);
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

function getRandomInt(min, max) {
  const sMin = Math.max(0, Number(min) || 0);
  const sMax = Math.max(sMin, Number(max) || sMin);
  // valeur en ms (bornes inclusives)
  return (sMin * 1000) + Math.floor(Math.random() * ((sMax - sMin + 1) * 1000));
}

function pickNextIndex() {
  if (files.length === 0) return -1;
  if (modeEl.value === "random") {
    return Math.floor(Math.random() * files.length);
  }
  // shuffle (évite répétition immédiate)
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
  a.volume = Number(volumeEl.value);
  return a;
}

async function preloadAll() {
  audioPool = files.map(createAudio);
  audioPool.forEach(a => a.load());
  log(`Préchargement lancé (${audioPool.length})`);
}

function clearTimer() {
  if (currentTimer) {
    clearTimeout(currentTimer);
    currentTimer = null;
  }
}

function scheduleNext() {
  clearTimer();
  if (!armed) { log("En attente d’autorisation audio…"); return; }
  if (!files.length) { log("Aucun fichier audio listé."); return; }
  const delay = getRandomInt(minDelayEl.value, maxDelayEl.value);
  log(`Prochain son dans ~${Math.round(delay / 1000)}s`);
  currentTimer = setTimeout(playOne, delay);
}

async function playOne() {
  if (!armed || files.length === 0) return;

  const idx = pickNextIndex();
  if (idx < 0) return;

  const url = files[idx];

  // Essayons de retrouver un audio préchargé (compare par fin de src pour éviter les URLs absolues)
  let audio = audioPool.find(a => a.src.endsWith(url)) || createAudio(url);
  audio.volume = Number(volumeEl.value);

  try {
    await audio.play();
    lastPlayAt = Date.now();
    log(`Lecture: ${url}`);
    audio.onended = () => scheduleNext();
  } catch (err) {
    log("Lecture bloquée (autoplay ?). Clique sur “Activer l’audio”.");
    console.warn(err);
  }
}

function stopAll() {
  clearTimer();
  [...audioPool].forEach(a => { try { a.pause(); a.currentTime = 0; } catch {} });
}

// --- UI ---
btnArm.addEventListener("click", async () => {
  armed = true;
  btnArm.disabled = true;
  log("Autorisations audio acquises.");
  // petit ping silencieux pour lever l'autoplay si possible
  if (files.length) {
    try {
      const test = createAudio(files[0]);
      await test.play();
      test.pause();
      test.currentTime = 0;
    } catch {}
  }
});

btnPreload.addEventListener("click", preloadAll);
btnTest.addEventListener("click", playOne);
volumeEl.addEventListener("input", () => {
  const v = Number(volumeEl.value);
  audioPool.forEach(a => a.volume = v);
});

async function updateReadyUI(ready) {
  statusEl.textContent = ready ? "🎬 scène ouverte" : "🔇 aucune scène";
  statusEl.style.color = ready ? "#93c5fd" : "#a7f3d0";

  if (ready) {
    // scène ouverte => silence
    log("Scène détectée → arrêt des sons.");
    stopAll();
  } else {
    // aucune scène => on joue tout de suite puis on planifie
    log("Aucune scène détectée.");
    if (INSTANT_ON && armed && files.length) {
      // évite double tir si plusieurs événements "false" proches
      if (Date.now() - lastPlayAt > 500) {
        log("Instant-on: lecture immédiate.");
        clearTimer();
        // joue immédiatement (sans délai), puis onchain onended → scheduleNext()
        playOne();
        return; // on laisse onended enchaîner
      }
    }
    // sinon, planifie selon min/max
    log("Programmation selon le délai min/max.");
    scheduleNext();
  }
}

async function init() {
  await loadList();

  // Mode test hors Owlbear (ouvre l'appli dans un onglet normal)
  const inOBR = OBR.isAvailable;
  if (!inOBR) {
    log("⚠ Extension ouverte hors Owlbear (mode test).");
    updateReadyUI(false);
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
