import { XensivMouseHid } from "./webhid.js";
import { XensivMouseBluetooth } from "./bluetooth.js";
import { WheelCharts } from "./charts.js";
import { SENSOR_KEYS, SENSOR_LABELS } from "./protocol.js";

// WebHID ist der bevorzugte Weg: Die Maus beantwortet dort jeden
// Befehl über einen einzigen Feature-Report, ohne Dienstsuche und
// ohne die Eigenheiten der BLE-Verbindung. Fehlt die Schnittstelle,
// übernimmt der GATT-Transport.
const useHid = typeof navigator.hid?.requestDevice === "function";
const mouse = useHid ? new XensivMouseHid() : new XensivMouseBluetooth();

const charts = new WheelCharts(byId("angle-chart"), byId("field-chart"));
const connectButton = byId("connect-button");
const resetButton = byId("reset-button");
const connectionLabel = byId("connection-label");
const batteryLabel = byId("battery-level");
const toast = byId("toast");

// Die Live-Ansicht fragt Tastendruck und Radwerte in einer einzigen
// Schleife ab. Zwei unabhängige Zeitgeber würden sich gegenseitig
// aushängen: Sowohl GATT als auch WebHID lassen nur eine Abfrage
// gleichzeitig zu, und die schnellere hätte die Sperre praktisch
// dauerhaft belegt.
const PRESSURE_INTERVAL = 50;

let monitoring = false;
let batteryTimer = null;

// Die Sensoren liefern deutlich kleinere Werte als die möglichen 127.
// Die Balken würden sonst kaum ausschlagen, deshalb wächst die Skala
// mit dem größten bisher gesehenen Wert mit.
const PRESS_SCALE_MIN = 24;
let pressScale = PRESS_SCALE_MIN;

const pressBars = new Map();

// ─── Reiter ───────────────────────────────────────────

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => selectTab(button.dataset.tab));
});

function selectTab(name) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === name);
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });

  // Die Zeichenfläche kennt ihre Größe erst, wenn sie sichtbar ist.
  if (name !== "live") {
    stopMonitoring();
    return;
  }

  charts.draw();
  startMonitoring();
}

function liveTabActive() {
  return !byId("live-panel").hidden;
}

// ─── Verbindung ───────────────────────────────────────

connectButton.addEventListener("click", async () => {
  if (mouse.connected || mouse.reconnecting) {
    mouse.disconnect();
    return;
  }

  connectButton.disabled = true;
  setConnectionState("searching", "Maus auswählen");

  try {
    await mouse.connect();
  } catch (error) {
    setConnectionState("offline", "Nicht verbunden");
    showError(error);
  } finally {
    connectButton.disabled = false;
  }
});

resetButton.addEventListener("click", async () => {
  resetButton.disabled = true;
  setConnectionState("searching", "Wird zurückgesetzt");

  try {
    await mouse.reset();
  } catch (error) {
    setConnectionState("offline", "Nicht verbunden");
    showError(error);
  } finally {
    resetButton.disabled = false;
  }
});

mouse.addEventListener("connected", async ({ detail: device }) => {
  setDeviceControls(true);
  setConnectionState("online", device.name || "XENSIV Maus");
  setConnectButton("Trennen");
  resetButton.hidden = false;

  await updateBattery();
  window.clearInterval(batteryTimer);
  batteryTimer = window.setInterval(updateBattery, 30000);

  // Die eingestellten Schwellwerte bestimmen, ab wann eine Taste in
  // der Live-Ansicht aufleuchtet. Scheitert das Lesen, blieben die
  // Vorgabewerte stehen und die Anzeige wäre irreführend – deshalb
  // wird der Fehler gemeldet statt verschluckt.
  try {
    populateButtonConfig(await mouse.readButtonConfig());
  } catch (error) {
    showError(new Error(
      `Tastenkonfiguration nicht lesbar: ${error.message}. ` +
      `Die angezeigten Schwellwerte stammen aus der Voreinstellung.`));
  }

  notify("Maus verbunden");
  if (liveTabActive()) startMonitoring();
});

mouse.addEventListener("disconnected", () => {
  stopMonitoring();
  window.clearInterval(batteryTimer);
  batteryTimer = null;
  setDeviceControls(false);
  setConnectionState("offline", "Nicht verbunden");
  setConnectButton("Maus verbinden");
  batteryLabel.textContent = "--";
  resetLiveReadouts();
});

mouse.addEventListener("reconnecting", () => {
  setConnectionState("waiting", "Warte auf die Maus");
  setConnectButton("Warten beenden");
  resetButton.hidden = false;
  notify(
    "Die Maus hat sich abgemeldet – vermutlich Ruhezustand. " +
    "Bewegen Sie die Maus; die Verbindung stellt sich selbst wieder her.");
});

mouse.addEventListener("notice", ({ detail }) => {
  notify(detail.message, Boolean(detail.error));
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") mouse.resume();
});

// Ohne ausdrückliche Freigabe bleibt der Kanal nach einem Neuladen
// belegt und die Maus verweigert jeden neuen Zugriff.
window.addEventListener("pagehide", () => mouse.release());
window.addEventListener("beforeunload", () => mouse.release());

// ─── Live-Überwachung ─────────────────────────────────
// Läuft, solange der Reiter offen und die Maus verbunden ist.

byId("clear-charts").addEventListener("click", () => charts.clear());

function startMonitoring() {
  if (monitoring || !mouse.connected) return;

  monitoring = true;
  setLiveState("is-running", "Live-Überwachung läuft");
  monitorLoop();
}

function stopMonitoring() {
  monitoring = false;
  setLiveState("", mouse.connected
    ? "Live-Überwachung angehalten"
    : "Nicht verbunden");
}

function wheelInterval() {
  const frequency = Math.max(1, Math.min(100, Number(byId("sample-rate").value)));
  return 1000 / frequency;
}

async function monitorLoop() {
  let nextWheel = 0;

  while (monitoring && mouse.connected) {
    try {
      showPressure(await mouse.readButtonPressure());

      // Die Radwerte speisen zusätzlich die Diagramme und laufen
      // deshalb mit eigener, einstellbarer Frequenz.
      const now = Date.now();
      if (now >= nextWheel) {
        showWheel(await mouse.readWheelValues());
        nextWheel = now + wheelInterval();
      }
    } catch (error) {
      stopMonitoring();
      showError(error);
      return;
    }

    await delay(PRESSURE_INTERVAL);
  }

  stopMonitoring();
}

function setLiveState(modifier, label) {
  const element = byId("live-state");
  element.className = `live-state ${modifier}`.trim();
  element.lastChild.textContent = label;
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

// ─── Anzeige der Messwerte ────────────────────────────

function buildPressBars() {
  const list = byId("press-list");

  SENSOR_KEYS.forEach((key) => {
    const item = document.createElement("div");
    item.className = "press-item";

    item.innerHTML = `
      <div class="press-head">
        <span class="press-name"><i class="press-dot"></i>${SENSOR_LABELS[key]}</span>
        <span class="press-values">Druck <b data-role="value">--</b> · Schwelle <b data-role="threshold">--</b></span>
      </div>
      <div class="press-track">
        <div class="press-fill" data-role="fill"></div>
        <div class="press-marker" data-role="marker"></div>
      </div>
      <div class="press-scale"><span>0</span><span data-role="scale">${PRESS_SCALE_MIN}</span></div>`;

    list.appendChild(item);
    pressBars.set(key, {
      item,
      value: item.querySelector('[data-role="value"]'),
      threshold: item.querySelector('[data-role="threshold"]'),
      fill: item.querySelector('[data-role="fill"]'),
      marker: item.querySelector('[data-role="marker"]'),
      scale: item.querySelector('[data-role="scale"]'),
    });
  });
}

function showPressure(values) {
  let leftPressed = false;
  let rightPressed = false;

  // Skala zuerst nachziehen, sonst bezögen sich die Balken eines
  // Durchlaufs auf zwei verschiedene Bezugsgrößen.
  pressScale = Math.max(pressScale, ...SENSOR_KEYS.map((key) => values[key]));

  SENSOR_KEYS.forEach((key) => {
    const bar = pressBars.get(key);
    const pressure = values[key];
    const threshold = thresholdOf(key);
    const enabled = byId(`${key}-enabled`).checked;
    const triggered = enabled && pressure > 0 && pressure >= threshold;

    bar.value.textContent = pressure;
    bar.threshold.textContent = threshold;
    bar.scale.textContent = pressScale;
    bar.fill.style.width = `${percentOfScale(pressure)}%`;
    bar.marker.style.left = `${percentOfScale(threshold)}%`;
    bar.item.classList.toggle("is-triggered", triggered);
    bar.item.classList.toggle("is-off", !enabled);

    if (!triggered) return;
    if (key.startsWith("left")) leftPressed = true;
    else rightPressed = true;
  });

  byId("mouse-btn-left").classList.toggle("is-pressed", leftPressed);
  byId("mouse-btn-right").classList.toggle("is-pressed", rightPressed);

  const left = Math.max(values.leftForce, values.leftHall);
  const right = Math.max(values.rightForce, values.rightHall);
  byId("stage-press").textContent = `${left} / ${right}`;
}

function percentOfScale(value) {
  return Math.min(100, (value / pressScale) * 100);
}

function showWheel(sample) {
  charts.add(sample);

  byId("raw-angle").textContent = sample.rawAngle;
  byId("calibrated-angle").textContent = sample.calibratedAngle;
  byId("field-cal").textContent = `${sample.calibratedX} / ${sample.calibratedZ}`;
  byId("field-raw").textContent = `${sample.rawX} / ${sample.rawZ}`;

  byId("stage-wheel").textContent = `${sample.calibratedAngle}°`;
  byId("mouse-wheel-group").setAttribute(
    "transform", `rotate(${sample.calibratedAngle} 120 73)`);
}

function resetLiveReadouts() {
  ["raw-angle", "calibrated-angle"].forEach((id) => {
    byId(id).textContent = "--";
  });
  ["field-cal", "field-raw"].forEach((id) => {
    byId(id).textContent = "-- / --";
  });

  byId("stage-wheel").textContent = "–";
  byId("stage-press").textContent = "– / –";

  // Die Skala gehört zur Messreihe und beginnt mit ihr von vorn.
  pressScale = PRESS_SCALE_MIN;

  pressBars.forEach((bar) => {
    bar.value.textContent = "--";
    bar.scale.textContent = pressScale;
    bar.fill.style.width = "0%";
    bar.item.classList.remove("is-triggered");
  });

  byId("mouse-btn-left").classList.remove("is-pressed");
  byId("mouse-btn-right").classList.remove("is-pressed");
}

function thresholdOf(key) {
  return Number(byId(`${key}-threshold`).value);
}

// ─── Beleuchtung ──────────────────────────────────────

byId("led-color").addEventListener("input", ({ target }) => previewLed(target.value));
byId("apply-led").addEventListener("click", () => applyLed(byId("led-color").value));

document.querySelectorAll("[data-color]").forEach((button) => {
  button.addEventListener("click", () => applyLed(button.dataset.color));
});

byId("motion-led").addEventListener("click", () => run(
  () => mouse.setLed(255, 255, 255), "Bewegungslicht eingeschaltet"));

async function applyLed(hex) {
  const rgb = toRgb(hex);
  previewLed(hex);
  await run(() => mouse.setLed(...rgb), `LED auf ${hex.toUpperCase()} gesetzt`);
}

function previewLed(hex) {
  const [red, green, blue] = toRgb(hex);
  const off = red === 0 && green === 0 && blue === 0;

  byId("led-color").value = hex;
  byId("led-swatch").style.background = hex;
  byId("led-value").textContent = hex.toUpperCase();

  document.documentElement.style.setProperty("--led-glow", hex);
  byId("stage-led").lastChild.textContent = hex.toUpperCase();

  // Das Modell zeigt die Farbe unmittelbar: erloschene LED bleibt grau.
  byId("mouse-led").style.fill = off ? "" : hex;
  byId("mouse-glow").style.fill = off ? "transparent" : hex;
  byId("mouse-glow").style.opacity = off ? "0" : ".55";
}

function toRgb(hex) {
  return hex.match(/[a-f\d]{2}/gi).map((part) => Number.parseInt(part, 16));
}

// ─── Zeigerauflösung ──────────────────────────────────

byId("dpi").addEventListener("input", ({ target }) => {
  byId("dpi-value").textContent = target.value;
});

byId("dpi").addEventListener("change", ({ target }) => run(
  () => mouse.setDpi(Number(target.value)),
  `Auflösung auf ${target.value} DPI gesetzt`));

// ─── Tastensensorik ───────────────────────────────────

byId("load-buttons").addEventListener("click", () => run(async () => {
  populateButtonConfig(await mouse.readButtonConfig());
}, "Tasteneinstellungen geladen"));

byId("save-buttons").addEventListener("click", () => run(
  () => mouse.writeButtonConfig(readButtonConfig()),
  "Tasteneinstellungen gespeichert"));

function readButtonConfig() {
  return Object.fromEntries(SENSOR_KEYS.map((key) => [key, {
    enabled: byId(`${key}-enabled`).checked,
    threshold: thresholdOf(key),
  }]));
}

function populateButtonConfig(config) {
  SENSOR_KEYS.forEach((key) => {
    byId(`${key}-enabled`).checked = config[key].enabled;
    byId(`${key}-threshold`).value = config[key].threshold;
    byId(`${key}-threshold-value`).textContent = config[key].threshold;
    pressBars.get(key).threshold.textContent = config[key].threshold;
  });
}

// ─── Radkalibrierung ──────────────────────────────────

byId("load-calibration").addEventListener("click", () => run(async () => {
  populateCalibration(await mouse.readCalibration());
}, "Kalibrierung geladen"));

byId("save-calibration").addEventListener("click", () => run(
  () => mouse.writeCalibration(readCalibration()),
  "Kalibrierung gespeichert"));

byId("start-calibration").addEventListener("click", () => run(
  () => mouse.startCalibration(),
  "Kalibrierung gestartet. Bitte das Rad einmal vollständig drehen."));

function readCalibration() {
  return {
    offsetX: numberValue("offset-x"),
    offsetZ: numberValue("offset-z"),
    amplitudeX: numberValue("amplitude-x"),
    amplitudeZ: numberValue("amplitude-z"),
    ellipseAngle: numberValue("ellipse-angle"),
    pressTrigger: numberValue("press-trigger"),
  };
}

function populateCalibration(calibration) {
  Object.entries({
    "offset-x": calibration.offsetX,
    "offset-z": calibration.offsetZ,
    "amplitude-x": calibration.amplitudeX,
    "amplitude-z": calibration.amplitudeZ,
    "ellipse-angle": calibration.ellipseAngle,
    "press-trigger": calibration.pressTrigger,
  }).forEach(([id, value]) => { byId(id).value = value; });
}

// ─── Hilfsmittel ──────────────────────────────────────

async function run(operation, successMessage) {
  try {
    await operation();
    if (successMessage) notify(successMessage);
  } catch (error) {
    showError(error);
  }
}

async function updateBattery() {
  try {
    const battery = await mouse.readBattery();
    batteryLabel.textContent = battery === null ? "--" : `${battery} %`;
  } catch {
    batteryLabel.textContent = "--";
  }
}

function setDeviceControls(enabled) {
  document.querySelectorAll("[data-device-control]").forEach((element) => {
    element.disabled = !enabled;
  });
}

function setConnectionState(state, label) {
  connectionLabel.dataset.state = state;
  connectionLabel.querySelector("span:last-child").textContent = label;
}

function setConnectButton(label) {
  connectButton.querySelector("span").textContent = label;
}

function notify(message, error = false) {
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("visible");
  window.clearTimeout(notify.timeout);
  notify.timeout = window.setTimeout(() => toast.classList.remove("visible"), 4500);
}

function showError(error) {
  console.error(error);
  notify(error?.message || String(error), true);
}

function numberValue(id) {
  return Number(byId(id).value);
}

function byId(id) {
  return document.getElementById(id);
}

// ─── Start ────────────────────────────────────────────

buildPressBars();
setDeviceControls(false);
previewLed(byId("led-color").value);
resetLiveReadouts();
stopMonitoring();
charts.draw();

byId("stage-transport").textContent = useHid ? "WEBHID · REPORT 0x10" : "BLE / GATT";

if (!mouse.available) {
  connectButton.disabled = true;
  setConnectionState("offline", "Nicht unterstützt");
  notify(
    "Weder WebHID noch Web Bluetooth stehen zur Verfügung. Bitte ein " +
    "aktuelles Chrome, Edge oder Opera über HTTPS oder localhost nutzen.",
    true);
} else {
  mouse.knownDevices().then(async (devices) => {
    if (devices.length === 0) return;

    resetButton.hidden = false;
    setConnectionState("searching", "Verbinde automatisch");

    try {
      await mouse.connectKnown();
    } catch {
      // Der erste Anlauf schlägt fehl, solange der Browser den alten
      // Zugriff noch abbaut oder die Maus schläft. Statt aufzugeben
      // wird geduldig weiterprobiert.
      mouse.startReconnect();
    }
  });
}
