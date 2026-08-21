// Vorspann vor der eigentlichen Oberfläche.
//
// Der Inhalt des Videos ist ein Quadrat von 1080 × 1080, eingebettet in
// ein Bild von 1920 × 1080 – links und rechts stehen je 420 px
// schwarzer Rand, fest im Video eingebrannt. Statt das Video anzuzeigen
// und den Rand wegzuschneiden, überträgt eine Leinwand Bild für Bild
// ausschließlich dieses Quadrat. Der Rand erreicht die Anzeige damit
// gar nicht erst.

const FADE_MS = 600;

// Inhaltsbereich im Videobild, ausgemessen an mehreren Einzelbildern.
const SOURCE = { x: 420, y: 0, size: 1080 };

const intro = document.getElementById("intro");
const video = document.getElementById("intro-video");
const canvas = document.getElementById("intro-canvas");
const skip = document.getElementById("intro-skip");

const context = canvas.getContext("2d");

let finished = false;

function fitCanvas() {
  // Quadratisch und stets vollständig im Fenster: im Querformat füllt
  // das Bild die Höhe, im Hochformat die Breite.
  const side = Math.min(window.innerWidth, window.innerHeight);
  const ratio = window.devicePixelRatio || 1;

  canvas.width = Math.round(side * ratio);
  canvas.height = Math.round(side * ratio);
  canvas.style.width = `${side}px`;
  canvas.style.height = `${side}px`;
}

function drawFrame() {
  if (finished) return;

  context.drawImage(
    video,
    SOURCE.x, SOURCE.y, SOURCE.size, SOURCE.size,
    0, 0, canvas.width, canvas.height);

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
