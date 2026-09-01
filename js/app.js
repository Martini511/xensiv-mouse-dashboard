import { XensivMouseHid } from "./webhid.js";
import { XensivMouseBluetooth } from "./bluetooth.js";
import { WheelCharts } from "./charts.js";
import { MouseModel } from "./model3d.js";
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
//
// Wichtiger noch: Die Maus meldet ihre Tastenklicks über dieselbe
// Funkstrecke, über die wir sie abfragen. Wer sie ununterbrochen
// befragt, verdrängt die Eingabemeldungen – die Tasten wirken dann
// systemweit tot. Deshalb bleibt der Kanal zur Hälfte frei.
const PRESSURE_INTERVAL = 100;
const DUTY_LIMIT = 0.5;
const MIN_IDLE = 5;

let monitoring = false;
let batteryTimer = null;

// Die Sensoren liefern deutlich kleinere Werte als die möglichen 127.
// Die Balken würden sonst kaum ausschlagen, deshalb wächst die Skala
// mit dem größten bisher gesehenen Wert mit.
const PRESS_SCALE_MIN = 24;
let pressScale = PRESS_SCALE_MIN;

// Höchster je Sensor beobachteter Druck. Dient als Plausibilitätsprobe
// vor dem Schreiben: Eine Schwelle oberhalb davon macht die Taste
// unbrauchbar – auch außerhalb dieser Seite.
const observedMax = new Map();

// Ob die angezeigte Tastenkonfiguration tatsächlich vom Gerät stammt.
let configFromDevice = false;

// Was zuletzt in die Maus geschrieben wurde. Die Firmware gibt die Freigabe
// beim Lesen nicht zurück - nur die Schwellwerte. Diese Notiz ist dann die
// einzige Auskunft darüber, welcher Sensor im Gerät misst, und tritt beim
// Laden an die Stelle der fehlenden Antwort.
//
// Sie überdauert deshalb Trennung und Neuladen der Seite. Als reine
// Sitzungsnotiz wäre sie fast nie da, wenn man sie braucht: Beim Verbinden
// steht sie noch auf nichts, und „Laden“ zeigte bis zum ersten Schreiben
// immer nur die Annahme, es messe die Force-Sensorik. Genau das war das
// Verhalten, das aussah, als funktioniere das Laden erst danach.
const WRITTEN_STORE = "xensiv.tastenkonfiguration.geschrieben";
let writtenConfig = recallWritten();

function recallWritten() {
  try {
    const saved = JSON.parse(localStorage.getItem(WRITTEN_STORE));
    // Was aus der Ablage kommt, hat niemand geprüft: eine ältere Fassung der
    // Seite kann es geschrieben haben, ein anderer Reiter, eine fremde Hand.
    return SENSOR_KEYS.every((key) => typeof saved?.[key]?.enabled === "boolean")
      ? saved
      : null;
  } catch {
    // Kein Speicher, kein Eintrag, kein gueltiges JSON - alles derselbe Fall.
    return null;
  }
}

function rememberWritten(config) {
  writtenConfig = config;
  try {
    localStorage.setItem(WRITTEN_STORE, JSON.stringify(config));
  } catch {
    // Ohne Ablage gilt die Notiz eben nur für diese Sitzung.
  }
}

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

  // Ohne die Druckschwelle aus der Kalibrierung lässt sich ein
  // Radklick nicht erkennen.
  try {
    populateCalibration(await mouse.readCalibration());
  } catch {
    // Ohne Kalibrierung bleibt das Rad in der Anzeige einfach ruhig
  }

  notify("Maus verbunden");
  previewLed(byId("led-color").value);
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

  // Die Beobachtungen gelten nur für die abgelaufene Sitzung. Was in die
  // Maus geschrieben wurde, steht dort weiter - die Notiz darüber bleibt.
  observedMax.clear();
  configFromDevice = false;
  wheelPressTrigger = 0;

  previewLed(byId("led-color").value);
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
  if (document.visibilityState === "visible") {
    mouse.resume();
    if (liveTabActive()) startMonitoring();
    return;
  }

  // Im Hintergrund gibt es nichts anzuzeigen. Weiterzufragen würde
  // nur die Funkstrecke belegen und die Tasten der Maus ausbremsen,
  // während in einem anderen Fenster gearbeitet wird.
  stopMonitoring();
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
  wheelTicks.length = 0;
  byId("wheel-actual").textContent = "–";
  setLiveState("", mouse.connected
    ? "Live-Überwachung angehalten"
    : "Nicht verbunden");
}

// Wie viele Radwerte je Sekunde tatsächlich ankommen. Gefragt wird so
// oft, wie der Lastdeckel zulässt – was davon herauskommt, hängt an der
// Antwortzeit der Maus und liegt in der Praxis bei etwa fünf Werten.
const wheelTicks = [];

function trackWheelRate() {
  const now = Date.now();
  wheelTicks.push(now);

  while (wheelTicks.length > 0 && wheelTicks[0] <= now - 1000) {
    wheelTicks.shift();
  }

  byId("wheel-actual").textContent = wheelTicks.length;
}

async function monitorLoop() {
  let nextPressure = 0;

  while (monitoring && mouse.connected) {
    const startedAt = Date.now();

    try {
      // Die Radwerte speisen die Diagramme und werden bei jedem Durchlauf
      // geholt. Schneller als die Funkstrecke geht ohnehin nicht, und der
      // Lastdeckel weiter unten hält den Kanal frei. Der Tastendruck folgt
      // danach mit seiner eigenen, festen Frist.
      showWheel(await mouse.readWheelValues());

      if (Date.now() >= nextPressure) {
        showPressure(await mouse.readButtonPressure());
        nextPressure = Date.now() + PRESSURE_INTERVAL;
      }
    } catch (error) {
      stopMonitoring();
      showError(error);
      return;
    }

    // Pause im Verhältnis zur belegten Zeit: Antwortet die Maus
    // träge, weil die Verbindung ausgelastet ist, wird von selbst
    // langsamer abgefragt statt weiter nachzudrücken.
    const busy = Date.now() - startedAt;
    await delay(Math.max(busy * (1 / DUTY_LIMIT - 1), MIN_IDLE));
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

// ─── Gerätemodell ─────────────────────────────────────

// Das CAD-Modell ist eine Zugabe. Fällt es aus – kein WebGL, Datei nicht
// erreichbar –, bleibt die SVG-Zeichnung stehen und zeigt dieselben
// Zustände. Deshalb steht überall `model?.` und nirgends eine Prüfung.
// Das Modell teilt die Fassungsnummer dieser Datei. Es ist keine Modulkennung
// und läuft deshalb nicht über die Importmap – ohne Nummer bliebe nach einer
// Veröffentlichung die alte Datei im Zwischenspeicher liegen.
const MODEL_FILE = "./assets/models/xensiv_mouse.glb"
  + new URL(import.meta.url).search;
let model = null;
let configModel = null;

async function loadMouseModel() {
  const canvas = byId("mouse-canvas");
  try {
    const loaded = await new MouseModel(canvas).load(MODEL_FILE);
    canvas.hidden = false;
    canvas.closest(".mouse-stage").classList.add("has-model");
    model = loaded;

    // Was vor dem Laden schon eingestellt war, holt das Modell nach.
    previewLed(byId("led-color").value);
  } catch (error) {
    console.warn("Gerätemodell nicht verfügbar:", error);
  }
}

// Die Konfigurationsseite zeigt dasselbe Gerät noch einmal, aber anders: Sie
// blendet Teile aus und dreht das Rad, während die Live-Ansicht unberührt
// bleibt. Beide Flächen gleichzeitig aus einem Modell zu bedienen ginge nur
// über einen gemeinsamen Zeichenpuffer - zwei eigene sind einfacher.
async function loadConfigModel() {
  try {
    configModel = await new MouseModel(byId("config-canvas")).load(MODEL_FILE);
    applyConfigView();
    showActiveSensors();
    previewLed(byId("led-color").value);
  } catch (error) {
    console.warn("Modell der Konfiguration nicht verfügbar:", error);
  }
}

// ─── Konfiguration: das Modell folgt dem Reiter ───────

const CONFIG_CAPTIONS = {
  light: "Gesamtes Gerät",
  sensors: "Gehäuse ausgeblendet · Sensoren",
  wheel: "Gehäuse ausgeblendet · Rad",
};

const configPanels = [
  ...document.querySelectorAll("[data-panel=config] .accordion"),
];

// Den Wechsel zwischen den Reitern besorgt der Browser selbst; hier wird nur
// nachgesehen, welcher offen ist. Zugeklappt sind auch alle ein gültiger
// Zustand - dann zeigt das Modell wieder das ganze Gerät.
configPanels.forEach((panel) => {
  panel.addEventListener("toggle", applyConfigView);
});

function applyConfigView() {
  const panel = configPanels.find((entry) => entry.open);
  const view = panel?.dataset.view || "light";

  configModel?.setView(view);
  byId("config-view").textContent =
    panel ? panelTitle(panel).toUpperCase() : "ÜBERSICHT";
  byId("config-caption").textContent = CONFIG_CAPTIONS[view];
}

function panelTitle(panel) {
  return panel.querySelector(".accordion-title").firstChild.textContent.trim();
}

// ─── Anzeige der Messwerte ────────────────────────────

function buildPressBars() {
  const list = byId("press-list");

  SHOWN_SENSORS.forEach((key) => {
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

// Der 2D-TMR-Sensor ist noch in Vorbereitung und hat auf der Seite weder
// Zeile noch Balken. Im Protokoll bleibt sein Platz aber bestehen – die Maus
// erwartet fünf Bytes. Überall dort, wo Bedienelemente im Spiel sind, gilt
// deshalb diese Liste, nicht SENSOR_KEYS.
const SHOWN_SENSORS = SENSOR_KEYS.filter((key) => key !== "leftTmr2d");

// Je Taste misst genau ein Sensor. Welcher das ist, entscheidet allein die
// Freigabe in der Konfiguration – und die stammt aus dem Gerät. Die
// Live-Ansicht wählt hier nichts aus, sie liest die Einstellung nur ab.
// Die Reihenfolge folgt dem Desktop-Werkzeug: Force hat Vorrang, Hall gilt
// nur, wenn es allein freigegeben ist.
function activeSensor(side) {
  const hall = byId(`${side}Hall-enabled`).checked;
  const force = byId(`${side}Force-enabled`).checked;
  return hall && !force ? `${side}Hall` : `${side}Force`;
}

// Der stillgelegte Sensor misst weiter, seine Werte lösen aber keine Taste
// mehr aus. Sein Balken tritt deshalb zurück, statt zu verschwinden: Beim
// Einstellen der Schwellen ist der Vergleich beider Familien nützlich.
function showActiveSensors() {
  const active = [activeSensor("left"), activeSensor("right")];

  pressBars.forEach((bar, key) => {
    bar.item.classList.toggle("is-off", !active.includes(key));
  });

  // Am Modell tritt je Taste der Sensor hervor, der auch misst – der
  // Hall-Sensor oben am freien Ende des Stegs, der Force-Sensor unten an
  // seiner Einspannung. Ist auf einer Seite keiner freigegeben, bleibt sie
  // dunkel.
  configModel?.setSensors({
    left: sensorFamily(active[0]),
    right: sensorFamily(active[1]),
  });
}

// Aus "leftHall" wird "hall": Das Modell kennt die Familie, die Seite sagt
// ihm die Lage des Bauteils. Ein abgeschalteter Sensor zählt als keiner.
function sensorFamily(key) {
  if (!byId(`${key}-enabled`).checked) return null;
  return familyOf(key);
}

function familyOf(key) {
  return key.endsWith("Hall") ? "hall" : "force";
}

function sideOf(key) {
  return key.startsWith("left") ? "left" : "right";
}

// Zeigt der Betrachter auf eine Sensorzeile, holt das Modell diesen Sensor
// heran und nennt seine Typenbezeichnung.
const SENSOR_NAMES = {
  hall: "TLI49901 / TLI55910",
  force: "TLI49012",
};

SHOWN_SENSORS.forEach((key) => {
  const row = byId(`${key}-enabled`).closest(".sensor-row");
  if (!row) return;

  row.addEventListener("pointerenter", () => {
    configModel?.focusSensor(familyOf(key), sideOf(key), SENSOR_NAMES[familyOf(key)]);
  });
  row.addEventListener("pointerleave", () => configModel?.clearFocus());
});

SHOWN_SENSORS.forEach((key) => {
  byId(`${key}-enabled`).addEventListener("change", () => {
    keepSingleSensor(key);
    showActiveSensors();
  });
});

// Je Taste misst nur ein Sensor – gemischt geht nicht. Eine Freigabe hebt
// deshalb die bisherige derselben Seite auf, statt sich danebenzustellen.
// Die letzte abzuwählen bleibt erlaubt: Das Gerät kennt diesen Zustand,
// auch wenn die Taste dann nicht mehr auslöst. Davor warnt das Schreiben.
function keepSingleSensor(key) {
  if (!byId(`${key}-enabled`).checked) return;

  const side = key.startsWith("left") ? "left" : "right";

  SHOWN_SENSORS.forEach((other) => {
    if (other === key || !other.startsWith(side)) return;
    byId(`${other}-enabled`).checked = false;
  });
}

function showPressure(values) {
  // Skala zuerst nachziehen, sonst bezögen sich die Balken eines
  // Durchlaufs auf zwei verschiedene Bezugsgrößen.
  pressScale = Math.max(pressScale, ...SHOWN_SENSORS.map((key) => values[key]));

  const active = {
    left: activeSensor("left"),
    right: activeSensor("right"),
  };

  SHOWN_SENSORS.forEach((key) => {
    const bar = pressBars.get(key);
    const pressure = values[key];
    const threshold = thresholdOf(key);

    observedMax.set(key, Math.max(observedMax.get(key) || 0, pressure));

    bar.value.textContent = pressure;
    bar.threshold.textContent = threshold;
    bar.scale.textContent = pressScale;
    bar.fill.style.width = `${percentOfScale(pressure)}%`;
    bar.marker.style.left = `${percentOfScale(threshold)}%`;
    bar.item.classList.toggle("is-triggered", isPressed(values, key));
  });

  Object.entries(active).forEach(([side, key]) => {
    const pressed = isPressed(values, key);
    byId(`mouse-btn-${side}`).classList.toggle("is-pressed", pressed);
    model?.setButton(side, pressed);
  });

  byId("stage-press").textContent =
    `${values[active.left]} / ${values[active.right]}`;
}

function isPressed(values, key) {
  return values[key] > 0 && values[key] >= thresholdOf(key);
}

function percentOfScale(value) {
  return Math.min(100, (value / pressScale) * 100);
}

function showWheel(sample) {
  charts.add(sample);
  trackWheelRate();

  byId("raw-angle").textContent = sample.rawAngle;
  byId("calibrated-angle").textContent = sample.calibratedAngle;
  byId("field-cal").textContent = `${sample.calibratedX} / ${sample.calibratedZ}`;
  byId("field-raw").textContent = `${sample.rawX} / ${sample.rawZ}`;

  showWheelPress(sample);

  byId("stage-wheel").textContent = `${sample.calibratedAngle}°`;

  // Nur einmal abrufen: Die Funktion zählt die Umdrehungen mit.
  const angle = continuousAngle(sample.calibratedAngle);
  byId("mouse-wheel-group").style.transform = `rotate(${angle}deg)`;
  model?.setWheelAngle(angle);
}

// Einen Radklick meldet die Maus nicht als eigenen Messwert, und das
// Desktop-Werkzeug ermittelt ihn nirgends – es schreibt die Schwelle
// nur ins Gerät. Die Regel der Firmware verrät aber der Name des
// Felds, `max_length_calib`: die größte Länge des kalibrierten
// Vektors während des Kalibrierlaufs.
//
// Die Kalibrierung bildet die Messellipse auf einen Kreis ab. Beim
// bloßen Drehen bleibt der Radius deshalb unter dieser Marke; ein
// Druck rückt den Magneten aus der Ebene und treibt ihn darüber:
//
//     √(x_kal² + z_kal²)  >  max_length_calib
//
// Beide Größen müssen dafür auf dieselbe Skala. Die Maximallänge wird
// wie im Desktop-Werkzeug tausendfach vergrößert geführt, die
// kalibrierten Feldwerte kommen jedoch eine Zehnerstelle kleiner über
// die Leitung – daher der zusätzliche Faktor auf dem Radius.
const WHEEL_RADIUS_SCALE = 10;

let wheelPressTrigger = 0;
let wheelRadiusMin = Infinity;
let wheelSamples = 0;
let wheelHintShown = false;

function showWheelPress(sample) {
  const radius =
    Math.hypot(sample.calibratedX, sample.calibratedZ) * WHEEL_RADIUS_SCALE;

  byId("wheel-press").textContent = wheelPressTrigger > 0
    ? `${Math.round(radius)} / ${Math.round(wheelPressTrigger)}`
    : `${Math.round(radius)} / --`;

  const pressed = wheelPressTrigger > 0 && radius > wheelPressTrigger;
  byId("mouse-wheel").classList.toggle("is-pressed", pressed);
  model?.setWheelPressed(pressed);

  checkWheelTrigger(radius);
}

// Liegt selbst der kleinste beobachtete Radius über der gespeicherten
// Maximallänge, stammt diese aus einem alten oder nie gelaufenen
// Kalibrierlauf. Der Vergleich meldet dann dauerhaft einen Klick –
// darauf einmalig hinweisen statt es stumm hinzunehmen.
function checkWheelTrigger(radius) {
  wheelSamples += 1;
  wheelRadiusMin = Math.min(wheelRadiusMin, radius);

  if (wheelHintShown || wheelSamples < 60) return;
  if (wheelPressTrigger <= 0 || wheelRadiusMin <= wheelPressTrigger) return;

  wheelHintShown = true;
  notify(
    `Die gespeicherte Maximallänge (${Math.round(wheelPressTrigger)}) liegt ` +
    `unter dem Ruheradius des Rads (${Math.round(wheelRadiusMin)}). Ein ` +
    `Radklick lässt sich damit nicht unterscheiden – bitte die ` +
    `360°-Kalibrierung ausführen.`, true);
}

// Der gemeldete Winkel springt bei jeder vollen Umdrehung von 359 auf
// 0 zurück. Direkt übernommen würde die Markierung an dieser Stelle
// rückwärts durchlaufen. Deshalb wird nur die Winkeländerung addiert,
// jeweils auf dem kürzeren der beiden Wege.
let turnedAngle = 0;
let previousAngle = null;

function continuousAngle(angle) {
  if (previousAngle === null) {
    previousAngle = angle;
    turnedAngle = angle;
    return turnedAngle;
  }

  let step = (angle - previousAngle) % 360;
  if (step > 180) step -= 360;
  else if (step < -180) step += 360;

  previousAngle = angle;
  turnedAngle += step;
  return turnedAngle;
}

function resetLiveReadouts() {
  ["raw-angle", "calibrated-angle"].forEach((id) => {
    byId(id).textContent = "--";
  });
  ["field-cal", "field-raw", "wheel-press"].forEach((id) => {
    byId(id).textContent = "-- / --";
  });

  byId("stage-wheel").textContent = "–";
  byId("stage-press").textContent = "– / –";

  byId("mouse-wheel").classList.remove("is-pressed");
  byId("mouse-wheel-group").style.transform = "";
  wheelRadiusMin = Infinity;
  wheelSamples = 0;
  wheelHintShown = false;
  previousAngle = null;
  turnedAngle = 0;

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
  model?.reset();
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

  // Am Modell leuchtet die LED erst, wenn eine Maus antwortet. Ohne
  // Verbindung ist die gewählte Farbe nur ein Vorschlag – ein leuchtendes
  // Gerät würde vortäuschen, dass sie schon angekommen ist.
  model?.setLed(hex, off || !mouse.connected);

  // Auf der Konfigurationsseite gilt das nicht: Dort steht die Farbwahl
  // daneben, das Modell ist ihre Vorschau.
  configModel?.setLed(hex, off);
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

byId("save-buttons").addEventListener("click", () => {
  const config = readButtonConfig();
  if (!confirmButtonConfig(config)) return;

  run(async () => {
    await mouse.writeButtonConfig(config);
    // Ab jetzt steht das im Gerät. Beim Lesen erfährt man es nicht wieder,
    // deshalb diese Notiz - sie ist die einzige Auskunft darüber, welcher
    // Sensor dort tatsächlich misst.
    rememberWritten(config);
  }, "Tasteneinstellungen gespeichert");
});

// Eine zu hohe Schwelle oder ein abgeschalteter Sensor macht die Taste
// am ganzen Rechner unbrauchbar – auch nach dem Schließen dieser
// Seite. Deshalb hier nachfragen statt blind schreiben.
function confirmButtonConfig(config) {
  const problems = checkButtonConfig(config);
  if (problems.length === 0) return true;

  return window.confirm(
    "Diese Einstellung kann die Maustasten unbrauchbar machen:\n\n" +
    problems.map((problem) => `• ${problem}`).join("\n") +
    "\n\nTrotzdem in die Maus schreiben?");
}

const SIDE_LABELS = { left: "Linke Taste", right: "Rechte Taste" };

function checkButtonConfig(config) {
  const problems = [];

  Object.entries(SIDE_LABELS).forEach(([side, label]) => {
    const key = activeSensor(side);
    if (!config[key].enabled) {
      problems.push(`${label}: kein Sensor aktiv – die Taste löst nicht mehr aus`);
    }
  });

  SENSOR_KEYS.forEach((key) => {
    const seen = observedMax.get(key) || 0;
    if (!config[key].enabled || seen === 0) return;

    if (config[key].threshold > seen) {
      problems.push(
        `${SENSOR_LABELS[key]}: Schwelle ${config[key].threshold} liegt über ` +
        `dem höchsten gemessenen Druck ${seen}`);
    }
  });

  if (!configFromDevice) {
    problems.push(
      "Die Werte wurden nie vom Gerät gelesen – es sind Voreinstellungen " +
      "dieser Seite, nicht die der Maus");
  }

  return problems;
}

// Was die Maus zuletzt geantwortet hat. Gebraucht wird davon nur, was die
// Seite nicht anzeigt: Beim Schreiben soll der Platz des TMR-Sensors
// unverändert zurückgehen, statt genullt zu werden.
let lastRead = null;

function readButtonConfig() {
  return Object.fromEntries(SENSOR_KEYS.map((key) => [key, shownAsRow(key)
    ? { enabled: byId(`${key}-enabled`).checked, threshold: thresholdOf(key) }
    : lastRead?.[key] || { enabled: false, threshold: 0 }]));
}

function shownAsRow(key) {
  return SHOWN_SENSORS.includes(key);
}

function populateButtonConfig(config) {
  configFromDevice = true;
  lastRead = config;

  // Die Antwort im Klartext daneben: Ein Byte je Sensor, oberstes Bit für die
  // Freigabe. Aus enabled und threshold lässt es sich unverfälscht
  // zurückrechnen - so ist nachprüfbar, was das Gerät wirklich schickt.
  showRawAnswer(config);

  // Manche Firmwarestände geben die Freigabe beim Lesen nicht zurück; dann
  // steht in keinem Byte das oberste Bit. Die Schwellwerte stimmen trotzdem.
  // An die Stelle der fehlenden Antwort tritt dann, was zuletzt geschrieben
  // wurde – so holt „Laden“ den Stand des Geräts zurück und verwirft
  // ungespeicherte Änderungen, statt sie einfach stehen zu lassen.
  const reported = SENSOR_KEYS.some((key) => config[key].enabled);
  const known = reported ? config : writtenConfig;

  SHOWN_SENSORS.forEach((key) => {
    if (known) byId(`${key}-enabled`).checked = known[key].enabled;

    byId(`${key}-threshold`).value = config[key].threshold;
    byId(`${key}-threshold-value`).textContent = config[key].threshold;

    const bar = pressBars.get(key);
    if (bar) bar.threshold.textContent = config[key].threshold;
  });

  assumeForce();
  showActiveSensors();
}

function showRawAnswer(config) {
  const bytes = SENSOR_KEYS.map((key) => {
    const raw = (config[key].enabled ? 0x80 : 0) | config[key].threshold;
    return raw.toString(16).padStart(2, "0").toUpperCase();
  });

  const element = byId("button-raw");
  element.textContent = `· ANTWORT ${bytes.join(" ")}`;
  element.hidden = false;
}

// Ist auf einer Seite gar nichts freigegeben, wäre die Taste tot - ein
// Zustand, den die Maus offensichtlich nicht hat. Dann gilt dieselbe Annahme
// wie im Desktop-Werkzeug: Es misst die Force-Sensorik.
function assumeForce() {
  ["left", "right"].forEach((side) => {
    const enabled = SHOWN_SENSORS
      .filter((key) => key.startsWith(side))
      .some((key) => byId(`${key}-enabled`).checked);

    if (!enabled) byId(`${side}Force-enabled`).checked = true;
  });
}

// ─── Radkalibrierung ──────────────────────────────────

byId("load-calibration").addEventListener("click", () => run(async () => {
  populateCalibration(await mouse.readCalibration());
}, "Kalibrierung geladen"));

byId("save-calibration").addEventListener("click", () => {
  const calibration = readCalibration();

  run(async () => {
    await mouse.writeCalibration(calibration);
    // Ab jetzt führt das Gerät diesen Wert.
    wheelPressTrigger = calibration.pressTrigger * PRESS_TRIGGER_SCALE;
  }, "Kalibrierung gespeichert");
});

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
    pressTrigger: numberValue("press-trigger") / PRESS_TRIGGER_SCALE,
  };
}

function populateCalibration(calibration) {
  // Nur das Gerät speist diese Funktion – der Wert gilt damit als der
  // tatsächlich wirksame, nicht der möglicherweise ungespeicherte aus
  // dem Eingabefeld. Gehalten wird er in Zählschritten, also auf der
  // Skala des Radius.
  wheelPressTrigger = calibration.pressTrigger * PRESS_TRIGGER_SCALE;

  Object.entries({
    "offset-x": calibration.offsetX,
    "offset-z": calibration.offsetZ,
    "amplitude-x": calibration.amplitudeX,
    "amplitude-z": calibration.amplitudeZ,
    "ellipse-angle": calibration.ellipseAngle,
  }).forEach(([id, value]) => { byId(id).value = value; });

  byId("press-trigger").value = roundTrigger(
    calibration.pressTrigger * PRESS_TRIGGER_SCALE);
}

// Die Firmware führt die Druckschwelle tausendfach kleiner als der
// hier angezeigte Wert. Das Desktop-Werkzeug rechnet genauso:
//
//     spin.setValue(int(max_length_calib * 1000))
//     press_trigger = spin.value() / 1000.0
//
// Angezeigt wird sie damit in denselben Zählschritten wie die
// übertragenen Feldwerte – die Zahl im Eingabefeld lässt sich direkt
// mit dem Radius in der Live-Ansicht vergleichen.
const PRESS_TRIGGER_SCALE = 1000;

// Das Desktop-Werkzeug rundet auf eine Ganzzahl. Ohne das schlägt die
// Ungenauigkeit der 32-Bit-Gleitkommazahl bis in die Anzeige durch
// – aus 1050 würde 1049,999952.
function roundTrigger(value) {
  return Math.round(value);
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
showActiveSensors();
previewLed(byId("led-color").value);
resetLiveReadouts();
stopMonitoring();
charts.draw();
loadMouseModel();
loadConfigModel();

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
