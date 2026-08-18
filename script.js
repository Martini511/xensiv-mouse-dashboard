'use strict';

/* ═══════════════════════════════════════════════════════
   XENSIV™ Maus – Web-HID-Konfigurator
   Nutzdaten und Byte-Formate gemäß XENSIV_Mouse_GUI v1.1
   ═══════════════════════════════════════════════════════ */

// ─── HID-Report-Zuordnung ─────────────────────────────

const REPORT_LABEL = {
  led:          'LED-Steuerung',
  dpi:          'DPI-Einstellung',
  buttons:      'Tasten-Konfiguration',
  buttonPress:  'Tasten-Druckwerte',
  sensorLeft:   'Sensor-Schalter links',
  sensorRight:  'Sensor-Schalter rechts',
  triggerLeft:  'Trigger links',
  triggerRight: 'Trigger rechts',
  wheelCalib:   'Rad-Kalibrierung',
  wheelValues:  'Rad-Messwerte',
  battery:      'Batteriestand'
};

// Nutzdatenlänge in Byte – identisch zum Protokoll der Firmware
const REPORT_LENGTH = {
  led:          3,
  dpi:          2,
  buttons:      5,
  buttonPress:  5,
  sensorLeft:   1,
  sensorRight:  1,
  triggerLeft:  1,
  triggerRight: 1,
  wheelCalib:   14,
  wheelValues:  12,
  battery:      1
};

// Vorbelegung der Report-IDs. Sie muss zur Firmware passen und
// ist im Diagnosebereich der Seite änderbar.
const DEFAULT_REPORT_IDS = {
  led:          1,
  dpi:          2,
  buttons:      3,
  buttonPress:  4,
  sensorLeft:   5,
  sensorRight:  6,
  triggerLeft:  7,
  triggerRight: 8,
  wheelCalib:   9,
  wheelValues:  10,
  battery:      11
};

const REPORT_KEYS = Object.keys(DEFAULT_REPORT_IDS);

const STORAGE_KEY     = 'xensiv.reportIds';
const DEVICE_KEY      = 'xensiv.deviceKey';
const AUTOCONNECT_KEY = 'xensiv.autoConnect';

// Chrome sperrt Standard-Maus- und Tastatur-Collections. Die
// Konfiguration läuft deshalb über eine herstellerspezifische
// Collection (Usage Page ab 0xFF00).
const VENDOR_USAGE_PAGE = 0xff00;

const SENSOR_KEYS = [
  'left_force', 'left_tmr_2d', 'left_hall', 'right_force', 'right_hall'
];

// ─── Infineon Farbpalette ─────────────────────────────

const IFX = {
  ocean:     '#12a190',
  oceanSoft: 'rgba(18, 161, 144, 0.35)',
  orange:    '#f0803c',
  red:       '#ff5a5a',
  grid:      '#2c2e32',
  text:      '#9b9da3'
};

// ─── Zustand ──────────────────────────────────────────

const state = {
  device:    null,
  reports:   { feature: new Map(), output: new Map(), input: new Map() },
  reportIds: Object.assign({}, DEFAULT_REPORT_IDS),
  lastInput: {},
  connected: false,
  batteryTimer: null,

  sensors: {
    left_force:  { enabled: true,  threshold: 64 },
    left_tmr_2d: { enabled: false, threshold: 64 },
    left_hall:   { enabled: false, threshold: 64 },
    right_force: { enabled: true,  threshold: 64 },
    right_hall:  { enabled: false, threshold: 64 }
  },

  buttons: {
    monitoring: false,
    timer:      null,
    busy:       false
  },

  wheel: {
    streaming:  false,
    timer:      null,
    busy:       false,
    samples:    0,
    time:       [],
    angleRaw:   [],
    angleCal:   [],
    xRaw:       [],
    yRaw:       [],
    xCal:       [],
    yCal:       [],
    angleRange: null,
    xyRange:    null,
    stored:     null
  }
};

const MAX_POINTS    = 1000;
const DISPLAY_LIMIT = 80;

// ─── Kurzschreibweisen ────────────────────────────────

const $ = (id) => document.getElementById(id);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ─── HID-Warteschlange ────────────────────────────────
// Feature-Report-Zugriffe werden serialisiert, damit sich
// parallele Anfragen nicht gegenseitig blockieren.

let hidChain = Promise.resolve();

function hidQueue(task) {
  const result = hidChain.then(task, task);
  hidChain = result.then(() => {}, () => {});
  return result;
}

function requireDevice() {
  if (!state.device || !state.device.opened) {
    throw new Error('Keine XENSIV Maus verbunden');
  }
  return state.device;
}

function reportKind(key) {
  const id = state.reportIds[key];

  if (state.reports.feature.has(id)) return 'feature';
  if (state.reports.output.has(id))  return 'output';
  if (state.reports.input.has(id))   return 'input';
  return null;
}

function hasReport(key) {
  return reportKind(key) !== null;
}

function canWrite(key) {
  const kind = reportKind(key);
  return kind === 'feature' || kind === 'output';
}

function canRead(key) {
  const kind = reportKind(key);
  return kind === 'feature' || kind === 'input';
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

// Feature-Reports enthalten die Report-ID als erstes Byte,
// Input-Reports dagegen nicht.
function stripReportId(view, reportId, expectedLength) {
  if (reportId !== 0 && view.byteLength === expectedLength + 1) {
    return new DataView(view.buffer, view.byteOffset + 1, view.byteLength - 1);
  }
  return view;
}

function writeReport(key, data) {
  const device = requireDevice();
  const id     = state.reportIds[key];
  const bytes  = toBytes(data);

  if (!canWrite(key)) {
    throw new Error(
      `Für „${REPORT_LABEL[key]}“ bietet das Gerät keinen beschreibbaren ` +
      `Report mit der ID ${id}`
    );
  }

  return hidQueue(() => {
    const useOutput = state.reports.output.has(id) &&
                      !state.reports.feature.has(id);

    return useOutput
      ? device.sendReport(id, bytes)
      : device.sendFeatureReport(id, bytes);
  });
}

async function readReport(key) {
  const device = requireDevice();
  const id     = state.reportIds[key];

  if (state.reports.feature.has(id)) {
    const view = await hidQueue(() => device.receiveFeatureReport(id));
    return stripReportId(view, id, REPORT_LENGTH[key]);
  }

  const cached = state.lastInput[id];
  if (cached) return cached;

  throw new Error(
    `Für „${REPORT_LABEL[key]}“ liegt noch kein Input-Report vor ` +
    `(Report-ID ${id})`
  );
}

// ─── Report-ID-Zuordnung ──────────────────────────────

function loadReportIds() {
  const ids = Object.assign({}, DEFAULT_REPORT_IDS);

  let stored = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('localStorage nicht verfügbar:', error);
  }

  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      REPORT_KEYS.forEach((key) => {
        if (Number.isInteger(parsed[key])) {
          ids[key] = clamp(parsed[key], 0, 255);
        }
      });
    } catch (error) {
      console.warn('Report-Zuordnung nicht lesbar:', error);
    }
  }

  return ids;
}

function renderReportMap() {
  const container = $('report-map');
  container.innerHTML = '';

  REPORT_KEYS.forEach((key) => {
    const label = document.createElement('label');
    label.className = 'param';

    const caption = document.createElement('span');
    caption.textContent = `${REPORT_LABEL[key]} (${REPORT_LENGTH[key]} Byte)`;

    const input = document.createElement('input');
    input.type  = 'number';
    input.className = 'num';
    input.id    = `report-id-${key}`;
    input.min   = '0';
    input.max   = '255';
    input.value = String(state.reportIds[key]);

    label.append(caption, input);
    container.appendChild(label);
  });
}

function saveReportIds() {
  REPORT_KEYS.forEach((key) => {
    const input = $(`report-id-${key}`);
    if (input) state.reportIds[key] = clamp(toInt(input.value, 0), 0, 255);
  });

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.reportIds));
  } catch (error) {
    console.warn('localStorage nicht verfügbar:', error);
  }

  renderReportMap();
  renderReportStatus();
  updateAvailability();
  addLog('[CFG] Report-Zuordnung gespeichert');
}

function resetReportIds() {
  state.reportIds = Object.assign({}, DEFAULT_REPORT_IDS);
  renderReportMap();
  saveReportIds();
}

// ─── Verbindungsaufbau ────────────────────────────────

function wait(milliseconds) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

function describeHidError(error) {
  const name    = (error && error.name) || 'Error';
  const message = (error && error.message) || String(error);

  if (name === 'SecurityError') {
    return 'Der Browser hat den Zugriff blockiert. Web HID benötigt HTTPS oder ' +
           'localhost. Außerdem sperrt Chrome die Standard-Maus- und ' +
           'Tastatur-Collections – die Konfiguration muss über eine ' +
           'herstellerspezifische Collection (Usage Page ab 0xFF00) laufen.';
  }

  if (name === 'NotAllowedError') {
    return 'Der Zugriff auf das Gerät wurde verweigert. Bitte die Freigabe im ' +
           'Browser-Dialog bestätigen.';
  }

  if (name === 'NotFoundError') {
    return 'Das Gerät wurde nicht gefunden. Ist die Maus eingeschaltet und ' +
           'mit dem Betriebssystem verbunden?';
  }

  if (/open|access|busy/i.test(message)) {
    return 'Das Gerät ließ sich nicht öffnen. Häufigste Ursache: Ein anderes ' +
           'Programm (z. B. das Desktop-Tool „XENSIV Mouse Control“) belegt das ' +
           'Gerät. Bitte schließen und erneut versuchen.';
  }

  return message;
}

function setConnectError(message, kind) {
  const element = $('connect-error');

  if (!message) {
    element.className   = 'status-line hidden';
    element.textContent = '';
    return;
  }

  element.className   = `status-line is-${kind || 'error'}`;
  element.textContent = message;
}

function deviceLabel(device) {
  const name = device.productName || 'HID-Gerät';
  const ids  = `${hex16(device.vendorId)}:${hex16(device.productId)}`;
  return `${name} (${ids})`;
}

function hex16(value) {
  return '0x' + Number(value || 0).toString(16).padStart(4, '0');
}

function deviceKey(device) {
  return `${device.vendorId}:${device.productId}:${device.productName || ''}`;
}

// Alle Reports des Geräts nach ID indizieren
function indexReports(device) {
  const maps = {
    feature: new Map(),
    output:  new Map(),
    input:   new Map()
  };

  const walk = (collection) => {
    (collection.featureReports || []).forEach(r => maps.feature.set(r.reportId, r));
    (collection.outputReports  || []).forEach(r => maps.output.set(r.reportId, r));
    (collection.inputReports   || []).forEach(r => maps.input.set(r.reportId, r));
    (collection.children || []).forEach(walk);
  };

  (device.collections || []).forEach(walk);
  state.reports = maps;
}

function onInputReport(event) {
  state.lastInput[event.reportId] = event.data;

  if (event.reportId === state.reportIds.buttonPress &&
      state.buttons.monitoring) {
    handlePressValues(event.data);
  }

  if (event.reportId === state.reportIds.wheelValues &&
      state.wheel.streaming) {
    handleWheelValues(event.data);
  }
}

async function connectToDevice(device, options) {
  const settings = options || {};

  setConnectError('');
  $('btn-connect').disabled = true;

  try {
    setStatus(false, `Öffne ${deviceLabel(device)} …`);

    if (!device.opened) await device.open();

    state.device    = device;
    state.lastInput = {};
    indexReports(device);

    device.removeEventListener('inputreport', onInputReport);
    device.addEventListener('inputreport', onInputReport);

    state.connected = true;
    $('btn-disconnect').disabled = false;
    $('device-meta').classList.remove('hidden');
    $('device-name').textContent = deviceLabel(device);

    rememberDevice(device);
    reportDiscovery(device);

    setStatus(true, `Verbunden – ${device.productName || 'XENSIV Maus'}`);
    addLog(`[OK]  Geöffnet: ${deviceLabel(device)}`);

    showCards();
    updateAvailability();
    await refreshKnownDevices();

    await refreshBattery();
    state.batteryTimer = window.setInterval(refreshBattery, 10000);

    if (canRead('buttons')) await readButtonConfig();
    if (canRead('wheelCalib')) await loadCalibration(true);

    return true;
  } catch (error) {
    $('btn-connect').disabled = false;

    setStatus(false, `Verbindung fehlgeschlagen (${error.name})`);
    addLog(`[ERR] ${error.name}: ${error.message}`);

    try {
      if (device.opened) await device.close();
    } catch (ignored) {
      // Gerät war ohnehin nicht offen
    }

    if (settings.silent) return false;

    setConnectError(describeHidError(error));
    $('log-card').open = true;
    return false;
  }
}

function reportDiscovery(device) {
  const found = REPORT_KEYS.filter(hasReport).length;
  const total = REPORT_KEYS.length;

  $('feature-count').textContent = `${found} von ${total}`;
  renderReportStatus();
  renderReportExplorer(device);

  const collections = (device.collections || []).length;
  addLog(`[HID] ${collections} Collection(s), ${found}/${total} Reports zugeordnet`);

  if (found === 0) {
    $('uuid-panel').open = true;
    addLog('[!]   Keine passende Report-ID gefunden – bitte Zuordnung anpassen');
    setConnectError(
      'Das Gerät stellt keine der eingetragenen Report-IDs bereit. Im Bereich ' +
      '„HID-Reports & Diagnose“ sind alle tatsächlich vorhandenen Reports ' +
      'aufgelistet – bitte die Zuordnung entsprechend anpassen.',
      'busy'
    );
  }
}

async function connect() {
  if (!navigator.hid) {
    setStatus(false, 'Web HID wird von diesem Browser nicht unterstützt');
    addLog('[!]   Web HID nicht verfügbar');
    return;
  }

  const vendorOnly = $('opt-vendor-only').checked;
  const filters    = vendorOnly ? [{ usagePage: VENDOR_USAGE_PAGE }] : [];

  setConnectError('');
  $('btn-connect').disabled = true;

  let devices = [];

  try {
    setStatus(false, 'Geräteauswahl geöffnet …');
    addLog('[HID] Geräteauswahl geöffnet');
    devices = await navigator.hid.requestDevice({ filters });
  } catch (error) {
    $('btn-connect').disabled = false;
    setStatus(false, 'Kein Gerät ausgewählt');
    addLog(`[!]   Geräteauswahl beendet: ${error.name} – ${error.message}`);
    setConnectError(describeHidError(error));
    return;
  }

  if (devices.length === 0) {
    $('btn-connect').disabled = false;
    setStatus(false, 'Kein Gerät ausgewählt');
    addLog('[!]   Auswahl abgebrochen');
    return;
  }

  await connectToDevice(devices[0]);
}

// ─── Bereits freigegebene Geräte ──────────────────────
// navigator.hid.getDevices() liefert alle HID-Geräte, für die diese
// Seite bereits eine Berechtigung besitzt. Damit wird die vom
// Betriebssystem verbundene Maus ohne erneuten Auswahldialog erkannt.

function rememberDevice(device) {
  try {
    window.localStorage.setItem(DEVICE_KEY, deviceKey(device));
  } catch (error) {
    console.warn('localStorage nicht verfügbar:', error);
  }
}

function preferredDeviceKey() {
  try {
    return window.localStorage.getItem(DEVICE_KEY);
  } catch (error) {
    return null;
  }
}

async function getKnownDevices() {
  if (!navigator.hid) return [];

  try {
    return await navigator.hid.getDevices();
  } catch (error) {
    addLog(`[!]   Geräteliste nicht lesbar: ${error.name} – ${error.message}`);
    return [];
  }
}

function renderKnownDevices(devices) {
  const panel = $('known-devices');
  const list  = $('known-list');

  list.innerHTML = '';

  if (devices.length === 0) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  devices.forEach((device) => {
    const isCurrent = state.connected && state.device === device;

    const item = document.createElement('div');
    item.className = 'known-item';

    const info = document.createElement('div');
    info.className = 'known-item-info';

    const name = document.createElement('span');
    name.className = 'known-item-name';
    name.textContent = device.productName || 'Unbenanntes HID-Gerät';

    const meta = document.createElement('span');
    meta.className = 'known-item-meta';
    meta.textContent = isCurrent
      ? `verbunden · ${hex16(device.vendorId)}:${hex16(device.productId)}`
      : `freigegeben · ${hex16(device.vendorId)}:${hex16(device.productId)}`;

    info.append(name, meta);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-primary';
    button.textContent = 'Verbinden';
    button.disabled = state.connected;
    button.addEventListener('click', () => connectToDevice(device));

    item.append(info, button);
    list.appendChild(item);
  });
}

async function refreshKnownDevices() {
  const devices = await getKnownDevices();
  renderKnownDevices(devices);
  return devices;
}

async function autoConnect() {
  if (!navigator.hid) return;

  const devices = await refreshKnownDevices();

  if (devices.length === 0) {
    addLog('[HID] Noch kein Gerät freigegeben – bitte einmalig auswählen');
    return;
  }

  addLog(`[HID] ${devices.length} bereits freigegebene(s) Gerät(e) gefunden`);

  if (!$('opt-autoconnect').checked || state.connected) return;

  const preferred = preferredDeviceKey();
  const device = devices.find(entry => deviceKey(entry) === preferred) ||
                 devices[0];

  setStatus(false, `Verbinde automatisch mit ${device.productName || 'Gerät'} …`);
  await connectToDevice(device, { silent: true });
}

function onHidConnect(event) {
  addLog(`[HID] Gerät angeschlossen: ${deviceLabel(event.device)}`);
  refreshKnownDevices();

  if (!state.connected && $('opt-autoconnect').checked) {
    connectToDevice(event.device, { silent: true });
  }
}

function onHidDisconnect(event) {
  addLog(`[HID] Gerät entfernt: ${deviceLabel(event.device)}`);

  if (state.device === event.device) onDisconnected();
  else refreshKnownDevices();
}

// ─── Diagnose ─────────────────────────────────────────

function renderReportStatus() {
  const list = $('report-status');
  if (!list) return;

  list.innerHTML = '';

  REPORT_KEYS.forEach((key) => {
    const kind = reportKind(key);
    const item = document.createElement('li');

    item.className = 'char-item ' + (kind ? 'is-ok' : 'is-missing');
    item.textContent = kind
      ? `${REPORT_LABEL[key]} – ID ${state.reportIds[key]} (${kind})`
      : `${REPORT_LABEL[key]} – ID ${state.reportIds[key]} nicht gefunden`;

    list.appendChild(item);
  });
}

function renderReportExplorer(device) {
  const container = $('report-explorer');
  if (!container) return;

  container.innerHTML = '';

  const collections = (device && device.collections) || [];

  if (collections.length === 0) {
    container.textContent =
      'Das Gerät meldet keine zugänglichen Collections. Chrome sperrt ' +
      'Standard-Maus- und Tastatur-Collections.';
    return;
  }

  collections.forEach((collection) => {
    const block = document.createElement('div');
    block.className = 'explorer-block';

    const title = document.createElement('p');
    title.className = 'explorer-title';
    title.textContent =
      `Usage Page ${hex16(collection.usagePage)} · Usage ` +
      `${hex16(collection.usage)}`;
    block.appendChild(title);

    const lines = [];
    const describe = (label, reports) => {
      (reports || []).forEach((report) => {
        const bits = (report.items || [])
          .reduce((sum, item) => sum + (item.reportCount || 0) *
                                       (item.reportSize || 0), 0);
        lines.push(`${label} · ID ${report.reportId} · ${Math.ceil(bits / 8)} Byte`);
      });
    };

    describe('Input',   collection.inputReports);
    describe('Output',  collection.outputReports);
    describe('Feature', collection.featureReports);

    const list = document.createElement('ul');
    list.className = 'explorer-list';

    if (lines.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = 'keine Reports';
      list.appendChild(empty);
    } else {
      lines.forEach((line) => {
        const entry = document.createElement('li');
        entry.textContent = line;
        list.appendChild(entry);
      });
    }

    block.appendChild(list);
    container.appendChild(block);
  });
}

function updateAvailability() {
  const writable = [
    ['btn-led-send',      'led'],
    ['btn-buttons-apply', 'buttons'],
    ['btn-cal-start',     'wheelCalib'],
    ['btn-cal-upload',    'wheelCalib'],
    ['btn-sensor-apply',  'sensorLeft'],
    ['btn-trigger-apply', 'triggerLeft']
  ];

  const readable = [
    ['btn-buttons-read',    'buttons'],
    ['btn-buttons-monitor', 'buttonPress'],
    ['btn-wheel-stream',    'wheelValues'],
    ['btn-cal-load',        'wheelCalib']
  ];

  const apply = (entries, test) => {
    entries.forEach(([elementId, key]) => {
      const element = $(elementId);
      if (!element) return;

      const ok = state.connected && test(key);
      element.disabled = !ok;
      element.title = ok
        ? ''
        : `Report „${REPORT_LABEL[key]}“ (ID ${state.reportIds[key]}) nicht verfügbar`;
    });
  };

  apply(writable, canWrite);
  apply(readable, canRead);

  document.querySelectorAll('.chip[data-led]').forEach((chip) => {
    chip.disabled = !(state.connected && canWrite('led'));
  });

  const dpiReady = state.connected && canWrite('dpi');
  $('dpi-slider').disabled = !dpiReady;
  $('dpi-value').disabled  = !dpiReady;
}

async function disconnect() {
  stopButtonMonitoring();
  stopWheelStreaming();

  const device = state.device;

  try {
    if (device && device.opened) await device.close();
  } catch (error) {
    addLog(`[!]   Schließen fehlgeschlagen: ${error.message}`);
  }

  onDisconnected();
}

function onDisconnected() {
  $('btn-connect').disabled = false;

  // Beim Abbruch eines Verbindungsversuchs gibt es nichts abzubauen –
  // die Fehlermeldung soll in diesem Fall stehen bleiben.
  if (!state.connected) return;

  stopButtonMonitoring();
  stopWheelStreaming();

  if (state.batteryTimer !== null) {
    window.clearInterval(state.batteryTimer);
    state.batteryTimer = null;
  }

  if (state.device) {
    state.device.removeEventListener('inputreport', onInputReport);
  }

  state.connected = false;
  state.device    = null;
  state.lastInput = {};
  state.reports   = {
    feature: new Map(), output: new Map(), input: new Map()
  };

  $('btn-disconnect').disabled = true;
  $('device-meta').classList.add('hidden');
  $('battery-value').textContent = '–';

  setStatus(false, 'Verbindung getrennt');
  addLog('[!]   Verbindung zum Gerät getrennt');
  hideCards();
  updateAvailability();
  refreshKnownDevices();
}

// ─── Batteriestand ────────────────────────────────────

async function refreshBattery() {
  if (!state.connected || !canRead('battery')) {
    $('battery-value').textContent = 'nicht verfügbar';
    return;
  }

  try {
    const value = await readReport('battery');
    $('battery-value').textContent = `${value.getUint8(0)} %`;
  } catch (error) {
    $('battery-value').textContent = 'Lesefehler';
  }
}

// ─── LED-Steuerung ────────────────────────────────────

async function sendLedColor(red, green, blue) {
  try {
    await writeReport('led', new Uint8Array([red, green, blue]));
    setLedVisual(red, green, blue);
    setDeviceStatus(`LED gesetzt: R=${red} G=${green} B=${blue}`, 'ok');
    addLog(`[TX]  LED R=${red} G=${green} B=${blue}`);
  } catch (error) {
    setDeviceStatus(`LED-Befehl fehlgeschlagen: ${error.message}`, 'error');
    addLog(`[ERR] LED: ${error.message}`);
  }
}

function setLedVisual(red, green, blue) {
  const color = `rgb(${red}, ${green}, ${blue})`;
  const off   = red === 0 && green === 0 && blue === 0;

  $('mouse-led').style.fill = off ? '#2b2d31' : color;
  $('mouse-glow').style.fill = off ? 'transparent' : color;
  $('mouse-glow').style.opacity = off ? '0' : '0.28';
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

// ─── DPI ──────────────────────────────────────────────

let dpiTimer = null;

function scheduleDpi(value) {
  if (dpiTimer !== null) window.clearTimeout(dpiTimer);
  dpiTimer = window.setTimeout(() => sendDpi(value), 200);
}

async function sendDpi(value) {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setUint16(0, value, true);

  try {
    await writeReport('dpi', buffer);
    setDeviceStatus(`DPI auf ${value} gesetzt`, 'ok');
    addLog(`[TX]  DPI ${value}`);
  } catch (error) {
    setDeviceStatus(`DPI-Befehl fehlgeschlagen: ${error.message}`, 'error');
    addLog(`[ERR] DPI: ${error.message}`);
  }
}

// ─── Tasten-Sensorik ──────────────────────────────────

const pressBars = {};

function createPressBar(root) {
  const track  = root.querySelector('.press-bar-track');
  const fill   = root.querySelector('.press-bar-fill');
  const marker = root.querySelector('.press-bar-marker');
  const curEl  = root.querySelector('.press-bar-cur');
  const thrEl  = root.querySelector('.press-bar-thr');
  const maxEl  = root.querySelector('.press-bar-max');

  const bar = {
    pressure:  0,
    threshold: 64,
    enabled:   true,
    maxSeen:   40,
    minRange:  40,
    onChange:  null,

    range() {
      return Math.max(this.maxSeen, this.minRange);
    },

    maxAllowed() {
      return Math.min(127, Math.max(0, this.maxSeen - 10));
    },

    setPressure(value) {
      this.pressure = Math.max(0, value);
      if (value > this.maxSeen) this.maxSeen = value;
      this.render();
    },

    setThreshold(value) {
      this.threshold = clamp(Math.round(value), 0, 127);
      this.render();
    },

    setEnabled(value) {
      this.enabled = value;
      root.classList.toggle('is-disabled', !value);
      this.render();
    },

    render() {
      const range   = this.range();
      const percent = clamp((this.pressure / range) * 100, 0, 100);
      const thrPct  = clamp((this.threshold / range) * 100, 0, 100);

      fill.style.width    = `${percent}%`;
      marker.style.left   = `${thrPct}%`;
      curEl.textContent   = String(this.pressure);
      thrEl.textContent   = String(this.threshold);
      maxEl.textContent   = String(Math.round(range));

      root.classList.toggle('is-triggered',
        this.enabled && this.pressure >= this.threshold && this.pressure > 0);

      track.setAttribute('aria-valuenow', String(this.threshold));
    }
  };

  function thresholdFromPointer(clientX) {
    const rect  = track.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const value = Math.round(ratio * bar.range());

    return clamp(value, 0, bar.maxAllowed());
  }

  function apply(value) {
    if (value === bar.threshold) return;
    bar.setThreshold(value);
    if (bar.onChange) bar.onChange(bar.threshold);
  }

  track.addEventListener('pointerdown', (event) => {
    track.setPointerCapture(event.pointerId);
    root.classList.add('is-dragging');
    apply(thresholdFromPointer(event.clientX));
  });

  track.addEventListener('pointermove', (event) => {
    if (!root.classList.contains('is-dragging')) return;
    apply(thresholdFromPointer(event.clientX));
  });

  const endDrag = (event) => {
    root.classList.remove('is-dragging');
    if (track.hasPointerCapture(event.pointerId)) {
      track.releasePointerCapture(event.pointerId);
    }
  };

  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  track.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 1;

    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      apply(clamp(bar.threshold - step, 0, bar.maxAllowed()));
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      apply(clamp(bar.threshold + step, 0, bar.maxAllowed()));
    }
  });

  bar.render();
  return bar;
}

function sensorKey(side) {
  return $(`${side}-sensor`).value;
}

function syncSensorUi(side) {
  const key       = sensorKey(side);
  const threshold = state.sensors[key].threshold;

  pressBars[side].setThreshold(threshold);
  $(`${side}-threshold`).value = threshold;
  $(`${side}-hint`).classList.toggle('hidden', state.sensors[key].enabled);
}

function packSensorByte(sensor) {
  return (sensor.enabled ? 0x80 : 0x00) | (sensor.threshold & 0x7f);
}

async function readButtonConfig() {
  setButtonsStatus('Einstellungen werden vom Gerät gelesen …', 'busy');

  try {
    const value = await readReport('buttons');

    if (value.byteLength < 5) {
      throw new Error(`5 Bytes erwartet, ${value.byteLength} empfangen`);
    }

    SENSOR_KEYS.forEach((key, index) => {
      const byte = value.getUint8(index);
      state.sensors[key] = {
        enabled:   Boolean(byte & 0x80),
        threshold: byte & 0x7f
      };
    });

    if (state.sensors.left_force.enabled) {
      $('left-sensor').value = 'left_force';
    } else if (state.sensors.left_tmr_2d.enabled) {
      $('left-sensor').value = 'left_tmr_2d';
    } else if (state.sensors.left_hall.enabled) {
      $('left-sensor').value = 'left_hall';
    } else {
      $('left-sensor').value = 'left_force';
    }

    $('right-sensor').value = state.sensors.right_hall.enabled
      ? 'right_hall'
      : 'right_force';

    syncSensorUi('left');
    syncSensorUi('right');

    setButtonsStatus('Einstellungen vom Gerät geladen', 'ok');
    addLog('[RX]  Tasten-Konfiguration gelesen');
  } catch (error) {
    setButtonsStatus(`Lesen fehlgeschlagen: ${error.message}`, 'error');
    addLog(`[ERR] Tasten-Konfiguration: ${error.message}`);
  }
}

async function applyButtonConfig() {
  const confirmed = window.confirm(
    'Die auf der Maus gespeicherten Schwellwerte werden überschrieben. Fortfahren?'
  );
  if (!confirmed) return;

  if (state.buttons.monitoring) stopButtonMonitoring();

  SENSOR_KEYS.forEach((key) => { state.sensors[key].enabled = false; });
  state.sensors[sensorKey('left')].enabled  = true;
  state.sensors[sensorKey('right')].enabled = true;

  const data = new Uint8Array(
    SENSOR_KEYS.map(key => packSensorByte(state.sensors[key]))
  );

  setButtonsStatus('Konfiguration wird gesendet …', 'busy');

  try {
    await writeReport('buttons', data);

    syncSensorUi('left');
    syncSensorUi('right');

    setButtonsStatus('Konfiguration erfolgreich übertragen', 'ok');
    addLog(
      `[TX]  Tasten-Konfiguration: ${
        Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ')
      }`
    );
  } catch (error) {
    setButtonsStatus(`Übertragung fehlgeschlagen: ${error.message}`, 'error');
    addLog(`[ERR] Tasten-Konfiguration: ${error.message}`);
  }
}

function handlePressValues(view) {
  if (view.byteLength < 5) return;

  const values = {};
  SENSOR_KEYS.forEach((key, index) => {
    values[key] = view.getUint8(index) & 0x7f;
  });

  const left  = values[sensorKey('left')] || 0;
  const right = values[sensorKey('right')] || 0;

  pressBars.left.setPressure(left);
  pressBars.right.setPressure(right);

  $('left-threshold').max  = String(pressBars.left.maxAllowed());
  $('right-threshold').max = String(pressBars.right.maxAllowed());

  $('mouse-press-readout').textContent = `Druck L ${left} / R ${right}`;
  $('mouse-btn-left').classList.toggle(
    'is-pressed', left >= pressBars.left.threshold && left > 0);
  $('mouse-btn-right').classList.toggle(
    'is-pressed', right >= pressBars.right.threshold && right > 0);
}

async function pollPressValues() {
  if (state.buttons.busy) return;
  state.buttons.busy = true;

  try {
    handlePressValues(await readReport('buttonPress'));
  } catch (error) {
    stopButtonMonitoring();
    setButtonsStatus(`Überwachung gestoppt: ${error.message}`, 'error');
  } finally {
    state.buttons.busy = false;
  }
}

function startButtonMonitoring() {
  if (!canRead('buttonPress')) return;

  state.buttons.monitoring = true;
  $('btn-buttons-monitor').textContent = 'Überwachung stoppen';
  setButtonsStatus('Überwachung aktiv …', 'busy');

  // Liefert das Gerät die Druckwerte als Input-Report, kommen die
  // Daten von selbst über das inputreport-Ereignis.
  if (reportKind('buttonPress') === 'input') return;

  state.buttons.timer = window.setInterval(pollPressValues, 60);
}

function stopButtonMonitoring() {
  if (!state.buttons.monitoring) return;

  state.buttons.monitoring = false;
  $('btn-buttons-monitor').textContent = 'Überwachung starten';

  if (state.buttons.timer !== null) {
    window.clearInterval(state.buttons.timer);
    state.buttons.timer = null;
  }

  setButtonsStatus('Überwachung gestoppt', 'idle');
}

// ─── Sensor-Schalter und Trigger ──────────────────────

async function applySensorSwitches() {
  const left  = $('sensor-left').checked ? 1 : 0;
  const right = $('sensor-right').checked ? 1 : 0;

  try {
    await writeReport('sensorLeft', new Uint8Array([left]));
    await writeReport('sensorRight', new Uint8Array([right]));

    setAdvancedStatus(
      `Sensor-Schalter gesetzt: links=${left}, rechts=${right}`, 'ok');
    addLog(`[TX]  Sensor-Schalter L=${left} R=${right}`);
  } catch (error) {
    setAdvancedStatus(`Fehlgeschlagen: ${error.message}`, 'error');
    addLog(`[ERR] Sensor-Schalter: ${error.message}`);
  }
}

async function applyTriggers() {
  const left  = clamp(toInt($('trigger-left-value').value, 0), 0, 255);
  const right = clamp(toInt($('trigger-right-value').value, 0), 0, 255);

  try {
    await writeReport('triggerLeft', new Uint8Array([left]));
    await writeReport('triggerRight', new Uint8Array([right]));

    setAdvancedStatus(
      `Trigger gesetzt: links=${left}, rechts=${right}`, 'ok');
    addLog(`[TX]  Trigger L=${left} R=${right}`);
  } catch (error) {
    setAdvancedStatus(`Fehlgeschlagen: ${error.message}`, 'error');
    addLog(`[ERR] Trigger: ${error.message}`);
  }
}

// ─── Scrollrad: Datenstrom ────────────────────────────

function handleWheelValues(view) {
  if (view.byteLength < 12) return;

  const xRaw      = view.getInt16(0, true);
  const yRaw      = view.getInt16(2, true);
  const xCal      = view.getInt16(4, true);
  const yCal      = view.getInt16(6, true);
  const angleRaw  = view.getInt16(8, true);
  const angleCal  = view.getInt16(10, true);

  const wheel = state.wheel;
  wheel.samples += 1;

  pushCapped(wheel.time, wheel.samples);
  pushCapped(wheel.angleRaw, angleRaw);
  pushCapped(wheel.angleCal, angleCal);
  pushCapped(wheel.xRaw, xRaw);
  pushCapped(wheel.yRaw, yRaw);
  pushCapped(wheel.xCal, xCal);
  pushCapped(wheel.yCal, yCal);

  $('mouse-wheel-readout').textContent =
    `Radwinkel ${angleCal}° (roh ${angleRaw}°)`;
  $('mouse-wheel-group').setAttribute(
    'transform', `rotate(${angleCal} 120 73)`);

  drawAngleChart();
  drawXyChart();
}

function pushCapped(array, value) {
  array.push(value);
  if (array.length > MAX_POINTS) array.shift();
}

async function pollWheelValues() {
  if (state.wheel.busy) return;
  state.wheel.busy = true;

  try {
    handleWheelValues(await readReport('wheelValues'));
  } catch (error) {
    stopWheelStreaming();
    setWheelStatus(`Streaming gestoppt: ${error.message}`, 'error');
  } finally {
    state.wheel.busy = false;
  }
}

function startWheelStreaming() {
  if (!canRead('wheelValues')) return;

  state.wheel.streaming = true;
  $('btn-wheel-stream').textContent = 'Streaming stoppen';
  setWheelStatus('Streaming aktiv …', 'busy');

  // Input-Reports liefert das Gerät von sich aus.
  if (reportKind('wheelValues') === 'input') return;

  const rate = clamp(toInt($('wheel-rate').value, 5), 1, 100);
  state.wheel.timer = window.setInterval(pollWheelValues, 1000 / rate);
}

function stopWheelStreaming() {
  if (!state.wheel.streaming) return;

  state.wheel.streaming = false;
  $('btn-wheel-stream').textContent = 'Streaming starten';

  if (state.wheel.timer !== null) {
    window.clearInterval(state.wheel.timer);
    state.wheel.timer = null;
  }

  setWheelStatus('Streaming gestoppt', 'idle');
}

function clearWheelData() {
  const wheel = state.wheel;

  wheel.samples = 0;
  ['time', 'angleRaw', 'angleCal', 'xRaw', 'yRaw', 'xCal', 'yCal']
    .forEach((key) => { wheel[key] = []; });

  wheel.angleRange = null;
  wheel.xyRange    = null;

  drawAngleChart();
  drawXyChart();
  setWheelStatus('Daten gelöscht', 'idle');
}

// ─── Scrollrad: Kalibrierung ──────────────────────────

const CAL_FIELDS = [
  'cal-offset-x', 'cal-offset-z', 'cal-ampl-x',
  'cal-ampl-z', 'cal-press', 'cal-angle'
];

async function loadCalibration(silent) {
  if (!silent) setWheelStatus('Kalibrierdaten werden gelesen …', 'busy');

  try {
    const value = await readReport('wheelCalib');

    if (value.byteLength < 14) {
      throw new Error(`14 Bytes erwartet, ${value.byteLength} empfangen`);
    }

    const stored = {
      'cal-offset-x': value.getInt16(0, true),
      'cal-offset-z': value.getInt16(2, true),
      'cal-ampl-x':   value.getInt16(4, true),
      'cal-ampl-z':   value.getInt16(6, true),
      'cal-angle':    value.getInt16(8, true),
      'cal-press':    Math.round(value.getFloat32(10, true) * 1000)
    };

    state.wheel.stored = stored;
    CAL_FIELDS.forEach((id) => { $(id).value = stored[id]; });
    updateCalibrationColors();

    setWheelStatus('Kalibrierwerte aus dem Flash geladen', 'ok');
    addLog(
      `[RX]  Kalibrierung: OffX=${stored['cal-offset-x']}, ` +
      `OffZ=${stored['cal-offset-z']}, AmplX=${stored['cal-ampl-x']}, ` +
      `AmplZ=${stored['cal-ampl-z']}, Winkel=${stored['cal-angle']}, ` +
      `Press=${stored['cal-press']}`
    );
  } catch (error) {
    if (!silent) {
      setWheelStatus(`Lesen fehlgeschlagen: ${error.message}`, 'error');
    }
    addLog(`[ERR] Kalibrierung lesen: ${error.message}`);
  }
}

function updateCalibrationColors() {
  const stored = state.wheel.stored;

  CAL_FIELDS.forEach((id) => {
    const field = $(id);
    const match = stored !== null &&
      toInt(field.value, NaN) === stored[id];

    field.classList.toggle('is-stored', match);
  });
}

async function startCalibration() {
  const confirmed = window.confirm(
    'Eine neue Kalibrierung überschreibt die vorhandenen Kalibrierwerte ' +
    'auf der Maus. Fortfahren?'
  );
  if (!confirmed) return;

  const buffer = new ArrayBuffer(14);
  new DataView(buffer).setInt16(0, -1, true);

  setWheelStatus('Kalibrierung gestartet – Rad um 360° drehen …', 'busy');

  try {
    await writeReport('wheelCalib', buffer);
    addLog('[TX]  Kalibrierbefehl gesendet');
    setWheelStatus('Kalibrierung abgeschlossen', 'ok');
    await loadCalibration(true);
  } catch (error) {
    setWheelStatus(`Kalibrierung fehlgeschlagen: ${error.message}`, 'error');
    addLog(`[ERR] Kalibrierung: ${error.message}`);
  }
}

function resetCalibrationFields() {
  CAL_FIELDS.forEach((id) => { $(id).value = '0'; });
  updateCalibrationColors();
  setWheelStatus('Kalibrierfelder auf 0 zurückgesetzt', 'idle');
}

async function uploadCalibration() {
  const confirmed = window.confirm(
    'Sollen diese Werte wirklich hochgeladen werden? ' +
    'Die aktuelle Kalibrierung auf der Maus wird überschrieben.'
  );
  if (!confirmed) return;

  const offsetX = clamp(toInt($('cal-offset-x').value, 0), -32768, 32767);
  const offsetZ = clamp(toInt($('cal-offset-z').value, 0), -32768, 32767);
  const amplX   = clamp(toInt($('cal-ampl-x').value, 0), -32768, 32767);
  const amplZ   = clamp(toInt($('cal-ampl-z').value, 0), -32768, 32767);
  const angle   = clamp(toInt($('cal-angle').value, 0), -180, 180);
  const press   = clamp(toInt($('cal-press').value, 0), 0, 10000) / 1000;

  const buffer = new ArrayBuffer(14);
  const view   = new DataView(buffer);

  view.setInt16(0, offsetX, true);
  view.setInt16(2, offsetZ, true);
  view.setInt16(4, amplX, true);
  view.setInt16(6, amplZ, true);
  view.setInt16(8, angle, true);
  view.setFloat32(10, press, true);

  setWheelStatus('Kalibrierwerte werden übertragen …', 'busy');

  try {
    await writeReport('wheelCalib', buffer);

    state.wheel.stored = {
      'cal-offset-x': offsetX,
      'cal-offset-z': offsetZ,
      'cal-ampl-x':   amplX,
      'cal-ampl-z':   amplZ,
      'cal-angle':    angle,
      'cal-press':    Math.round(press * 1000)
    };
    updateCalibrationColors();

    setWheelStatus('Kalibrierwerte gespeichert', 'ok');
    addLog(
      `[TX]  Kalibrierung: OffX=${offsetX}, OffZ=${offsetZ}, ` +
      `AmplX=${amplX}, AmplZ=${amplZ}, Winkel=${angle}, ` +
      `Press=${press.toFixed(3)}`
    );
  } catch (error) {
    setWheelStatus(`Upload fehlgeschlagen: ${error.message}`, 'error');
    addLog(`[ERR] Kalibrierung schreiben: ${error.message}`);
  }
}

// ─── Diagramme ────────────────────────────────────────

function prepareCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect  = canvas.getBoundingClientRect();
  const width  = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width  = width * ratio;
    canvas.height = height * ratio;
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  return { ctx, width, height };
}

const PLOT_PADDING = { left: 46, right: 12, top: 12, bottom: 26 };

function drawGrid(ctx, width, height, xRange, yRange) {
  const { left, right, top, bottom } = PLOT_PADDING;
  const plotWidth  = width - left - right;
  const plotHeight = height - top - bottom;

  ctx.fillStyle = '#101113';
  ctx.fillRect(left, top, plotWidth, plotHeight);

  ctx.strokeStyle = IFX.grid;
  ctx.lineWidth   = 1;
  ctx.fillStyle   = IFX.text;
  ctx.font        = '10px "Cascadia Mono", Consolas, monospace';

  for (let i = 0; i <= 4; i++) {
    const y = top + (plotHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + plotWidth, y);
    ctx.stroke();

    const value = yRange.max - ((yRange.max - yRange.min) * i) / 4;
    ctx.textAlign = 'right';
    ctx.fillText(formatTick(value), left - 6, y + 3);
  }

  for (let i = 0; i <= 4; i++) {
    const x = left + (plotWidth * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + plotHeight);
    ctx.stroke();

    const value = xRange.min + ((xRange.max - xRange.min) * i) / 4;
    ctx.textAlign = 'center';
    ctx.fillText(formatTick(value), x, height - 8);
  }

  ctx.strokeStyle = '#3a3d42';
  ctx.strokeRect(left, top, plotWidth, plotHeight);
}

function formatTick(value) {
  if (!Number.isFinite(value)) return '0';
  return Math.abs(value) >= 1000
    ? value.toFixed(0)
    : value.toFixed(Math.abs(value) < 10 ? 1 : 0);
}

function projector(width, height, xRange, yRange) {
  const { left, right, top, bottom } = PLOT_PADDING;
  const plotWidth  = width - left - right;
  const plotHeight = height - top - bottom;

  const spanX = (xRange.max - xRange.min) || 1;
  const spanY = (yRange.max - yRange.min) || 1;

  return (x, y) => [
    left + ((x - xRange.min) / spanX) * plotWidth,
    top + plotHeight - ((y - yRange.min) / spanY) * plotHeight
  ];
}

function computeRange(values, fallbackMin, fallbackMax) {
  if (values.length === 0) return { min: fallbackMin, max: fallbackMax };

  let min = Infinity;
  let max = -Infinity;

  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (min === max) {
    min -= 1;
    max += 1;
  }

  const margin = (max - min) * 0.08;
  return { min: min - margin, max: max + margin };
}

function drawSeries(ctx, points, project, color) {
  if (points.length === 0) return;

  ctx.strokeStyle = color;
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.beginPath();

  points.forEach(([x, y], index) => {
    const [px, py] = project(x, y);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });

  ctx.stroke();
}

function drawAngleChart() {
  const canvas = $('chart-angle');
  if (!canvas) return;

  const { ctx, width, height } = prepareCanvas(canvas);
  const wheel = state.wheel;

  const time = wheel.time.slice(-DISPLAY_LIMIT);
  const raw  = wheel.angleRaw.slice(-DISPLAY_LIMIT);
  const cal  = wheel.angleCal.slice(-DISPLAY_LIMIT);

  const xRange = time.length > 1
    ? { min: time[0], max: time[time.length - 1] }
    : { min: 0, max: DISPLAY_LIMIT };

  let yRange;
  if ($('wheel-autoscale').checked || wheel.angleRange === null) {
    yRange = computeRange(raw.concat(cal), -180, 180);
    wheel.angleRange = yRange;
  } else {
    yRange = wheel.angleRange;
  }

  drawGrid(ctx, width, height, xRange, yRange);

  const project = projector(width, height, xRange, yRange);
  drawSeries(ctx, raw.map((v, i) => [time[i], v]), project, IFX.red);
  drawSeries(ctx, cal.map((v, i) => [time[i], v]), project, IFX.ocean);
}

function drawXyChart() {
  const canvas = $('chart-xy');
  if (!canvas) return;

  const { ctx, width, height } = prepareCanvas(canvas);
  const wheel = state.wheel;

  const allX = wheel.xRaw.concat(wheel.xCal);
  const allY = wheel.yRaw.concat(wheel.yCal);

  let range;
  if ($('wheel-autoscale').checked || wheel.xyRange === null) {
    const rangeX = computeRange(allX, -1000, 1000);
    const rangeY = computeRange(allY, -1000, 1000);

    // Seitenverhältnis 1:1 wie im Desktop-Werkzeug
    const centerX = (rangeX.min + rangeX.max) / 2;
    const centerY = (rangeY.min + rangeY.max) / 2;
    const span = Math.max(
      rangeX.max - rangeX.min, rangeY.max - rangeY.min) / 2;

    range = {
      x: { min: centerX - span, max: centerX + span },
      y: { min: centerY - span, max: centerY + span }
    };
    wheel.xyRange = range;
  } else {
    range = wheel.xyRange;
  }

  drawGrid(ctx, width, height, range.x, range.y);

  const project = projector(width, height, range.x, range.y);
  drawPoints(ctx, wheel.xRaw, wheel.yRaw, project, IFX.red);
  drawPoints(ctx, wheel.xCal, wheel.yCal, project, IFX.ocean);
}

function drawPoints(ctx, xs, ys, project, color) {
  ctx.fillStyle = color;

  for (let i = 0; i < xs.length && i < ys.length; i++) {
    const [px, py] = project(xs[i], ys[i]);
    ctx.beginPath();
    ctx.arc(px, py, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Statusanzeigen ───────────────────────────────────

function setStatus(connected, message) {
  const dot = $('status-dot');
  if (dot) {
    dot.className = 'status-dot ' +
      (connected ? 'connected' : 'disconnected');
  }

  const text = $('status-text');
  if (text) text.textContent = message;
}

function setStatusLine(elementId, message, kind) {
  const element = $(elementId);
  if (!element) return;

  element.textContent = message;
  element.className   = `status-line is-${kind || 'idle'}`;
}

function setDeviceStatus(message, kind) {
  setStatusLine('device-status', message, kind);
}

function setButtonsStatus(message, kind) {
  setStatusLine('buttons-status', message, kind);
}

function setWheelStatus(message, kind) {
  setStatusLine('wheel-status', message, kind);
}

function setAdvancedStatus(message, kind) {
  setStatusLine('advanced-status', message, kind);
}

const CARD_IDS = [
  'device-card', 'buttons-card', 'wheel-card', 'advanced-card'
];

function showCards() {
  CARD_IDS.forEach(id => $(id).classList.remove('hidden'));
  window.requestAnimationFrame(() => {
    drawAngleChart();
    drawXyChart();
  });
}

function hideCards() {
  CARD_IDS.forEach(id => $(id).classList.add('hidden'));
}

function addLog(message) {
  const box = $('log-box');
  if (!box) return;

  const time  = new Date().toLocaleTimeString('de-DE');
  const entry = document.createElement('div');
  entry.textContent = `[${time}] ${message}`;

  box.appendChild(entry);
  box.scrollTop = box.scrollHeight;
}

function clearLog() {
  $('log-box').textContent = '';
}

// ─── Navigation ───────────────────────────────────────

const SECTION_IDS = [
  'device-card', 'buttons-card', 'wheel-card', 'advanced-card', 'log-card'
];

function initNavigation() {
  const links = document.querySelectorAll('.ifx-nav-item');

  links.forEach((link) => {
    link.addEventListener('click', (event) => {
      const id     = link.getAttribute('href').slice(1);
      const target = $(id);
      if (!target) return;

      event.preventDefault();

      SECTION_IDS.forEach((sectionId) => {
        const section = $(sectionId);
        if (section) section.open = (sectionId === id);
      });

      links.forEach(item =>
        item.classList.toggle('is-active', item === link));

      window.requestAnimationFrame(() => {
        drawAngleChart();
        drawXyChart();
      });

      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ─── Ereignisbindung ──────────────────────────────────

function initControls() {
  state.reportIds = loadReportIds();
  renderReportMap();
  renderReportStatus();

  try {
    const stored = window.localStorage.getItem(AUTOCONNECT_KEY);
    if (stored !== null) $('opt-autoconnect').checked = stored === '1';
  } catch (error) {
    console.warn('localStorage nicht verfügbar:', error);
  }

  $('opt-autoconnect').addEventListener('change', () => {
    try {
      window.localStorage.setItem(
        AUTOCONNECT_KEY, $('opt-autoconnect').checked ? '1' : '0');
    } catch (error) {
      console.warn('localStorage nicht verfügbar:', error);
    }
  });

  $('btn-connect').addEventListener('click', connect);
  $('btn-disconnect').addEventListener('click', disconnect);
  $('btn-refresh-known').addEventListener('click', autoConnect);
  $('btn-save-uuids').addEventListener('click', saveReportIds);
  $('btn-reset-uuids').addEventListener('click', resetReportIds);

  // LED
  $('btn-led-send').addEventListener('click', () => {
    const [r, g, b] = hexToRgb($('led-color').value);
    sendLedColor(r, g, b);
  });

  document.querySelectorAll('.chip[data-led]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const [r, g, b] = chip.dataset.led.split(',').map(Number);
      sendLedColor(r, g, b);
    });
  });

  // DPI
  $('dpi-slider').addEventListener('input', () => {
    const value = toInt($('dpi-slider').value, 800);
    $('dpi-value').value = value;
    scheduleDpi(value);
  });

  $('dpi-value').addEventListener('change', () => {
    const value = clamp(toInt($('dpi-value').value, 800), 400, 3200);
    $('dpi-value').value  = value;
    $('dpi-slider').value = value;
    sendDpi(value);
  });

  // Tasten
  ['left', 'right'].forEach((side) => {
    const bar = createPressBar($(`press-${side}`));
    pressBars[side] = bar;

    bar.onChange = (threshold) => {
      state.sensors[sensorKey(side)].threshold = threshold;
      $(`${side}-threshold`).value = threshold;
    };

    $(`${side}-sensor`).addEventListener('change', () => {
      syncSensorUi(side);
      setButtonsStatus(
        `${side === 'left' ? 'Linke' : 'Rechte'} Taste: Sensor gewechselt`,
        'idle');
    });

    $(`${side}-threshold`).addEventListener('input', () => {
      const value = clamp(toInt($(`${side}-threshold`).value, 0), 0, 127);
      state.sensors[sensorKey(side)].threshold = value;
      bar.setThreshold(value);
    });
  });

  $('btn-buttons-read').addEventListener('click', readButtonConfig);
  $('btn-buttons-apply').addEventListener('click', applyButtonConfig);

  $('btn-buttons-monitor').addEventListener('click', () => {
    if (state.buttons.monitoring) stopButtonMonitoring();
    else startButtonMonitoring();
  });

  // Scrollrad
  $('btn-wheel-stream').addEventListener('click', () => {
    if (state.wheel.streaming) stopWheelStreaming();
    else startWheelStreaming();
  });

  $('btn-wheel-clear').addEventListener('click', clearWheelData);

  $('wheel-rate').addEventListener('change', () => {
    const rate = clamp(toInt($('wheel-rate').value, 5), 1, 100);
    $('wheel-rate').value = rate;

    if (state.wheel.streaming && state.wheel.timer !== null) {
      window.clearInterval(state.wheel.timer);
      state.wheel.timer = window.setInterval(pollWheelValues, 1000 / rate);
    }
  });

  $('btn-cal-load').addEventListener('click', () => loadCalibration(false));
  $('btn-cal-start').addEventListener('click', startCalibration);
  $('btn-cal-reset').addEventListener('click', resetCalibrationFields);
  $('btn-cal-upload').addEventListener('click', uploadCalibration);

  CAL_FIELDS.forEach((id) => {
    $(id).addEventListener('input', updateCalibrationColors);
  });

  // Erweitert
  $('btn-sensor-apply').addEventListener('click', applySensorSwitches);
  $('btn-trigger-apply').addEventListener('click', applyTriggers);

  ['left', 'right'].forEach((side) => {
    const slider = $(`trigger-${side}`);
    const number = $(`trigger-${side}-value`);

    slider.addEventListener('input', () => { number.value = slider.value; });
    number.addEventListener('input', () => {
      slider.value = clamp(toInt(number.value, 0), 0, 255);
    });
  });

  $('btn-clear-log').addEventListener('click', clearLog);

  window.addEventListener('resize', () => {
    drawAngleChart();
    drawXyChart();
  });
}

// ─── Start ────────────────────────────────────────────

window.addEventListener('load', async () => {
  initNavigation();
  initControls();

  setLedVisual(0, 0, 0);
  drawAngleChart();
  drawXyChart();

  if (!navigator.hid) {
    setStatus(false, 'Web HID wird von diesem Browser nicht unterstützt');
    $('btn-connect').disabled = true;
    $('btn-refresh-known').disabled = true;
    setConnectError(
      'Web HID steht nur in Chromium-basierten Browsern zur Verfügung ' +
      '(Chrome, Edge, Opera) und benötigt HTTPS oder localhost.'
    );
    addLog('[!]   Web HID nicht verfügbar – bitte Chrome, Edge oder Opera verwenden');
    return;
  }

  if (!window.isSecureContext) {
    addLog('[!]   Unsicherer Kontext – Web HID benötigt HTTPS oder localhost');
  }

  navigator.hid.addEventListener('connect', onHidConnect);
  navigator.hid.addEventListener('disconnect', onHidDisconnect);

  addLog('[OK]  Bereit – suche nach bereits freigegebenen Geräten');
  await autoConnect();
});

window.addEventListener('beforeunload', () => {
  stopButtonMonitoring();
  stopWheelStreaming();
});
