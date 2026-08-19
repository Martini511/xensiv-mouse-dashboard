import { XensivMouseBluetooth } from "./bluetooth.js";
import { WheelCharts } from "./charts.js";
import { SENSOR_KEYS } from "./protocol.js";

const bluetooth = new XensivMouseBluetooth();
const charts = new WheelCharts(byId("angle-chart"), byId("field-chart"));
const connectButton = byId("connect-button");
const resetButton = byId("reset-button");
const connectionLabel = byId("connection-label");
const batteryLabel = byId("battery-level");
const toast = byId("toast");

let pressureTimer = null;
let wheelTimer = null;
let batteryTimer = null;
let requestPending = false;

// ─── Registerkarten ───────────────────────────────────

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

// Der Browser drosselt Zeitgeber in inaktiven Tabs stark.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") bluetooth.resume();
});

// Ohne ausdrückliche Freigabe bleibt die Verbindung nach einem Neuladen
// hängen und die Maus verweigert jeden neuen Aufbau.
window.addEventListener("pagehide", () => bluetooth.release());
window.addEventListener("beforeunload", () => bluetooth.release());

// ─── Erscheinungsbild ─────────────────────────────────

byId("led-color").addEventListener("input", ({ target }) => {
  previewLed(target.value);
});
byId("apply-led").addEventListener("click", () => applyLed(byId("led-color").value));

document.querySelectorAll("[data-color]").forEach((button) => {
  button.addEventListener("click", () => applyLed(button.dataset.color));
});

byId("motion-led").addEventListener("click", () => run(
  () => bluetooth.setLed(255, 255, 255), "Bewegungslicht eingeschaltet"));

byId("dpi").addEventListener("input", ({ target }) => {
  byId("dpi-value").textContent = target.value;
});
byId("dpi").addEventListener("change", ({ target }) => run(
  () => bluetooth.setDpi(Number(target.value)),
  `Auflösung auf ${target.value} DPI gesetzt`));

async function applyLed(hex) {
  const rgb = hex.match(/[a-f\d]{2}/gi).map((part) => Number.parseInt(part, 16));
  previewLed(hex);
  await run(() => bluetooth.setLed(...rgb), `LED auf ${hex.toUpperCase()} gesetzt`);
}

function previewLed(hex) {
  byId("led-color").value = hex;
  byId("led-swatch").style.background = hex;
  byId("led-value").textContent = hex.toUpperCase();
  document.documentElement.style.setProperty("--led-glow", hex);
}

// ─── Tastensensorik ───────────────────────────────────

byId("load-buttons").addEventListener("click", () => run(async () => {
  populateButtonConfig(await bluetooth.readButtonConfig());
}, "Tasteneinstellungen geladen"));

byId("save-buttons").addEventListener("click", () => run(
  () => bluetooth.writeButtonConfig(readButtonConfig()),
  "Tasteneinstellungen gespeichert"));

byId("monitor-buttons").addEventListener("change", ({ target }) => {
  window.clearInterval(pressureTimer);
  pressureTimer = target.checked ? window.setInterval(updatePressure, 50) : null;
});

function readButtonConfig() {
  return Object.fromEntries(SENSOR_KEYS.map((key) => [key, {
    enabled: byId(`${key}-enabled`).checked,
    threshold: Number(byId(`${key}-threshold`).value),
  }]));
}

function populateButtonConfig(config) {
  SENSOR_KEYS.forEach((key) => {
    byId(`${key}-enabled`).checked = config[key].enabled;
    byId(`${key}-threshold`).value = config[key].threshold;
    byId(`${key}-threshold-value`).textContent = config[key].threshold;
  });
}

async function updatePressure() {
  if (requestPending || !bluetooth.connected) return;
  requestPending = true;

  try {
    const values = await bluetooth.readButtonPressure();
    SENSOR_KEYS.forEach((key) => {
      byId(`${key}-pressure`).value = values[key];
      byId(`${key}-pressure-value`).textContent = values[key];
    });
  } catch (error) {
    stopPolling();
    showError(error);
  } finally {
    requestPending = false;
  }
}

// ─── Radkalibrierung ──────────────────────────────────

byId("stream-wheel").addEventListener("click", toggleWheelStream);
byId("clear-charts").addEventListener("click", () => charts.clear());
byId("sample-rate").addEventListener("change", () => {
  if (wheelTimer) restartWheelStream();
});

byId("load-calibration").addEventListener("click", () => run(async () => {
  populateCalibration(await bluetooth.readCalibration());
}, "Kalibrierung geladen"));

byId("save-calibration").addEventListener("click", () => run(
  () => bluetooth.writeCalibration(readCalibration()),
  "Kalibrierung gespeichert"));

byId("start-calibration").addEventListener("click", () => run(
  () => bluetooth.startCalibration(),
  "Kalibrierung gestartet. Bitte das Rad einmal vollständig drehen."));

function toggleWheelStream() {
  if (wheelTimer) {
    window.clearInterval(wheelTimer);
    wheelTimer = null;
    byId("stream-wheel").textContent = "Aufzeichnung starten";
  } else {
    restartWheelStream();
    byId("stream-wheel").textContent = "Aufzeichnung stoppen";
  }
}

function restartWheelStream() {
  window.clearInterval(wheelTimer);
  const frequency = Math.max(1, Math.min(100, Number(byId("sample-rate").value)));
  wheelTimer = window.setInterval(updateWheel, 1000 / frequency);
}

async function updateWheel() {
  if (requestPending || !bluetooth.connected) return;
  requestPending = true;

  try {
    const sample = await bluetooth.readWheelValues();
    charts.add(sample);
    byId("raw-angle").textContent = sample.rawAngle;
    byId("calibrated-angle").textContent = sample.calibratedAngle;
  } catch (error) {
    stopPolling();
    showError(error);
  } finally {
    requestPending = false;
  }
}

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

function stopPolling() {
  window.clearInterval(pressureTimer);
  window.clearInterval(wheelTimer);
  pressureTimer = null;
  wheelTimer = null;
  byId("monitor-buttons").checked = false;
  byId("stream-wheel").textContent = "Aufzeichnung starten";
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

setDeviceControls(false);
previewLed(byId("led-color").value);
charts.draw();

if (!bluetooth.available) {
  connectButton.disabled = true;
  setConnectionState("offline", "Nicht unterstützt");
  notify(
    "Web Bluetooth steht nur in Chrome, Edge oder Opera zur Verfügung " +
    "und benötigt HTTPS oder localhost.", true);
} else {
  // Bereits freigegebene Geräte ohne Auswahldialog aufnehmen.
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
