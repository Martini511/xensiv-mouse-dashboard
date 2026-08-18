'use strict';

/* ═══════════════════════════════════════════════════════
   XENSIV™ Maus – Web-Bluetooth-Konfigurator
   Protokoll und Datenformate gemäß XENSIV_Mouse_GUI v1.1
   ═══════════════════════════════════════════════════════ */

// ─── GATT-Charakteristiken ────────────────────────────

const CHAR_UUID = {
  led:          '0473bf09-18c9-4a38-85dd-471f6a86fc00',
  dpi:          '9c819277-5948-4ae0-9c12-d3499b7fe7ec',
  buttons:      'cfc2a291-bcaf-45d8-894c-ba16f55f699e',
  buttonPress:  '9c5056ff-7325-4217-892d-165d5783b96d',
  sensorLeft:   '45644dda-0f5a-4c8c-a735-788dbe4c47a9',
  sensorRight:  '872509b3-ea57-4a08-a8ed-dcf6252b2122',
  triggerLeft:  '134aa35b-3dd8-4870-95aa-b4be77b497f0',
  triggerRight: '52ce17fe-2489-4323-aa0c-e2006009564a',
  wheelCalib:   'bfef758d-2219-4b11-a708-124de6abcfa1',
  wheelValues:  'ca4ca348-ece0-4f47-be09-507d7dfc46f2',
  battery:      '00002a19-0000-1000-8000-00805f9b34fb'
};

const CHAR_LABEL = {
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

const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb';
const STORAGE_KEY          = 'xensiv.serviceUuids';
const DEVICE_KEY           = 'xensiv.deviceId';
const AUTOCONNECT_KEY      = 'xensiv.autoConnect';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
  server:    null,
  chars:     {},
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
    busy:       false,
    notifying:  false
  },

  wheel: {
    streaming:  false,
    timer:      null,
    busy:       false,
    notifying:  false,
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

// ─── GATT-Warteschlange ───────────────────────────────
// Web Bluetooth erlaubt nur eine GATT-Operation gleichzeitig.

let gattChain = Promise.resolve();

function gattQueue(task) {
  const result = gattChain.then(task, task);
  gattChain = result.then(() => {}, () => {});
  return result;
}

function hasChar(key) {
  return Boolean(state.chars[key]);
}

function requireChar(key) {
  const characteristic = state.chars[key];
  if (!characteristic) {
    throw new Error(
      `GATT-Merkmal „${CHAR_LABEL[key]}“ ist auf diesem Gerät nicht verfügbar`
    );
  }
  return characteristic;
}

function writeChar(key, data) {
  const characteristic = requireChar(key);

  return gattQueue(() => {
    const props = characteristic.properties;

    if (!props.write && props.writeWithoutResponse) {
      return characteristic.writeValueWithoutResponse
        ? characteristic.writeValueWithoutResponse(data)
        : characteristic.writeValue(data);
    }

    return characteristic.writeValueWithResponse
      ? characteristic.writeValueWithResponse(data)
      : characteristic.writeValue(data);
  });
}

function readChar(key) {
  const characteristic = requireChar(key);
  return gattQueue(() => characteristic.readValue());
}

// ─── Dienst-UUIDs ─────────────────────────────────────

function loadServiceUuids() {
  let stored = null;

  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('localStorage nicht verfügbar:', error);
  }

  return stored === null ? BATTERY_SERVICE_UUID : stored;
}

function parseServiceUuids(text) {
  return text
    .split(/[\s,;]+/)
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry.length > 0)
    .filter(entry => UUID_PATTERN.test(entry));
}

function collectOptionalServices() {
  // Zusätzlich zu den konfigurierten Dienst-UUIDs werden die bekannten
  // Merkmals-UUIDs angemeldet. Manche Firmware-Varianten verwenden
  // dieselbe UUID für Dienst und Merkmal.
  const configured = parseServiceUuids($('service-uuids').value);
  const candidates = new Set([
    BATTERY_SERVICE_UUID,
    ...configured,
    ...Object.values(CHAR_UUID)
  ]);

  return Array.from(candidates);
}

function saveServiceUuids() {
  const text = $('service-uuids').value;
  const list = parseServiceUuids(text);

  try {
    window.localStorage.setItem(STORAGE_KEY, list.join('\n'));
  } catch (error) {
    console.warn('localStorage nicht verfügbar:', error);
  }

  $('service-uuids').value = list.join('\n');
  addLog(`[CFG] ${list.length} Dienst-UUID(s) gespeichert`);
}

// ─── Verbindungsaufbau ────────────────────────────────

const CONNECT_ATTEMPTS = 4;

function wait(milliseconds) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

function describeBluetoothError(error) {
  const name = (error && error.name) || 'Error';

  switch (name) {
    case 'NetworkError':
      return 'Die Maus hat die GATT-Verbindung abgelehnt oder war nicht erreichbar. ' +
             'Bitte prüfen: (1) Ist die Maus in den Windows-Bluetooth-Einstellungen ' +
             'gekoppelt und eingeschaltet? (2) Ist das Desktop-Tool „XENSIV Mouse ' +
             'Control“ oder ein anderes Programm noch geöffnet? Dieses muss geschlossen ' +
             'werden. (3) Hilft sonst: Maus in den Windows-Einstellungen entfernen und ' +
             'neu koppeln oder Bluetooth kurz aus- und einschalten.';
    case 'SecurityError':
      return 'Der Zugriff wurde vom Browser blockiert. Web Bluetooth benötigt HTTPS oder ' +
             'localhost, und es dürfen keine gesperrten Dienst-UUIDs angemeldet werden.';
    case 'NotSupportedError':
      return 'Das Gerät unterstützt die angeforderte GATT-Operation nicht.';
    case 'InvalidStateError':
      return 'Der Bluetooth-Adapter befindet sich in einem ungültigen Zustand. ' +
             'Bitte Bluetooth aus- und wieder einschalten.';
    case 'NotFoundError':
      return 'Das Gerät oder der angeforderte GATT-Dienst wurde nicht gefunden.';
    default:
      return (error && error.message) || String(error);
  }
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

async function connectGatt(device) {
  let lastError = null;

  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
    try {
      setStatus(false,
        `Verbinde mit ${device.name || 'Gerät'} … ` +
        `(Versuch ${attempt}/${CONNECT_ATTEMPTS})`);

      const server = await device.gatt.connect();

      if (attempt > 1) {
        addLog(`[OK]  Verbindung im Versuch ${attempt} hergestellt`);
      }
      return server;
    } catch (error) {
      lastError = error;
      addLog(
        `[!]   Verbindungsversuch ${attempt} fehlgeschlagen: ` +
        `${error.name} – ${error.message}`
      );

      // Windows benötigt nach einem Fehlversuch einen sauberen Reset
      try {
        device.gatt.disconnect();
      } catch (ignored) {
        // Verbindung war ohnehin nicht offen
      }

      if (attempt < CONNECT_ATTEMPTS) await wait(600 * attempt);
    }
  }

  throw lastError;
}

async function connectToDevice(device, options) {
  const settings = options || {};

  setConnectError('');
  $('btn-connect').disabled = true;

  state.device = device;
  device.removeEventListener('gattserverdisconnected', onDisconnected);
  device.addEventListener('gattserverdisconnected', onDisconnected);

  try {
    state.server = await connectGatt(device);

    // Windows benötigt nach dem Verbindungsaufbau kurz Zeit,
    // bevor die GATT-Dienste bereitstehen.
    await wait(300);
    await discoverCharacteristics();

    state.connected = true;
    $('btn-disconnect').disabled = false;
    $('device-meta').classList.remove('hidden');
    $('device-name').textContent = device.name || device.id || '–';

    rememberDevice(device);
    setStatus(true, `Verbunden – ${device.name || 'XENSIV Maus'}`);
    addLog(`[OK]  Verbunden mit ${device.name || device.id}`);

    showCards();
    updateAvailability();
    await refreshKnownDevices();

    await refreshBattery();
    state.batteryTimer = window.setInterval(refreshBattery, 10000);

    if (hasChar('buttons')) await readButtonConfig();
    if (hasChar('wheelCalib')) await loadCalibration(true);

    return true;
  } catch (error) {
    $('btn-connect').disabled = false;

    setStatus(false, `Verbindung fehlgeschlagen (${error.name})`);
    addLog(`[ERR] ${error.name}: ${error.message}`);

    try {
      device.gatt.disconnect();
    } catch (ignored) {
      // Verbindung war ohnehin nicht offen
    }

    if (settings.silent) return false;

    setConnectError(describeBluetoothError(error));
    $('log-card').open = true;
    return false;
  }
}

async function connect() {
  if (!navigator.bluetooth) {
    setStatus(false, 'Web Bluetooth wird von diesem Browser nicht unterstützt');
    addLog('[!]   Web Bluetooth nicht verfügbar');
    return;
  }

  const optionalServices = collectOptionalServices();
  const acceptAll        = $('opt-all-devices').checked;

  const options = acceptAll
    ? { acceptAllDevices: true, optionalServices }
    : { filters: [{ namePrefix: 'XENSIV' }], optionalServices };

  setConnectError('');
  $('btn-connect').disabled = true;

  let device = null;

  try {
    setStatus(false, 'Geräteauswahl geöffnet …');
    addLog('[BLE] Geräteauswahl geöffnet');
    device = await navigator.bluetooth.requestDevice(options);
  } catch (error) {
    $('btn-connect').disabled = false;
    setStatus(false, 'Keine Maus ausgewählt');
    addLog(`[!]   Geräteauswahl beendet: ${error.name} – ${error.message}`);

    if (error.name === 'SecurityError') {
      setConnectError(describeBluetoothError(error));
    }
    return;
  }

  await connectToDevice(device);
}

// ─── Bereits freigegebene Geräte ──────────────────────
// navigator.bluetooth.getDevices() liefert alle Geräte, für die diese
// Seite bereits eine Berechtigung besitzt. Damit wird die vom
// Betriebssystem gekoppelte Maus ohne erneuten Auswahldialog erkannt.

function supportsKnownDevices() {
  return Boolean(navigator.bluetooth) &&
    typeof navigator.bluetooth.getDevices === 'function';
}

function rememberDevice(device) {
  try {
    window.localStorage.setItem(DEVICE_KEY, device.id);
  } catch (error) {
    console.warn('localStorage nicht verfügbar:', error);
  }
}

function preferredDeviceId() {
  try {
    return window.localStorage.getItem(DEVICE_KEY);
  } catch (error) {
    return null;
  }
}

async function getKnownDevices() {
  if (!supportsKnownDevices()) return [];

  try {
    return await navigator.bluetooth.getDevices();
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
    const item = document.createElement('div');
    item.className = 'known-item';

    const info = document.createElement('div');
    info.className = 'known-item-info';

    const name = document.createElement('span');
    name.className = 'known-item-name';
    name.textContent = device.name || 'Unbenanntes Gerät';

    const meta = document.createElement('span');
    meta.className = 'known-item-meta';
    meta.textContent = state.connected && state.device &&
      state.device.id === device.id
      ? 'verbunden'
      : 'freigegeben – bereit zum Verbinden';

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
  if (!supportsKnownDevices()) {
    const hint =
      'Dieser Browser stellt die Liste bereits freigegebener Geräte nicht bereit. ' +
      'In Chrome und Edge lässt sich die dauerhafte Erkennung unter ' +
      'chrome://flags/#enable-web-bluetooth-new-permissions-backend aktivieren. ' +
      'Ohne diese Option bitte einmal pro Sitzung „Maus suchen & freigeben“ verwenden.';

    setConnectError(hint, 'busy');
    addLog('[!]   Dauerhafte Geräteerkennung in diesem Browser nicht verfügbar');
    return;
  }

  const devices = await refreshKnownDevices();
  if (devices.length === 0) {
    addLog('[BLE] Noch kein Gerät freigegeben – bitte einmalig auswählen');
    return;
  }

  addLog(`[BLE] ${devices.length} bereits freigegebene(s) Gerät(e) gefunden`);

  if (!$('opt-autoconnect').checked) return;

  const preferred = preferredDeviceId();
  const device = devices.find(entry => entry.id === preferred) || devices[0];

  setStatus(false, `Verbinde automatisch mit ${device.name || 'Gerät'} …`);
  const connected = await connectToDevice(device, { silent: true });

  if (connected) return;

  // Die Maus ist gerade nicht erreichbar – auf ihre nächste
  // Bluetooth-Werbung warten und dann erneut verbinden.
  await waitForAdvertisement(device);
}

async function waitForAdvertisement(device) {
  if (typeof device.watchAdvertisements !== 'function') {
    setStatus(false, 'Maus nicht erreichbar – bitte einschalten und erneut verbinden');
    return;
  }

  try {
    const onAdvertisement = async () => {
      device.removeEventListener('advertisementreceived', onAdvertisement);
      addLog('[BLE] Maus meldet sich – Verbindung wird aufgebaut');
      await connectToDevice(device);
    };

    device.addEventListener('advertisementreceived', onAdvertisement);
    await device.watchAdvertisements();

    setStatus(false, 'Warte auf die Maus – bitte einschalten oder bewegen');
    addLog('[BLE] Warte auf Bluetooth-Werbung der Maus');
  } catch (error) {
    setStatus(false, 'Maus nicht erreichbar – bitte erneut verbinden');
    addLog(`[!]   Warten auf Werbung nicht möglich: ${error.name}`);
  }
}

async function discoverCharacteristics() {
  state.chars = {};

  let services = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      services = await state.server.getPrimaryServices();
      break;
    } catch (error) {
      addLog(`[!]   Dienstsuche fehlgeschlagen: ${error.name} – ${error.message}`);
      if (attempt === 1) await wait(500);
    }
  }

  for (const service of services) {
    let characteristics = [];
    try {
      characteristics = await service.getCharacteristics();
    } catch (error) {
      continue;
    }

    for (const characteristic of characteristics) {
      const uuid = characteristic.uuid.toLowerCase();
      for (const [key, knownUuid] of Object.entries(CHAR_UUID)) {
        if (uuid === knownUuid) state.chars[key] = characteristic;
      }
    }
  }

  const found = Object.keys(state.chars).length;
  const total = Object.keys(CHAR_UUID).length;

  $('feature-count').textContent = `${found} von ${total}`;
  renderCharReport();

  addLog(
    `[BLE] ${services.length} Dienst(e), ${found}/${total} bekannte Merkmale`
  );

  if (found === 0) {
    $('uuid-panel').open = true;
    addLog(
      '[!]   Kein bekanntes Merkmal gefunden – bitte Dienst-UUID hinterlegen'
    );
  }
}

function renderCharReport() {
  const list = $('char-report');
  list.innerHTML = '';

  for (const [key, label] of Object.entries(CHAR_LABEL)) {
    const item = document.createElement('li');
    const available = hasChar(key);

    item.className = 'char-item ' + (available ? 'is-ok' : 'is-missing');
    item.textContent = `${label} – ${available ? 'verfügbar' : 'nicht gefunden'}`;
    item.title = CHAR_UUID[key];

    list.appendChild(item);
  }
}

function updateAvailability() {
  const map = [
    ['btn-led-send',      'led'],
    ['btn-buttons-read',  'buttons'],
    ['btn-buttons-apply', 'buttons'],
    ['btn-buttons-monitor', 'buttonPress'],
    ['btn-wheel-stream',  'wheelValues'],
    ['btn-cal-load',      'wheelCalib'],
    ['btn-cal-start',     'wheelCalib'],
    ['btn-cal-upload',    'wheelCalib'],
    ['btn-sensor-apply',  'sensorLeft'],
    ['btn-trigger-apply', 'triggerLeft']
  ];

  map.forEach(([elementId, charKey]) => {
    const element = $(elementId);
    if (!element) return;

    element.disabled = !hasChar(charKey);
    element.title = hasChar(charKey)
      ? ''
      : `Merkmal „${CHAR_LABEL[charKey]}“ nicht verfügbar`;
  });

  document.querySelectorAll('.chip[data-led]').forEach((chip) => {
    chip.disabled = !hasChar('led');
  });

  $('dpi-slider').disabled = !hasChar('dpi');
  $('dpi-value').disabled  = !hasChar('dpi');
}

async function disconnect() {
  stopButtonMonitoring();
  stopWheelStreaming();

  if (state.device && state.device.gatt.connected) {
    state.device.gatt.disconnect();
  } else {
    onDisconnected();
  }
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

  state.connected = false;
  state.server    = null;
  state.chars     = {};

  $('btn-disconnect').disabled = true;
  $('device-meta').classList.add('hidden');
  $('battery-value').textContent = '–';

  setStatus(false, 'Verbindung getrennt');
  addLog('[!]   Verbindung zum Gerät getrennt');
  hideCards();
  refreshKnownDevices();
}

// ─── Batteriestand ────────────────────────────────────

async function refreshBattery() {
  if (!state.connected || !hasChar('battery')) {
    $('battery-value').textContent = 'nicht verfügbar';
    return;
  }

  try {
    const value = await readChar('battery');
    $('battery-value').textContent = `${value.getUint8(0)} %`;
  } catch (error) {
    $('battery-value').textContent = 'Lesefehler';
  }
}

// ─── LED-Steuerung ────────────────────────────────────

async function sendLedColor(red, green, blue) {
  try {
    await writeChar('led', new Uint8Array([red, green, blue]));
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
    await writeChar('dpi', buffer);
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
    const value = await readChar('buttons');

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
    await writeChar('buttons', data);

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

function onPressNotification(event) {
  handlePressValues(event.target.value);
}

async function pollPressValues() {
  if (state.buttons.busy) return;
  state.buttons.busy = true;

  try {
    handlePressValues(await readChar('buttonPress'));
  } catch (error) {
    stopButtonMonitoring();
    setButtonsStatus(`Überwachung gestoppt: ${error.message}`, 'error');
  } finally {
    state.buttons.busy = false;
  }
}

async function startButtonMonitoring() {
  const characteristic = state.chars.buttonPress;
  if (!characteristic) return;

  state.buttons.monitoring = true;
  $('btn-buttons-monitor').textContent = 'Überwachung stoppen';
  setButtonsStatus('Überwachung aktiv …', 'busy');

  if (characteristic.properties.notify) {
    try {
      await gattQueue(() => characteristic.startNotifications());
      characteristic.addEventListener(
        'characteristicvaluechanged', onPressNotification);
      state.buttons.notifying = true;
      return;
    } catch (error) {
      addLog(`[!]   Benachrichtigungen nicht möglich: ${error.message}`);
    }
  }

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

  const characteristic = state.chars.buttonPress;
  if (state.buttons.notifying && characteristic) {
    characteristic.removeEventListener(
      'characteristicvaluechanged', onPressNotification);
    gattQueue(() => characteristic.stopNotifications()).catch(() => {});
    state.buttons.notifying = false;
  }

  setButtonsStatus('Überwachung gestoppt', 'idle');
}

// ─── Sensor-Schalter und Trigger ──────────────────────

async function applySensorSwitches() {
  const left  = $('sensor-left').checked ? 1 : 0;
  const right = $('sensor-right').checked ? 1 : 0;

  try {
    await writeChar('sensorLeft', new Uint8Array([left]));
    await writeChar('sensorRight', new Uint8Array([right]));

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
    await writeChar('triggerLeft', new Uint8Array([left]));
    await writeChar('triggerRight', new Uint8Array([right]));

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

function onWheelNotification(event) {
  handleWheelValues(event.target.value);
}

async function pollWheelValues() {
  if (state.wheel.busy) return;
  state.wheel.busy = true;

  try {
    handleWheelValues(await readChar('wheelValues'));
  } catch (error) {
    stopWheelStreaming();
    setWheelStatus(`Streaming gestoppt: ${error.message}`, 'error');
  } finally {
    state.wheel.busy = false;
  }
}

async function startWheelStreaming() {
  const characteristic = state.chars.wheelValues;
  if (!characteristic) return;

  state.wheel.streaming = true;
  $('btn-wheel-stream').textContent = 'Streaming stoppen';
  setWheelStatus('Streaming aktiv …', 'busy');

  if (characteristic.properties.notify) {
    try {
      await gattQueue(() => characteristic.startNotifications());
      characteristic.addEventListener(
        'characteristicvaluechanged', onWheelNotification);
      state.wheel.notifying = true;
      return;
    } catch (error) {
      addLog(`[!]   Benachrichtigungen nicht möglich: ${error.message}`);
    }
  }

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

  const characteristic = state.chars.wheelValues;
  if (state.wheel.notifying && characteristic) {
    characteristic.removeEventListener(
      'characteristicvaluechanged', onWheelNotification);
    gattQueue(() => characteristic.stopNotifications()).catch(() => {});
    state.wheel.notifying = false;
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
    const value = await readChar('wheelCalib');

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
    await writeChar('wheelCalib', buffer);
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
    await writeChar('wheelCalib', buffer);

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
  $('service-uuids').value = loadServiceUuids();

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
  $('btn-save-uuids').addEventListener('click', saveServiceUuids);

  $('btn-reset-uuids').addEventListener('click', () => {
    $('service-uuids').value = BATTERY_SERVICE_UUID;
    saveServiceUuids();
  });

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

  if (!navigator.bluetooth) {
    setStatus(false, 'Web Bluetooth wird von diesem Browser nicht unterstützt');
    $('btn-connect').disabled = true;
    $('btn-refresh-known').disabled = true;
    addLog('[!]   Web Bluetooth nicht verfügbar – bitte Chrome, Edge oder Opera verwenden');
    return;
  }

  if (!window.isSecureContext) {
    addLog('[!]   Unsicherer Kontext – Web Bluetooth benötigt HTTPS oder localhost');
  }

  try {
    if (typeof navigator.bluetooth.getAvailability === 'function' &&
        !(await navigator.bluetooth.getAvailability())) {
      setStatus(false, 'Kein Bluetooth-Adapter verfügbar');
      addLog('[!]   Bluetooth ist deaktiviert oder es ist kein Adapter vorhanden');
      return;
    }
  } catch (error) {
    console.warn('Bluetooth-Verfügbarkeit unbekannt:', error);
  }

  addLog('[OK]  Bereit – suche nach bereits freigegebenen Geräten');
  await autoConnect();
});

window.addEventListener('beforeunload', () => {
  stopButtonMonitoring();
  stopWheelStreaming();
});
