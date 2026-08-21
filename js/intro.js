// Vorspann vor der eigentlichen Oberfläche.
//
// Das Video liegt als feste Ebene über der Seite. Sobald es endet –
// oder die Bedienung es überspringt – blendet die Ebene aus und wird
// entfernt.

const FADE_MS = 600;

const intro = document.getElementById("intro");
const video = document.getElementById("intro-video");
const skip = document.getElementById("intro-skip");

let finished = false;

function finish() {
  if (finished) return;
  finished = true;

  document.documentElement.classList.remove("intro-active");
  intro.classList.add("is-done");

  window.setTimeout(() => intro.remove(), FADE_MS);
}

document.documentElement.classList.add("intro-active");

video.addEventListener("ended", finish);
skip.addEventListener("click", finish);

// Sicherheitsnetz: Lässt sich das Video nicht abspielen – fehlende
// Datei, nicht unterstütztes Format oder eine verweigerte Wiedergabe –,
// darf die Oberfläche nicht dahinter verborgen bleiben.
video.addEventListener("error", finish);
video.play().catch(finish);
