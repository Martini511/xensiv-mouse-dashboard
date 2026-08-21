// Vorspann vor der eigentlichen Oberfläche.
//
// Der Inhalt des Videos ist ein Quadrat von 1080 × 1080, eingebettet in
// ein Bild von 1920 × 1080 – links und rechts stehen je 420 px
// schwarzer Rand, fest im Video eingebrannt. Statt das Video anzuzeigen
// und den Rand wegzuschneiden, überträgt eine Leinwand Bild für Bild
// ausschließlich dieses Quadrat. Der Rand erreicht die Anzeige damit
// gar nicht erst.

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

// Winziges Hilfsbild, das je Einzelbild einen einzigen Bildpunkt aus dem
// Inhalt liest. Daraus wird die Farbe der Fläche ringsum gesetzt, damit
// zwischen Leinwand und Hintergrund keine Kante entstehen kann – auch
// dann nicht, wenn ein Rechner das Video geringfügig anders in Farben
// umrechnet als das Weiß der Formatvorlage.
const probe = document.createElement("canvas");
probe.width = 1;
probe.height = 1;
const probeContext = probe.getContext("2d", { willReadFrequently: true });

let finished = false;
let backdrop = "";

function fitCanvas() {
  // Quadratisch und stets vollständig im Fenster: im Querformat füllt
  // das Bild die Höhe, im Hochformat die Breite. Kantenlänge und Lage
  // werden in echten Bildpunkten gerechnet und erst danach in CSS-Maße
  // zurückgerechnet. So liegt die Leinwand nie auf halben Punkten – sonst
  // rechnete der Browser das ganze Bild um und legte einen weichen Saum
  // um die Kanten.
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth * ratio;
  const height = window.innerHeight * ratio;
  const side = Math.floor(Math.min(width, height));

  canvas.width = side;
  canvas.height = side;
  canvas.style.width = `${side / ratio}px`;
  canvas.style.height = `${side / ratio}px`;
  canvas.style.left = `${Math.round((width - side) / 2) / ratio}px`;
  canvas.style.top = `${Math.round((height - side) / 2) / ratio}px`;
}

function matchBackdrop() {
  probeContext.drawImage(video, SOURCE.x, SOURCE.y, 1, 1, 0, 0, 1, 1);
  const [r, g, b] = probeContext.getImageData(0, 0, 1, 1).data;
  const color = `rgb(${r}, ${g}, ${b})`;

  if (color !== backdrop) {
    backdrop = color;
    intro.style.backgroundColor = color;
  }
}

function drawFrame() {
  if (finished) return;

  context.drawImage(
    video,
    SOURCE.x, SOURCE.y, SOURCE.size, SOURCE.size,
    0, 0, canvas.width, canvas.height);

  matchBackdrop();
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
