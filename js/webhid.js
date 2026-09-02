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

// Legt sich die Maus schlafen, bleibt ihr Geraeteknoten im System oft
// bestehen: Das disconnect-Ereignis kommt dann nie, und eine Anfrage
// verhallt einfach. Ohne Zeitlimit wartete die Seite darauf bis in alle
// Ewigkeit. Der Wert ist grosszuegig gegenueber der Abfragerate von etwa
// zehn Werten je Sekunde.
const COMMAND_TIMEOUT = 2500;

// Eine Verbindung, kein Wiederverbinden.
//
// Der Versuch, eine verlorene Verbindung von selbst wiederherzustellen, ist
// aufgegeben - und zwar aus einem Befund, nicht aus Bequemlichkeit: Wacht
// die Maus aus dem Ruhezustand auf, gibt der Browser sie dieser Seite nicht
// mehr frei. `getDevices()` bleibt leer, ein Anmelde-Ereignis kommt nicht.
// Zurueckholen kann die Freigabe allein der Auswahldialog, und den oeffnet
// der Browser ausschliesslich auf einen Klick hin. Jede Automatik davor
// waere Beschaeftigung ohne Aussicht.
//
// Also das Ehrliche: Der Verlust wird sauber erkannt und gemeldet, die Seite
// raeumt auf und steht bereit fuer eine neue Verbindung - einen Klick weit.
export class XensivMouseHid extends EventTarget {
  constructor() {
    super();
    this.device = null;

    // WebHID erlaubt nur einen Feature-Report zur Zeit. Die
    // Warteschlange hält Anfrage und Antwort zusammen.
    this.transactionQueue = Promise.resolve();

    // Laeuft gerade ein Verbindungsaufbau? Waehrenddessen ist ein Geraet
    // gesetzt und geoeffnet, ohne dass eine Verbindung besteht - und ohne
    // diesen Merker sieht alles andere faelschlich eine.
    this.attaching = false;

    navigator.hid?.addEventListener("disconnect", ({ device }) => {
      // Nicht auf Objektgleichheit pruefen. Chrome reicht im Ereignis nicht
      // zwingend dasselbe HIDDevice herein, das wir halten - dann ginge der
      // Vergleich ins Leere und der Verlust bliebe unbemerkt. Dass es unser
      // Geraet ist und wir eines halten, genuegt.
      trace("Geraet abgemeldet", describe(device));
      if (this.device && isXensiv(device)) this.handleDisconnect();
    });
  }

  get connected() {
    return Boolean(this.device?.opened) && !this.attaching;
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

    const device = devices.find(isOurs);
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
      return devices.filter(isOurs);
    } catch {
      return [];
    }
  }

  async connectKnown() {
    const devices = await this.knownDevices();
    if (devices.length === 0) return null;

    // Nach einem Verbindungsverlust kann dasselbe Geraet zweimal in der
    // Liste stehen: der alte Eintrag, den wir noch offen halten, und der
    // frische. Brauchbar ist der frische - erkennbar daran, dass ihn
    // niemand geoeffnet hat.
    const device = devices.find((entry) => !entry.opened) || devices[0];
    await this.attach(device);
    return device;
  }

  async attach(device) {
    // Ein Griff, der vom vorigen Mal offen geblieben ist, taugt nichts mehr:
    // Das System hat das Geraet inzwischen neu angemeldet, der alte Griff
    // zeigt ins Leere - `opened` sagt trotzdem ja. Deshalb zuerst
    // schliessen, dann frisch oeffnen.
    this.attaching = true;
    try {
      await closeQuietly(device);
      await device.open();
      this.device = device;

      // Ein geoeffneter Kanal ist noch keine Verbindung. Bei einer
      // schlafenden Funkmaus laesst sich der Geraeteknoten oeffnen, waehrend
      // die Funkstrecke aus ist - die Seite meldete dann "verbunden" und
      // faende sich beim ersten Befehl wieder getrennt. Erst eine
      // beantwortete Frage macht aus dem Kanal eine Verbindung.
      try {
        await this.command(COMMAND.getButtonConfig);
      } catch (error) {
        // Kam die Antwort gar nicht, hat `transfer` schon aufgeraeumt und
        // das Geraet abgeraeumt - dann ist der Versuch gescheitert. Ein
        // Protokollfehler dagegen *ist* eine Antwort: Die Maus ist da, nur
        // ihre Firmware ist anderer Meinung. Das steht der Verbindung nicht
        // im Weg.
        if (!this.device) throw error;
      }
    } finally {
      this.attaching = false;
    }

    trace("Verbunden:", describe(device));

    this.dispatchEvent(new CustomEvent("connected", {
      detail: { name: device.productName || "XENSIV Maus" },
    }));
    return true;
  }

  // ─── Trennen und Freigeben ──────────────────────────

  disconnect() {
    closeQuietly(this.device);
    this.handleDisconnect(true);
  }

  // Beim Verlassen der Seite: Ein offener Report-Kanal blockiert den
  // nächsten Seitenaufruf, deshalb wird er ausdrücklich geschlossen.
  release() {
    closeQuietly(this.device);
  }

  // Erzwungener Neuaufbau – die Alternative zum Neustart der Maus.
  async reset() {
    const device = this.device || (await this.knownDevices())[0];

    // Kennt der Browser gar kein Geraet mehr - weil die Freigabe
    // zurueckgenommen wurde oder die Maus dem System abhanden gekommen ist
    // -, laesst sich nichts neu aufbauen. Statt in einer Sackgasse zu enden
    // fragt die Seite dann nach: Der Druck auf die Schaltflaeche ist genau
    // die Geste, die der Browser fuer den Auswahldialog verlangt.
    if (!device) return this.connect();

    try {
      if (device.opened) await device.close();
    } catch {
      // Kanal war ohnehin geschlossen
    }

    this.handleDisconnect(true);
    await delay(600);

    await this.attach(device);
  }

  // `expected` sagt, ob das Abmelden von hier ausging. Die Seite meldet nur
  // unerwartetes loest die Suche aus.
  handleDisconnect(expected = false) {
    const device = this.device;
    // Ein gescheiterter Anlauf ist kein Verbindungsverlust: Es gab nie eine.
    // Sonst meldete die Seite alle paar Sekunden "getrennt" und schriebe
    // ihre eigene Suchanzeige mit "Nicht verbunden" wieder zu.
    const wasConnected = Boolean(device) && !this.attaching;
    this.device = null;
    this.transactionQueue = Promise.resolve();

    // Den Griff nicht weiter offen halten. Er zeigt nach dem Verlust ohnehin
    // ins Leere, und solange er besteht, gibt das System das Geraet nicht
    // sauber wieder her.
    closeQuietly(device);

    if (wasConnected) {
      trace(expected ? "Getrennt" : "Verbindung verloren");
      this.dispatchEvent(new CustomEvent("disconnected", {
        detail: { expected },
      }));
    }
  }

  // WebHID meldet das Abmelden zuverlässig über das disconnect-Ereignis;
  // ein Abgleich ist deshalb nur eine Rückfallebene.
  checkLink() {
    if (this.device && !this.device.opened) this.handleDisconnect();
  }

  resume() {
    this.checkLink();
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
    // Gefragt ist hier das Geraet, nicht die Verbindung: Waehrend eines
    // Anlaufs gilt sie noch nicht als bestehend, und gerade dann muss die
    // Probe hindurch, die sie erst beweist.
    if (!this.device) throw new Error(t("error.notConnected"));

    if (payload.byteLength > REPORT_SIZE - 2) {
      throw new Error(t("error.payloadTooBig"));
    }

    const request = new Uint8Array(REPORT_SIZE);
    request[0] = command;
    request[1] = payload.byteLength;
    request.set(payload, 2);

    const response = await this.transfer(request);

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

  // Ein Fehlschlag auf der Funkstrecke ist etwas anderes als eine Antwort,
  // die nicht passt. Das erste heisst: die Verbindung ist weg - und dann
  // muss die Suche anlaufen, sonst wartet die Seite auf ein Geraet, das
  // sich schlafen gelegt hat und sich nie wieder von selbst meldet. Das
  // zweite ist ein Protokollfehler und laesst die Verbindung unberuehrt.
  async transfer(request) {
    try {
      await withTimeout(
        this.device.sendFeatureReport(FEATURE_REPORT_ID, request));
      return normalizeReport(await withTimeout(
        this.device.receiveFeatureReport(FEATURE_REPORT_ID)));
    } catch (error) {
      this.handleDisconnect();
      throw error;
    }
  }
}

// Abbrechen laesst sich eine laufende Anfrage nicht - aber aufhoeren, auf
// sie zu warten. Was danach noch eintrifft, verfaellt: Nach dem Zeitablauf
// gilt die Verbindung als verloren, und bis zum Neuaufbau nimmt niemand
// mehr etwas entgegen.
function withTimeout(promise, milliseconds = COMMAND_TIMEOUT) {
  return Promise.race([promise, new Promise((resolve, reject) => {
    window.setTimeout(() => reject(new Error(t("error.timeout"))), milliseconds);
  })]);
}

// Eine Spur der Verbindung in der Konsole. Sie steht auf `info`, nicht auf
// `debug`: Was Chrome als "Verbose" einstuft, blendet die Konsole von sich
// aus aus - und eine Diagnose, die man erst freischalten muss, hilft in dem
// Moment nicht, in dem man sie braucht.
function trace(...parts) {
  console.info("[XENSIV]", ...parts);
}

function describe(device) {
  if (!device) return "(keines)";
  return `${device.productName || "?"} `
    + `${device.vendorId?.toString(16)}:${device.productId?.toString(16)} `
    + `offen=${device.opened} berichte=${device.collections?.length ?? "?"}`;
}

function isXensiv(device) {
  return device.vendorId === XENSIV_VENDOR_ID &&
         device.productId === XENSIV_PRODUCT_ID;
}

function hasConfigurationReport(device) {
  return device.collections.some((collection) =>
    collection.featureReports.some((report) => report.reportId === FEATURE_REPORT_ID));
}

// Ob ein Geraet unsere Maus ist, sagen Hersteller- und Produktnummer. Der
// Feature-Report ist die zweite Probe - aber nur, wenn das System ihn
// ueberhaupt nennt.
//
// Eine leere Beschreibungsliste ist kein Nein. Sie heisst, dass die
// Beschreibung gerade nicht abrufbar ist, und genau das ist bei einer
// schlafenden Funkmaus der Normalfall: Der Geraeteknoten steht noch, die
// Berichte dazu bekommt das System aber erst wieder, wenn die Maus
// antwortet. Wer hier streng filtert, wirft genau das Geraet weg, das er
// sucht - und wundert sich, dass nie etwas zurueckkommt. Ob der Report
// wirklich da ist, zeigt spaetestens der erste Befehl.
function isOurs(device) {
  return isXensiv(device)
    && (device.collections.length === 0 || hasConfigurationReport(device));
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

async function closeQuietly(device) {
  try {
    if (device?.opened) await device.close();
  } catch {
    // Kanal war ohnehin geschlossen
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
