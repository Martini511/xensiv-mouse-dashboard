// Byte-Formate der XENSIV-Maus.
//
// Alle Mehrbyte-Felder sind Little-Endian und entsprechen exakt den
// Strukturen des Desktop-Werkzeugs „XENSIV Mouse Control“. Änderungen
// an dieser Datei ändern das Verhalten auf dem Gerät – nicht nur die
// Anzeige.

import { t } from "./i18n.js";

export const SENSOR_KEYS = [
  "leftForce",
  "leftTmr2d",
  "leftHall",
  "rightForce",
  "rightHall",
];

// Die Schwelle teilt sich ein Byte mit dem Freigabebit und hat deshalb
// nachweislich sieben Bit. Fuer den Druck gilt dasselbe nur der Erwartung
// nach - verglichen wird er mit einer 7-Bit-Schwelle, also duerfte er kaum
// weiter reichen. Belegt ist das nirgends, deshalb ist 127 hier der
// Erwartungswert und keine Zusage: die Skala, mit der die Balken beginnen.
export const PRESS_MAX = 0x7f;

// Die Beschriftung hängt an der Sprache und wird deshalb erfragt, nicht
// abgelegt: Eine Tabelle müsste beim Umschalten neu gebaut werden.
export function sensorLabel(key) {
  return t(`sensor.${key}`);
}

export function encodeDpi(dpi) {
  const data = new ArrayBuffer(2);
  new DataView(data).setUint16(0, dpi, true);
  return data;
}

// Ein Byte je Sensor: oberstes Bit schaltet frei, die unteren sieben
// tragen den Schwellwert.
export function encodeButtonConfig(config) {
  return Uint8Array.from(SENSOR_KEYS, (key) => {
    const sensor = config[key];
    return (sensor.enabled ? 0x80 : 0) | (sensor.threshold & 0x7f);
  });
}

export function decodeButtonConfig(value) {
  requireLength(value, 5, t("acc.buttons.title"));
  return Object.fromEntries(SENSOR_KEYS.map((key, index) => [key, {
    enabled: Boolean(value.getUint8(index) & 0x80),
    threshold: value.getUint8(index) & 0x7f,
  }]));
}

// Das ganze Byte, nicht die unteren sieben Bit. Hier stand einmal dieselbe
// Maske wie in der Konfiguration - uebernommen von dort, wo das oberste Bit
// tatsaechlich das Freigabebit ist. Beim Druckwert traegt es nichts
// Bekanntes, und die Maske machte aus 130 eine 2: Die Anzeige haette bei
// festem Zudruecken auf null zurueckgesetzt und die Taste als losgelassen
// gemeldet, waehrend die Maus klickt. Ein zu grosser Wert faellt jetzt auf,
// statt lautlos zu verschwinden - die Skala waechst dann mit.
export function decodeButtonPressure(value) {
  requireLength(value, 5, t("live.press"));
  return Object.fromEntries(SENSOR_KEYS.map((key, index) => [
    key,
    value.getUint8(index),
  ]));
}

export function decodeWheelValues(value) {
  requireLength(value, 12, t("metric.wheelPress"));
  return {
    rawX: value.getInt16(0, true),
    rawZ: value.getInt16(2, true),
    calibratedX: value.getInt16(4, true),
    calibratedZ: value.getInt16(6, true),
    rawAngle: value.getInt16(8, true),
    calibratedAngle: value.getInt16(10, true),
  };
}

export function decodeCalibration(value) {
  requireLength(value, 14, t("acc.wheel.title"));
  return {
    offsetX: value.getInt16(0, true),
    offsetZ: value.getInt16(2, true),
    amplitudeX: value.getInt16(4, true),
    amplitudeZ: value.getInt16(6, true),
    ellipseAngle: value.getInt16(8, true),
    pressTrigger: value.getFloat32(10, true),
  };
}

export function encodeCalibration(calibration) {
  const data = new ArrayBuffer(14);
  const view = new DataView(data);
  view.setInt16(0, calibration.offsetX, true);
  view.setInt16(2, calibration.offsetZ, true);
  view.setInt16(4, calibration.amplitudeX, true);
  view.setInt16(6, calibration.amplitudeZ, true);
  view.setInt16(8, calibration.ellipseAngle, true);
  view.setFloat32(10, calibration.pressTrigger, true);
  return data;
}

// Ein negativer Wert im ersten Feld ist für die Firmware ein Befehl,
// kein Messwert: -1 startet den Kalibrierlauf.
export function encodeCalibrationCommand(command) {
  const data = new ArrayBuffer(14);
  new DataView(data).setInt16(0, -Math.abs(command), true);
  return data;
}

// ─── Auslöseverhalten ─────────────────────────────

// Zwei Arten, aus einem Messwert einen Tastendruck zu machen.
//
// Feste Schwelle: oberhalb gedrückt, unterhalb von 85 Prozent davon wieder
// los. Zwei Linien, die stehen bleiben.
//
// Relative Schwelle: die Firmware merkt sich den tiefsten Punkt und lässt
// los, sobald man um `releaseDelta` zurückgeht - und löst wieder aus, sobald
// man um `pressDelta` nachdrückt. Die beiden Linien wandern damit mit dem
// Finger; gemessen wird relativ zum Verlauf statt gegen einen festen Punkt.
// Erneut klicken heißt dann nicht mehr, erst über diesen Punkt
// zurückzukommen. Nahe der Ruhelage erzwingt die Totzone das Loslassen und
// setzt die Verfolgung zurück.
export const TRIGGER_MODE = Object.freeze({ fixed: 0, relative: 1 });

// Der Rückfall in der festen Betriebsart steckt in der Firmware, nicht in
// einer Einstellung. Hier steht er, damit die Anzeige die Rückfalllinie auch
// dann zeichnen kann, wenn vom Gerät gerade kein Zustand vorliegt.
export const FIXED_RELEASE_RATIO = 0.85;

// Die Kanalnummer ist die Stelle in SENSOR_KEYS - dieselbe Reihenfolge, in
// der auch die Tastenkonfiguration ihre fünf Bytes führt. Der 2D-TMR-Sensor
// hat auf der Seite keine Zeile, im Protokoll aber seinen Platz: Wer die
// sichtbaren Sensoren durchzählte statt hier nachzusehen, verschöbe alle
// Kanäle dahinter um eins.
export function channelOf(key) {
  return SENSOR_KEYS.indexOf(key);
}

export function encodeTriggerConfig(channel, config) {
  return Uint8Array.of(
    channel,
    config.mode,
    config.pressDelta,
    config.releaseDelta,
    config.deadzone,
  );
}

export function decodeTriggerConfig(value) {
  requireLength(value, 4, t("trigger.title"));
  return {
    mode: value.getUint8(0),
    pressDelta: value.getUint8(1),
    releaseDelta: value.getUint8(2),
    deadzone: value.getUint8(3),
  };
}

// Dasselbe Nachführen, das die Firmware betreibt - hier noch einmal, aus dem
// Druckstrom, der ohnehin ankommt.
//
// Das Gerät könnte beides selbst melden, und es tat es auch. Nur kostete das
// eine dritte Anfrage je Durchlauf, und weil die Schleife sich nach jeder
// Anfrage ebenso lange gedulden muss, wie sie gearbeitet hat, sank die
// Abtastrate um ein Drittel. Gerechnet wird deshalb hier.
//
// Der Preis steht in derselben Rechnung: Die Firmware sieht ihr Signal
// ungleich öfter als diese Seite. Was zwischen zwei Abtastungen an Spitze
// oder Tal liegt, entgeht der Nachbildung - bei einem schnellen Klick also
// gerade das, worauf es ankommt. Die Linien zeigen damit, wo bei dieser
// Abtastrate geschaltet würde, nicht mehr, wo das Gerät es tatsächlich tut.
export function trackTrigger(previous, value, config) {
  const { pressDelta, releaseDelta, deadzone } = config;

  let { pressed, peak, valley } =
    previous ?? { pressed: false, peak: value, valley: value };

  // Nahe der Ruhelage gilt die Taste als losgelassen, und die Verfolgung
  // beginnt von vorn: Sonst hielte ein abgesunkenes Tal den Auslösepunkt
  // unter dem Rauschen fest, und die Taste klickte von selbst.
  if (value <= deadzone) {
    pressed = false;
    peak = value;
    valley = value;
  } else if (pressed) {
    peak = Math.max(peak, value);
    if (value <= peak - releaseDelta) {
      pressed = false;
      valley = value;
    }
  } else {
    valley = Math.min(valley, value);
    if (value >= valley + pressDelta) {
      pressed = true;
      peak = value;
    }
  }

  return {
    value,
    peak,
    valley,
    pressed,
    pressPoint: Math.max(0, valley + pressDelta),
    releasePoint: Math.max(0, peak - releaseDelta),
  };
}

function requireLength(value, expected, label) {
  if (value.byteLength !== expected) {
    throw new Error(t("error.shortValue",
      { what: label, actual: value.byteLength, expected }));
  }
}
