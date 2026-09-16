// Zwei leichtgewichtige Canvas-Diagramme ohne Fremdbibliothek:
// links der Winkelverlauf, rechts die Bahn des Magnetfelds.

import { t } from "./i18n.js";

const COLORS = {
  grid: "#dfe4e4",
  text: "#6b7a7d",
  raw: "#eb7000",
  calibrated: "#0a8a7c",
};

// Bei hoher Radrate schrumpft der sichtbare Zeitraum entsprechend:
// 400 Messpunkte sind bei 30 Hz gut dreizehn Sekunden.
const MAX_SAMPLES = 400;

// Die Magnetbahn ist eine Punktwolke, kein Linienzug. Eine Linie behauptet
// einen Weg zwischen zwei Messungen, den niemand gemessen hat - bei einem
// Ausreisser zieht sie quer durchs Bild und laesst ihn wie eine Bewegung
// aussehen. Punkte zeigen nur, was da war. Leicht durchscheinend, damit sich
// beide Reihen nicht gegenseitig verdecken und dichte Stellen dunkler wirken.
const DOT_RADIUS = 1.8;
const DOT_ALPHA = 0.75;

// Der Winkel hat einen festen Bereich: eine ganze Umdrehung, um die Null
// gelegt. Eine Skala, die mitwaechst, zog das Rauschen eines ruhenden Rads
// ueber die volle Hoehe auseinander - das sah nach Bewegung aus, wo keine
// war. Nebenbei stehen damit beide Reihen auf derselben Skala; vorher hatte
// jede ihre eigene und zwei Kurven, die sich kreuzten, bedeuteten nichts.
const ANGLE_MIN = -180;
const ANGLE_MAX = 180;

export class WheelCharts {
  constructor(angleCanvas, fieldCanvas) {
    this.angleCanvas = angleCanvas;
    this.fieldCanvas = fieldCanvas;
    this.samples = [];
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(angleCanvas);
    this.resizeObserver.observe(fieldCanvas);
  }

  add(sample) {
    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    this.draw();
  }

  clear() {
    this.samples = [];
    this.draw();
  }

  draw() {
    this.drawAngleChart();
    this.drawFieldChart();
  }

  drawAngleChart() {
    const { context, width, height } = prepare(this.angleCanvas);
    drawFrame(context, width, height, t("chart.angle"), t("chart.samples"));
    drawAngleAxis(context, width, height);
    if (this.samples.length < 2) return;

    drawSeries(context, width, height,
      this.samples.map((sample) => sample.rawAngle), COLORS.raw);
    drawSeries(context, width, height,
      this.samples.map((sample) => sample.calibratedAngle), COLORS.calibrated);
  }

  drawFieldChart() {
    const { context, width, height } = prepare(this.fieldCanvas);
    drawFrame(context, width, height, t("chart.field"), t("chart.path"));
    // Ein einzelner Punkt ist hier bereits eine Aussage - anders als bei der
    // Linie, die zwei Werte braucht, um ueberhaupt zu entstehen.
    if (!this.samples.length) return;

    const points = this.samples.flatMap((sample) => [
      sample.rawX,
      sample.rawZ,
      sample.calibratedX,
      sample.calibratedZ,
    ]);
    const extent = Math.max(1, ...points.map(Math.abs));

    drawXY(context, width, height, this.samples, extent, false, COLORS.raw);
    drawXY(context, width, height, this.samples, extent, true, COLORS.calibrated);
  }
}

function prepare(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(300, canvas.clientWidth);
  const height = Math.max(220, canvas.clientHeight);

  canvas.width = width * ratio;
  canvas.height = height * ratio;

  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function drawFrame(context, width, height, title, subtitle) {
  context.strokeStyle = COLORS.grid;
  context.lineWidth = 1;

  for (let index = 1; index < 5; index += 1) {
    const y = 28 + ((height - 52) * index) / 5;
    context.beginPath();
    context.moveTo(34, y);
    context.lineTo(width - 14, y);
    context.stroke();
  }

  context.fillStyle = COLORS.text;
  context.font = "600 11px 'IBM Plex Mono', monospace";
  context.fillText(title, 14, 17);
  context.font = "400 10px 'IBM Plex Mono', monospace";
  context.fillText(subtitle, width - context.measureText(subtitle).width - 14, 17);
}

// Die Enden der Skala stehen im linken Rand, den der Rahmen ohnehin frei
// laesst: Ein fester Bereich, der nirgends genannt ist, sieht aus wie ein
// zufaelliger Ausschnitt. Die Null bekommt eine eigene Linie - das Raster
// teilt in fuenf und trifft die Mitte nicht.
function drawAngleAxis(context, width, height) {
  const middle = 30 + (height - 52) / 2;

  context.strokeStyle = COLORS.grid;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(34, middle);
  context.lineTo(width - 14, middle);
  context.stroke();

  context.fillStyle = COLORS.text;
  context.font = "400 9px 'IBM Plex Mono', monospace";
  context.fillText(String(ANGLE_MAX), 8, 33);
  context.fillText("0", 8, middle + 3);
  context.fillText(String(ANGLE_MIN), 8, height - 19);
}

function drawSeries(context, width, height, values, color) {
  const span = ANGLE_MAX - ANGLE_MIN;

  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();

  values.forEach((value, index) => {
    const angle = wrapAngle(value);
    const x = 34 + (index / (values.length - 1)) * (width - 48);
    const y = 30 + ((ANGLE_MAX - angle) / span) * (height - 52);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });

  context.stroke();
}

// Gefaltet, nicht beschnitten: Meldet das Geraet 270 Grad, ist das derselbe
// Winkel wie -90 und gehoert dorthin. Beschneiden legte alles oberhalb von
// 180 auf den oberen Rand und behauptete Stillstand.
function wrapAngle(value) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function drawXY(context, width, height, samples, extent, calibrated, color) {
  const centerX = width / 2;
  const centerY = (height + 20) / 2;
  const scale = Math.min(width - 60, height - 48) / (2 * extent);

  context.save();
  context.globalAlpha = DOT_ALPHA;
  context.fillStyle = color;

  // Alle Punkte in einem einzigen Pfad: Vierhundert einzelne Fuellvorgaenge je
  // Bild waeren bei dreissig Bildern in der Sekunde spuerbar. Das moveTo vor
  // jedem Kreis trennt die Teilpfade - ohne es zoege der Bogen eine Linie vom
  // vorigen Punkt heran, und aus der Punktwolke wuerde wieder ein Linienzug.
  context.beginPath();
  samples.forEach((sample) => {
    const x = calibrated ? sample.calibratedX : sample.rawX;
    const z = calibrated ? sample.calibratedZ : sample.rawZ;
    const canvasX = centerX + x * scale;
    const canvasY = centerY - z * scale;
    context.moveTo(canvasX + DOT_RADIUS, canvasY);
    context.arc(canvasX, canvasY, DOT_RADIUS, 0, Math.PI * 2);
  });
  context.fill();

  context.restore();
}
