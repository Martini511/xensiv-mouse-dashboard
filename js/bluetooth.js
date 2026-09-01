import {
  decodeButtonConfig,
  decodeButtonPressure,
  decodeCalibration,
  decodeWheelValues,
  encodeButtonConfig,
  encodeCalibration,
  encodeCalibrationCommand,
  encodeDpi,
} from "./protocol.js";
import { t } from "./i18n.js";

// Dienst- und Charakteristik-UUIDs aus `design.cybt`. Die Zuordnung ist
// fest verdrahtet: Ein gezieltes `getCharacteristic` ist deutlich
// schneller und zuverlässiger als das Durchsuchen der Attributtabelle.
export const UUIDS = Object.freeze({
  services: {
    dpi: "9c819277-5948-4ae0-9c12-d3499b7fe7ec",
    led: "0473bf09-18c9-4a38-85dd-471f6a86fc00",
    wheel: "45f4e8b7-cc4d-45de-a660-0293d769d93c",
    buttons: "3fad69da-f1a2-4047-b4ec-873a3807a885",
    battery: "0000180f-0000-1000-8000-00805f9b34fb",
  },
  characteristics: {
    dpi: "9c819277-5948-4ae0-9c12-d3499b7fe7ec",
    led: "0473bf09-18c9-4a38-85dd-471f6a86fc00",
    buttonConfig: "cfc2a291-bcaf-45d8-894c-ba16f55f699e",
    buttonPressure: "9c5056ff-7325-4217-892d-165d5783b96d",
    wheelValues: "ca4ca348-ece0-4f47-be09-507d7dfc46f2",
    wheelCalibration: "bfef758d-2219-4b11-a708-124de6abcfa1",
    battery: "00002a19-0000-1000-8000-00805f9b34fb",
  },
});

const DEVICE_KEY = "xensiv.deviceId";
const RECONNECT_DELAYS = [1000, 2000, 4000, 6000, 10000];
const WATCHDOG_INTERVAL = 5000;

export class XensivMouseBluetooth extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.server = null;
    this.characteristics = new Map();

    // Die Maus schaltet im Leerlauf ab. Ein Abbruch ist deshalb der
    // Normalfall und kein Fehler – nur eine ausdrückliche Trennung
    // durch die Bedienung beendet die Verbindung endgültig.
    this.userDisconnect = false;
    this.reconnecting = false;
    this.connecting = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;

    this.watchdog = window.setInterval(() => this.checkLink(), WATCHDOG_INTERVAL);
  }

  get connected() {
    return Boolean(this.device?.gatt?.connected) && this.characteristics.size > 0;
  }

  get available() {
    return Boolean(navigator.bluetooth);
  }

  // ─── Verbindungsaufbau ──────────────────────────────

  async connect() {
    if (!this.available) {
      throw new Error(t("error.noBluetooth"));
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "XENSIV" }],
      optionalServices: Object.values(UUIDS.services),
    });

    await this.attach(device);
    return device;
  }

  // Bereits freigegebene Geräte lassen sich ohne Auswahldialog
  // wiederfinden. Das trägt die Verbindung über einen Seitenwechsel.
  async knownDevices() {
    if (typeof navigator.bluetooth?.getDevices !== "function") return [];
    try {
      return await navigator.bluetooth.getDevices();
    } catch {
      return [];
    }
  }

  async connectKnown() {
    const devices = await this.knownDevices();
    if (devices.length === 0) return null;

    const preferred = readPreferredId();
    const device = devices.find((entry) => entry.id === preferred) || devices[0];

    // Nach einem Neuladen hält der Browser gelegentlich noch Reste der
    // vorherigen Verbindung. Erst freigeben, sonst läuft der Aufbau
    // zwangsläufig ins Leere.
    if (device.gatt?.connected) {
      safeDisconnect(device);
      await delay(800);
    }

    await this.attach(device);
    return device;
  }

  async attach(device, { patient = false } = {}) {
    this.device = device;
    device.removeEventListener("gattserverdisconnected", this.onDrop);
    this.onDrop = () => this.handleDisconnect();
    device.addEventListener("gattserverdisconnected", this.onDrop);

    this.connecting = true;
    try {
      // Ohne Zeitlimit: Chrome hält den Verbindungswunsch offen, bis
      // die Maus antwortet. Ein Abbruch von außen verwirft nur das
      // Ergebnis, nicht die laufende Operation – die Maus wäre dann
      // bis zu ihrem Neustart unerreichbar.
      this.server = await device.gatt.connect();
      await this.discoverCharacteristics();
    } catch (error) {
      this.characteristics.clear();
      this.server = null;
      safeDisconnect(device);
      if (!patient) throw error;
      return false;
    } finally {
      this.connecting = false;
    }

    writePreferredId(device.id);
    this.userDisconnect = false;
    this.dispatchEvent(new CustomEvent("connected", { detail: device }));
    return true;
  }

  async discoverCharacteristics() {
    this.characteristics.clear();

    const definitions = [
      ["dpi", "dpi", "dpi"],
      ["led", "led", "led"],
      ["buttonConfig", "buttons", "buttonConfig"],
      ["buttonPressure", "buttons", "buttonPressure"],
      ["wheelValues", "wheel", "wheelValues"],
      ["wheelCalibration", "wheel", "wheelCalibration"],
      ["battery", "battery", "battery"],
    ];

    for (const [name, serviceName, characteristicName] of definitions) {
      try {
        const service = await this.server.getPrimaryService(UUIDS.services[serviceName]);
        const characteristic = await service.getCharacteristic(
          UUIDS.characteristics[characteristicName]);
        this.characteristics.set(name, characteristic);
      } catch (error) {
        // Den Batteriedienst bietet nicht jede Firmware an; alles
        // andere ist für die Bedienung zwingend.
        if (name !== "battery") throw error;
      }
    }
  }

  // ─── Trennen und Freigeben ──────────────────────────

  disconnect() {
    this.userDisconnect = true;
    this.stopReconnect();
    safeDisconnect(this.device);
    this.handleDisconnect();
  }

  // Beim Verlassen der Seite: Die Maus erlaubt nur eine Verbindung.
  // Bleibt ein Rest bestehen, weist sie jeden neuen Aufbau ab, bis sie
  // neu gestartet wird.
  release() {
    this.userDisconnect = true;
    this.stopReconnect();
    safeDisconnect(this.device);
  }

  // Erzwungener Neuaufbau – die Alternative zum Neustart der Maus.
  async reset() {
    const device = this.device || (await this.knownDevices())[0];
    if (!device) throw new Error(t("error.noneReleased"));

    this.userDisconnect = true;
    this.stopReconnect();
    safeDisconnect(device);
    this.handleDisconnect();

    // Der Maus Zeit geben, die alte Verbindung ihrerseits abzuräumen.
    await delay(1500);
    this.userDisconnect = false;
    await this.attach(device);
  }

  handleDisconnect() {
    const wasConnected = Boolean(this.server || this.characteristics.size);
    this.server = null;
    this.characteristics.clear();

    if (wasConnected) this.dispatchEvent(new Event("disconnected"));

    if (!this.userDisconnect && this.device) this.startReconnect();
    this.userDisconnect = false;
  }

  // Chrome meldet den Verlust nicht in jedem Fall – besonders nicht,
  // während der Tab im Hintergrund lag. Ein Abgleich deckt das auf.
  checkLink() {
    if (this.connecting || this.characteristics.size === 0) return;
    if (this.device?.gatt?.connected) return;

    this.dispatchEvent(new CustomEvent("notice", {
      detail: { message: t("error.lostSilently") },
    }));
    this.handleDisconnect();
  }

  // ─── Automatische Wiederverbindung ──────────────────

  startReconnect() {
    if (this.reconnecting) return;

    this.reconnecting = true;
    this.reconnectAttempts = 0;
    this.dispatchEvent(new Event("reconnecting"));

    // Direkt im Trennungsereignis lehnt Windows einen neuen
    // Verbindungswunsch gelegentlich ab – kurz durchatmen.
    this.reconnectTimer = window.setTimeout(() => this.attemptReconnect(), 800);
  }

  stopReconnect() {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;

    const wasConnecting = this.connecting;
    this.reconnecting = false;

    // Einen noch offenen Verbindungswunsch aktiv abräumen, sonst
    // verbindet sich die Maus später unbemerkt im Hintergrund.
    if (wasConnecting && !this.connected) safeDisconnect(this.device);
  }

  async attemptReconnect() {
    if (!this.reconnecting || !this.device || this.connecting) return;

    this.reconnectTimer = null;
    this.reconnectAttempts += 1;

    const connected = await this.attach(this.device, { patient: true });

    if (!this.reconnecting) return;

    if (connected) {
      this.reconnecting = false;
      this.reconnectAttempts = 0;
      return;
    }

    const index = Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1);
    this.reconnectTimer = window.setTimeout(
      () => this.attemptReconnect(), RECONNECT_DELAYS[index]);
  }

  // Im Hintergrund drosselt der Browser alle Zeitgeber stark. Wird die
  // Seite wieder sichtbar, lohnt ein sofortiger Anlauf.
  resume() {
    this.checkLink();
    if (this.reconnecting && !this.connecting) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.attemptReconnect();
    }
  }

  // ─── Gerätefunktionen ───────────────────────────────

  async setLed(red, green, blue) {
    await this.write("led", Uint8Array.of(red, green, blue));
  }

  async setDpi(dpi) {
    await this.write("dpi", encodeDpi(dpi));
  }

  async readButtonConfig() {
    return decodeButtonConfig(await this.read("buttonConfig"));
  }

  async writeButtonConfig(config) {
    await this.write("buttonConfig", encodeButtonConfig(config));
  }

  async readButtonPressure() {
    return decodeButtonPressure(await this.read("buttonPressure"));
  }

  async readWheelValues() {
    return decodeWheelValues(await this.read("wheelValues"));
  }

  async readCalibration() {
    return decodeCalibration(await this.read("wheelCalibration"));
  }

  async writeCalibration(calibration) {
    await this.write("wheelCalibration", encodeCalibration(calibration));
  }

  async startCalibration() {
    await this.write("wheelCalibration", encodeCalibrationCommand(1));
  }

  async readBattery() {
    if (!this.characteristics.has("battery")) return null;
    return (await this.read("battery")).getUint8(0);
  }

  // ─── Übertragung ────────────────────────────────────

  async read(name) {
    this.requireConnected();
    return this.getCharacteristic(name).readValue();
  }

  async write(name, value) {
    this.requireConnected();
    const characteristic = this.getCharacteristic(name);
    if (characteristic.writeValueWithResponse) {
      await characteristic.writeValueWithResponse(value);
    } else {
      await characteristic.writeValue(value);
    }
  }

  getCharacteristic(name) {
    const characteristic = this.characteristics.get(name);
    if (!characteristic) throw new Error(`Charakteristik ${name} fehlt`);
    return characteristic;
  }

  requireConnected() {
    if (!this.connected) throw new Error(t("error.notConnected"));
  }
}

function safeDisconnect(device) {
  try {
    device?.gatt?.disconnect();
  } catch {
    // Es gab nichts abzubrechen
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function readPreferredId() {
  try {
    return window.localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

function writePreferredId(id) {
  try {
    window.localStorage.setItem(DEVICE_KEY, id);
  } catch {
    // Privater Modus ohne Speicher – nicht kritisch
  }
}
