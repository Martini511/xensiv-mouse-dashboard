// Vorspann vor der eigentlichen Oberfläche.
//
// Der Inhalt des Videos ist ein Quadrat von 1080 × 1080, eingebettet in
// ein Bild von 1920 × 1080 – links und rechts stehen je 420 px
// schwarzer Rand, fest im Video eingebrannt. Statt das Video anzuzeigen
// und den Rand wegzuschneiden, überträgt eine Leinwand Bild für Bild
// ausschließlich dieses Quadrat. Der Rand erreicht die Anzeige damit
// gar nicht erst.
//
// Die Leinwand füllt das ganze Fenster. Zuerst wird ein einziger weißer
// Bildpunkt aus dem Video über die gesamte Fläche gezogen, darauf kommt
// das Quadrat. Fläche und Bild stammen damit aus derselben Quelle und
// derselben Farbumrechnung, und zwischen beiden liegt keine Kante
// zweier Elemente mehr. Ein Strich am Übergang kann so nicht mehr
// entstehen – weder durch gerundete Maße noch durch ein abweichend
// umgerechnetes Weiß.

const FADE_MS = 600;

// Inhaltsbereich im Videobild, ausgemessen an mehreren Einzelbildern:
// der Balken endet bei 419, der Inhalt reicht bis 1499. Der Schnitt
// liegt bewusst ein Stück innerhalb dieser Kanten. Beim Verkleinern
// mischt der Browser benachbarte Bildpunkte; läge der Schnitt genau auf
// der Kante, geriete ein Hauch Schwarz in die erste Spalte. Die unterste
// Videozeile ist zudem dunkelgrau und bleibt ebenfalls außen vor.
const MARGIN = 6;
const SOURCE = { x: 420 + MARGIN, y: MARGIN, size: 1080 - 2 * MARGIN };

const intro = document.getElementById("intro");
const video = document.getElementById("intro-video");
const canvas = document.getElementById("intro-canvas");
const skip = document.getElementById("intro-skip");

const context = canvas.getContext("2d");

let finished = false;

function fitCanvas() {
  // Die Leinwand deckt das Fenster vollständig ab. Gerechnet wird in
  // echten Bildpunkten, damit der Browser das fertige Bild nicht noch
  // einmal umrechnen muss.
  const ratio = window.devicePixelRatio || 1;

  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
}

function drawFrame() {
  if (finished) return;

  // Fläche: ein einzelner Bildpunkt aus dem weißen Grund des Videos,
  // über das ganze Fenster gezogen.
  context.drawImage(
    video,
    SOURCE.x, SOURCE.y, 1, 1,
    0, 0, canvas.width, canvas.height);

  // Darauf das Inhaltsquadrat, so groß wie die kleinere Fensterkante.
  const side = Math.min(canvas.width, canvas.height);
  context.drawImage(
    video,
    SOURCE.x, SOURCE.y, SOURCE.size, SOURCE.size,
    Math.round((canvas.width - side) / 2),
    Math.round((canvas.height - side) / 2),
    side, side);

  scheduleFrame();
}

// `requestVideoFrameCallback` meldet genau ein Ereignis je Videobild
// und spart damit überflüssige Zeichenvorgänge. Fehlt es, genügt der
// gewöhnliche Bildtakt.
function scheduleFrame() {
  if (typeof video.requestVideoFrameCallback === "function") {
    video.requestVideoFrameCallback(drawFrame);
  } else {
    window.requestAnimationFrame(drawFrame);
  }
}

function finish() {
  if (finished) return;
  finished = true;

  document.documentElement.classList.remove("intro-active");
  window.removeEventListener("resize", fitCanvas);
  intro.classList.add("is-done");

  window.setTimeout(() => intro.remove(), FADE_MS);
}

document.documentElement.classList.add("intro-active");
fitCanvas();
window.addEventListener("resize", fitCanvas);

video.addEventListener("loadeddata", scheduleFrame);
video.addEventListener("ended", finish);
skip.addEventListener("click", finish);

// Sicherheitsnetz: Lässt sich das Video nicht abspielen – fehlende
// Datei, nicht unterstütztes Format oder eine verweigerte Wiedergabe –,
// darf die Oberfläche nicht dahinter verborgen bleiben.
video.addEventListener("error", finish);
video.play().catch(finish);
