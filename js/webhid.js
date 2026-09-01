import {
  decodeButtonConfig,
  decodeButtonPressure,
  decodeCalibration,
  decodeWheelValues,
  encodeButtonConfig,
  encodeCalibration,
  encodeDpi,
} from "./protocol.js";
import { t } from "./i18n.js";

// WebHID-Transport nach WEBHID_PROTOCOL.md.
//
// Die gesamte Kommunikation läuft über den 20 Byte großen
// Feature-Report 0x10: Byte 0 trägt den Befehl, Byte 1 die Länge der
// Nutzdaten, danach folgen die Nutzdaten mit Nullen aufgefüllt. Die
// Antwort meldet in Byte 1 den Status und in Byte 2 die Länge.

const FEATURE_REPORT_ID = 0x10;
const REPORT_SIZE = 20;
const XENSIV_VENDOR_ID = 0x0009;
const XENSIV_PRODUCT_ID = 0x0815;

const COMMAND = Object.freeze({
  setLed: 1,
  setDpi: 2,
  setButtonConfig: 3,
  getButtonConfig: 4,
  getButtonPressure: 5,
  getWheelValues: 6,
  getWheelCalibration: 7,
  setWheelCalibration: 8,
  startWheelCalibration: 9,
  getBattery: 10,
});

const STATUS_MESSAGES = [
  "",
  "status.1",
  "status.2",
  "status.3",
];

const RECONNECT_INTERVAL = 2000;

export class XensivMouseHid extends EventTarget {
  constructor() {
    super();
    this.device = null;

    // WebHID erlaubt nur einen Feature-Report zur Zeit. Die
    // Warteschlange hält Anfrage und Antwort zusammen.
    this.transactionQueue = Promise.resolve();

    this.userDisconnect = false;
    this.reconnecting = false;
    this.reconnectTimer = null;

    navigator.hid?.addEventListener("disconnect", ({ device }) => {
      if (device === this.device) this.handleDisconnect();
    });

    // Meldet sich die Maus nach dem Ruhezustand zurück, lässt sie sich
    // ohne erneuten Auswahldialog öffnen.
    navigator.hid?.addEventListener("connect", ({ device }) => {
      if (!this.reconnecting || !isXensiv(device)) return;
      this.attach(device).catch(() => {});
    });
  }

  get connected() {
    return Boolean(this.device?.opened);
  }

  get available() {
    return typeof navigator.hid?.requestDevice === "function";
  }

  // ─── Verbindungsaufbau ──────────────────────────────

  async connect() {
    if (!this.available) {
      throw new Error(t("error.noWebhid"));
    }

    const devices = await navigator.hid.requestDevice({
      filters: [{ vendorId: XENSIV_VENDOR_ID, productId: XENSIV_PRODUCT_ID }],
    });

    if (devices.length === 0) throw new Error(t("error.noneChosen"));

    const device = devices.find(hasConfigurationReport);
    if (!device) {
      throw new Error(t("error.noReport"));
    }

    await this.attach(device);
    return device;
  }

  // Bereits freigegebene Geräte trägt der Browser über Seitenaufrufe
  // hinweg – ein neuer Auswahldialog erübrigt sich damit.
  async knownDevices() {
    if (typeof navigator.hid?.getDevices !== "function") return [];

    try {
      const devices = await navigator.hid.getDevices();
      return devices.filter((device) =>
        isXensiv(device) && hasConfigurationReport(device));
    } catch {
      return [];
    }
  }

  async connectKnown() {
    const devices = await this.knownDevices();
    if (devices.length === 0) return null;

    await this.attach(devices[0]);
    return devices[0];
  }

  async attach(device) {
    this.device = device;
    if (!device.opened) await device.open();

    this.stopReconnect();
    this.userDisconnect = false;

    this.dispatchEvent(new CustomEvent("connected", {
      detail: { name: device.productName || "XENSIV Maus" },
    }));
    return true;
  }

  // ─── Trennen und Freigeben ──────────────────────────

  disconnect() {
    this.userDisconnect = true;
    this.stopReconnect();
    closeQuietly(this.device);
    this.handleDisconnect();
  }

  // Beim Verlassen der Seite: Ein offener Report-Kanal blockiert den
  // nächsten Seitenaufruf, deshalb wird er ausdrücklich geschlossen.
  release() {
    this.userDisconnect = true;
    this.stopReconnect();
    closeQuietly(this.device);
  }

  // Erzwungener Neuaufbau – die Alternative zum Neustart der Maus.
  async reset() {
    const device = this.device || (await this.knownDevices())[0];
    if (!device) throw new Error(t("error.noneReleased"));

    this.userDisconnect = true;
    this.stopReconnect();

    try {
      if (device.opened) await device.close();
    } catch {
      // Kanal war ohnehin geschlossen
    }

    this.handleDisconnect();
    await delay(600);

    this.userDisconnect = false;
    await this.attach(device);
  }

  handleDisconnect() {
    const wasConnected = Boolean(this.device);
    this.device = null;
    this.transactionQueue = Promise.resolve();

    if (wasConnected) this.dispatchEvent(new Event("disconnected"));

    if (!this.userDisconnect) this.startReconnect();
    this.userDisconnect = false;
  }

  // WebHID meldet das Abmelden zuverlässig über das disconnect-Ereignis;
  // ein Abgleich ist deshalb nur eine Rückfallebene.
  checkLink() {
    if (this.device && !this.device.opened) this.handleDisconnect();
  }

  // ─── Automatische Wiederverbindung ──────────────────

  startReconnect() {
    if (this.reconnecting) return;

    this.reconnecting = true;
    this.dispatchEvent(new Event("reconnecting"));

    this.reconnectTimer = window.setInterval(
      () => this.attemptReconnect(), RECONNECT_INTERVAL);
  }

  stopReconnect() {
    window.clearInterval(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnecting = false;
  }

  async attemptReconnect() {
    if (!this.reconnecting || this.connected) return;

    try {
      await this.connectKnown();
    } catch {
      // Die Maus schläft noch – der nächste Anlauf folgt
    }
  }

  resume() {
    this.checkLink();
    if (this.reconnecting) this.attemptReconnect();
  }

  // ─── Gerätefunktionen ───────────────────────────────

  async setLed(red, green, blue) {
    await this.command(COMMAND.setLed, Uint8Array.of(red, green, blue));
  }

  async setDpi(dpi) {
    await this.command(COMMAND.setDpi, encodeDpi(dpi));
  }

  async readButtonConfig() {
    return decodeButtonConfig(await this.command(COMMAND.getButtonConfig));
  }

  async writeButtonConfig(config) {
    await this.command(COMMAND.setButtonConfig, encodeButtonConfig(config));
  }

  async readButtonPressure() {
    return decodeButtonPressure(await this.command(COMMAND.getButtonPressure));
  }

  async readWheelValues() {
    return decodeWheelValues(await this.command(COMMAND.getWheelValues));
  }

  async readCalibration() {
    return decodeCalibration(await this.command(COMMAND.getWheelCalibration));
  }

  async writeCalibration(calibration) {
    await this.command(COMMAND.setWheelCalibration, encodeCalibration(calibration));
  }

  async startCalibration() {
    await this.command(COMMAND.startWheelCalibration);
  }

  async readBattery() {
    return (await this.command(COMMAND.getBattery)).getUint8(0);
  }

  // ─── Übertragung ────────────────────────────────────

  command(command, payload = new Uint8Array()) {
    const operation = () => this.executeCommand(command, toUint8Array(payload));
    const transaction = this.transactionQueue.then(operation, operation);
    this.transactionQueue = transaction.catch(() => {});
    return transaction;
  }

  async executeCommand(command, payload) {
    if (!this.connected) throw new Error(t("error.notConnected"));

    if (payload.byteLength > REPORT_SIZE - 2) {
      throw new Error(t("error.payloadTooBig"));
    }

    const request = new Uint8Array(REPORT_SIZE);
    request[0] = command;
    request[1] = payload.byteLength;
    request.set(payload, 2);
    await this.device.sendFeatureReport(FEATURE_REPORT_ID, request);

    const response = normalizeReport(
      await this.device.receiveFeatureReport(FEATURE_REPORT_ID));

    if (response.byteLength !== REPORT_SIZE) {
      throw new Error(t("error.wrongLength",
        { actual: response.byteLength, expected: REPORT_SIZE }));
    }
    if (response[0] !== command) {
      throw new Error(t("error.wrongCommand",
        { actual: response[0], expected: command }));
    }
    if (response[1] !== 0) {
      const status = STATUS_MESSAGES[response[1]];
      throw new Error(t("error.commandFailed", {
        command,
        reason: status ? t(status) : t("status.unknown", { code: response[1] }),
      }));
    }

    const responseLength = response[2];
    if (responseLength > REPORT_SIZE - 3) {
      throw new Error(`Ungültige Antwortlänge: ${responseLength}`);
    }

    const data = response.slice(3, 3 + responseLength);
    return new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
}

function isXensiv(device) {
  return device.vendorId === XENSIV_VENDOR_ID &&
         device.productId === XENSIV_PRODUCT_ID;
}

function hasConfigurationReport(device) {
  return device.collections.some((collection) =>
    collection.featureReports.some((report) => report.reportId === FEATURE_REPORT_ID));
}

// Manche Plattformen liefern die Report-Kennung als erstes Byte mit.
function normalizeReport(dataView) {
  const bytes = new Uint8Array(
    dataView.buffer, dataView.byteOffset, dataView.byteLength);

  return bytes.byteLength === REPORT_SIZE + 1 && bytes[0] === FEATURE_REPORT_ID
    ? bytes.slice(1)
    : bytes;
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value);
}

function closeQuietly(device) {
  try {
    if (device?.opened) device.close();
  } catch {
    // Kanal war ohnehin geschlossen
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
