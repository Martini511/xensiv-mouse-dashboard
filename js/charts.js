// Zwei leichtgewichtige Canvas-Diagramme ohne Fremdbibliothek:
// links der Winkelverlauf, rechts die Bahn des Magnetfelds.

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
    drawFrame(context, width, height, "WINKEL", "Messpunkte");
    if (this.samples.length < 2) return;

    drawSeries(context, width, height,
      this.samples.map((sample) => sample.rawAngle), COLORS.raw);
    drawSeries(context, width, height,
      this.samples.map((sample) => sample.calibratedAngle), COLORS.calibrated);
  }

  drawFieldChart() {
    const { context, width, height } = prepare(this.fieldCanvas);
    drawFrame(context, width, height, "X / Z FELD", "Magnetbahn");
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

function drawSeries(context, width, height, values, color) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);

  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();

  values.forEach((value, index) => {
    const x = 34 + (index / (values.length - 1)) * (width - 48);
    const y = 30 + ((max - value) / span) * (height - 52);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });

  context.stroke();
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
