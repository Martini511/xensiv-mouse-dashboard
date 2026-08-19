import { XensivMouseBluetooth } from "./bluetooth.js";
import { WheelCharts } from "./charts.js";
import { SENSOR_KEYS, SENSOR_LABELS } from "./protocol.js";

const bluetooth = new XensivMouseBluetooth();
const charts = new WheelCharts(byId("angle-chart"), byId("field-chart"));
const connectButton = byId("connect-button");
const resetButton = byId("reset-button");
const connectionLabel = byId("connection-label");
const batteryLabel = byId("battery-level");
const toast = byId("toast");

// Die Live-Ansicht fragt Tastendruck und Radwerte getrennt ab: Der
// Tastendruck lohnt eine hohe Rate, die Radwerte speisen zusätzlich
// die Diagramme und laufen deshalb mit einstellbarer Frequenz.
const PRESSURE_INTERVAL = 50;

let pressureTimer = null;
let wheelTimer = null;
let batteryTimer = null;
let requestPending = false;

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
  if (name === "live") charts.draw();
}

// ─── Verbindung ───────────────────────────────────────

connectButton.addEventListener("click", async () => {
  if (bluetooth.connected || bluetooth.reconnecting) {
    bluetooth.disconnect();
    return;
  }

  connectButton.disabled = true;
  setConnectionState("searching", "Maus auswählen");

  try {
    await bluetooth.connect();
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
    await bluetooth.reset();
  } catch (error) {
    setConnectionState("offline", "Nicht verbunden");
    showError(error);
  } finally {
    resetButton.disabled = false;
  }
});

bluetooth.addEventListener("connected", async ({ detail: device }) => {
  setDeviceControls(true);
  setConnectionState("online", device.name || "XENSIV Maus");
  setConnectButton("Trennen");
  resetButton.hidden = false;

  await updateBattery();
  window.clearInterval(batteryTimer);
  batteryTimer = window.setInterval(updateBattery, 30000);

  // Die eingestellten Schwellwerte bestimmen, ab wann eine Taste in
  // der Live-Ansicht aufleuchtet – deshalb gleich mitlesen.
  try {
    populateButtonConfig(await bluetooth.readButtonConfig());
  } catch {
    // Ältere Firmware ohne lesbare Konfiguration
  }

  notify("Maus verbunden");
});

bluetooth.addEventListener("disconnected", () => {
  stopPolling();
  window.clearInterval(batteryTimer);
  batteryTimer = null;
  setDeviceControls(false);
  setConnectionState("offline", "Nicht verbunden");
  setConnectButton("Maus verbinden");
  batteryLabel.textContent = "--";
  resetLiveReadouts();
});

bluetooth.addEventListener("reconnecting", () => {
  setConnectionState("waiting", "Warte auf die Maus");
  setConnectButton("Warten beenden");
  resetButton.hidden = false;
  notify(
    "Die Maus hat sich abgemeldet – vermutlich Ruhezustand. " +
    "Bewegen Sie die Maus; die Verbindung stellt sich selbst wieder her.");
});

bluetooth.addEventListener("notice", ({ detail }) => {
  notify(detail.message, Boolean(detail.error));
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") bluetooth.resume();
});

// Ohne ausdrückliche Freigabe bleibt die Verbindung nach einem Neuladen
// hängen und die Maus verweigert jeden neuen Aufbau.
window.addEventListener("pagehide", () => bluetooth.release());
window.addEventListener("beforeunload", () => bluetooth.release());

// ─── Live-Überwachung ─────────────────────────────────

byId("monitor-live").addEventListener("change", ({ target }) => {
  if (target.checked) startMonitoring();
  else stopPolling();
});

byId("sample-rate").addEventListener("change", () => {
  if (wheelTimer) startWheelTimer();
});

byId("clear-charts").addEventListener("click", () => charts.clear());

function startMonitoring() {
  window.clearInterval(pressureTimer);
  pressureTimer = window.setInterval(updatePressure, PRESSURE_INTERVAL);
  startWheelTimer();
}

function startWheelTimer() {
  window.clearInterval(wheelTimer);
  const frequency = Math.max(1, Math.min(100, Number(byId("sample-rate").value)));
  wheelTimer = window.setInterval(updateWheel, 1000 / frequency);
}

function stopPolling() {
  window.clearInterval(pressureTimer);
  window.clearInterval(wheelTimer);
  pressureTimer = null;
  wheelTimer = null;
  byId("monitor-live").checked = false;
}

async function updatePressure() {
  if (requestPending || !bluetooth.connected) return;
  requestPending = true;

  try {
    showPressure(await bluetooth.readButtonPressure());
  } catch (error) {
    stopPolling();
    showError(error);
  } finally {
    requestPending = false;
  }
}

async function updateWheel() {
  if (requestPending || !bluetooth.connected) return;
  requestPending = true;

  try {
    showWheel(await bluetooth.readWheelValues());
  } catch (error) {
    stopPolling();
    showError(error);
  } finally {
    requestPending = false;
  }
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
      </div>`;

    list.appendChild(item);
    pressBars.set(key, {
      item,
      value: item.querySelector('[data-role="value"]'),
      threshold: item.querySelector('[data-role="threshold"]'),
      fill: item.querySelector('[data-role="fill"]'),
      marker: item.querySelector('[data-role="marker"]'),
    });
  });
}

function showPressure(values) {
  let leftPressed = false;
  let rightPressed = false;

  SENSOR_KEYS.forEach((key) => {
    const bar = pressBars.get(key);
    const pressure = values[key];
    const threshold = thresholdOf(key);
    const enabled = byId(`${key}-enabled`).checked;
    const triggered = enabled && pressure > 0 && pressure >= threshold;

    bar.value.textContent = pressure;
    bar.threshold.textContent = threshold;
    bar.fill.style.width = `${(pressure / 127) * 100}%`;
    bar.marker.style.left = `${(threshold / 127) * 100}%`;
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

  pressBars.forEach((bar) => {
    bar.value.textContent = "--";
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
  () => bluetooth.setLed(255, 255, 255), "Bewegungslicht eingeschaltet"));

async function applyLed(hex) {
  const rgb = toRgb(hex);
  previewLed(hex);
  await run(() => bluetooth.setLed(...rgb), `LED auf ${hex.toUpperCase()} gesetzt`);
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
  () => bluetooth.setDpi(Number(target.value)),
  `Auflösung auf ${target.value} DPI gesetzt`));

// ─── Tastensensorik ───────────────────────────────────

byId("load-buttons").addEventListener("click", () => run(async () => {
  populateButtonConfig(await bluetooth.readButtonConfig());
}, "Tasteneinstellungen geladen"));

byId("save-buttons").addEventListener("click", () => run(
  () => bluetooth.writeButtonConfig(readButtonConfig()),
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
  populateCalibration(await bluetooth.readCalibration());
}, "Kalibrierung geladen"));

byId("save-calibration").addEventListener("click", () => run(
  () => bluetooth.writeCalibration(readCalibration()),
  "Kalibrierung gespeichert"));

byId("start-calibration").addEventListener("click", () => run(
  () => bluetooth.startCalibration(),
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
    const battery = await bluetooth.readBattery();
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
charts.draw();

if (!bluetooth.available) {
  connectButton.disabled = true;
  setConnectionState("offline", "Nicht unterstützt");
  notify(
    "Web Bluetooth steht nur in Chrome, Edge oder Opera zur Verfügung " +
    "und benötigt HTTPS oder localhost.", true);
} else {
  bluetooth.knownDevices().then(async (devices) => {
    if (devices.length === 0) return;

    resetButton.hidden = false;
    setConnectionState("searching", "Verbinde automatisch");

    try {
      await bluetooth.connectKnown();
    } catch {
      // Der erste Anlauf schlägt fehl, solange der Browser die alte
      // Verbindung noch abbaut oder die Maus schläft. Statt aufzugeben
      // wird geduldig weiterprobiert.
      bluetooth.startReconnect();
    }
  });
}
