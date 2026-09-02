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

// Druck und Schwelle teilen sich ein Byte mit dem Freigabebit und haben
// deshalb sieben Bit: mehr als 127 kann weder gemessen noch eingestellt
// werden. Das ist die Obergrenze der Balken.
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

export function decodeButtonPressure(value) {
  requireLength(value, 5, t("live.press"));
  return Object.fromEntries(SENSOR_KEYS.map((key, index) => [
    key,
    value.getUint8(index) & 0x7f,
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

function requireLength(value, expected, label) {
  if (value.byteLength !== expected) {
    throw new Error(t("error.shortValue",
      { what: label, actual: value.byteLength, expected }));
  }
}
