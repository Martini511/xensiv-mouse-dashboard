// Das CAD-Modell der Maus in der Live-Ansicht: Es dreht sein Rad, hebt die
// gedrückte Taste hervor und nimmt die Farbe der LED an.
//
// Gezeichnet wird nur, wenn sich etwas ändert. Die Messschleife liefert alle
// 100 ms neue Werte – eine Dauerschleife mit 60 Bildern je Sekunde würde
// nichts gewinnen und den Akku belasten.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// Teilenamen aus der CAD-Baugruppe.
const COVER = "mouse_cover";
const BODY = "mouse_body";
const WHEEL = ["wheel_1055", "wheel_cover"];

// Blickrichtung ohne Zutun des Betrachters: leicht von rechts oben auf die
// Vorderseite. Winkel als Kugelkoordinaten um den Modellmittelpunkt.
const HOME = { azimuth: 0.55, polar: 1.02 };
const DISTANCE = 0.26;
const POLAR_LIMITS = [0.25, 1.45];

// Nach dieser Ruhezeit gleitet die Ansicht zurück in die Ausgangslage.
const RETURN_DELAY = 2200;
const RETURN_EASE = 0.055;

// Die Maus zeigt mit der Nase zum Betrachter. Wer sie bedient, sitzt also
// dahinter – seine linke Taste liegt damit auf der +X-Seite des Modells.
const LEFT_IS_POSITIVE_X = true;

// Gedrückt wird die Hälfte eingefärbt, nicht nur aufgehellt: Auf dem hellen
// Deckel ginge ein reiner Leuchtanteil im Glanzlicht unter. Die Farbe ist
// dieselbe, die auch die Zeichnung benutzt.
const PRESS_COLOR = 0x12a190;
const PRESS_GLOW = 0.35;
const LED_STRENGTH = 0.16;

export class MouseModel {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 10);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    this.azimuth = HOME.azimuth;
    this.polar = HOME.polar;
    this.lastInput = 0;
    this.frame = 0;
    this.visible = true;
    this.wheels = [];
    this.buttonMaterials = {};

    this.#setupStage();
    this.#setupInput();

    this.resizeObserver = new ResizeObserver(() => this.#resize());
    this.resizeObserver.observe(canvas);

    // Ein verstecktes Panel hat keine Fläche – dann ruht auch das Bild.
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.#invalidate();
    });
    this.intersectionObserver.observe(canvas);
    document.addEventListener("visibilitychange", () => this.#invalidate());

    this.#resize();
  }

  // ─── Aufbau ─────────────────────────────────────────

  #setupStage() {
    const generator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = generator.fromScene(new RoomEnvironment(), 0.04).texture;
    generator.dispose();
    if ("environmentIntensity" in this.scene) {
      this.scene.environmentIntensity = 0.45;
    }

    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(0.25, 0.45, 0.3);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xbfe6ea, 0.7);
    rim.position.set(-0.3, 0.15, -0.35);
    this.scene.add(rim);

    // Sitzt im Gehäuse und färbt den Blick durch die Waben.
    this.ledLight = new THREE.PointLight(0x12a190, 0, 0.25, 2);
    this.ledLight.position.set(0, 0, -0.02);
    this.scene.add(this.ledLight);
  }

  #setupInput() {
    const pointers = new Map();
    let last = null;

    this.canvas.addEventListener("pointerdown", (event) => {
      pointers.set(event.pointerId, event);
      last = event;
      this.canvas.setPointerCapture(event.pointerId);
      this.lastInput = Infinity;      // solange gehalten wird, kein Rücklauf
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId) || !last) return;
      this.azimuth -= (event.clientX - last.clientX) * 0.008;
      this.polar = clamp(
        this.polar - (event.clientY - last.clientY) * 0.008, ...POLAR_LIMITS);
      last = event;
      this.#invalidate();
    });

    const release = (event) => {
      pointers.delete(event.pointerId);
      last = null;
      this.lastInput = performance.now();

      // Nach dem Loslassen zeichnet niemand mehr - ohne diesen Wecker
      // bliebe die Ansicht stehen, wo der Zeiger sie gelassen hat.
      clearTimeout(this.returnTimer);
      this.returnTimer = setTimeout(() => this.#invalidate(), RETURN_DELAY + 20);
    };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);
  }

  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.pivot.add(gltf.scene);

    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      const name = object.name.toLowerCase();

      if (WHEEL.some((key) => name.includes(key))) this.wheels.push(object);
      if (name.includes(BODY)) this.bodyMaterial = object.material;
      if (name.includes(COVER)) this.#splitCover(object);
    });

    this.#invalidate();
    return this;
  }

  // Der Deckel ist ein einziges Bauteil. Für die Tastenrückmeldung werden
  // seine Dreiecke nach der Seite sortiert, auf der sie liegen, und in zwei
  // Zeichengruppen mit eigenem Material gelegt. Ein Schnitt durch die
  // Geometrie ist dafür nicht nötig.
  #splitCover(mesh) {
    const geometry = mesh.geometry;
    const index = geometry.getIndex();
    const position = geometry.getAttribute("position");
    if (!index) return;

    const left = [];
    const right = [];
    for (let triangle = 0; triangle < index.count; triangle += 3) {
      const a = index.getX(triangle);
      const b = index.getX(triangle + 1);
      const c = index.getX(triangle + 2);
      const side = position.getX(a) + position.getX(b) + position.getX(c);
      const target = (side >= 0) === LEFT_IS_POSITIVE_X ? left : right;
      target.push(a, b, c);
    }

    index.set(left.concat(right));
    index.needsUpdate = true;
    geometry.clearGroups();
    geometry.addGroup(0, left.length, 0);
    geometry.addGroup(left.length, right.length, 1);

    const base = mesh.material;
    this.restColor = base.color.clone();
    this.buttonMaterials = { left: base.clone(), right: base.clone() };
    mesh.material = [this.buttonMaterials.left, this.buttonMaterials.right];
  }

  // ─── Anzeige ────────────────────────────────────────

  setWheelAngle(degrees) {
    const radians = THREE.MathUtils.degToRad(degrees);
    this.wheels.forEach((wheel) => { wheel.rotation.x = radians; });
    this.#invalidate();
  }

  setButton(side, pressed) {
    const material = this.buttonMaterials[side];
    if (!material) return;
    if (pressed) {
      material.color.setHex(PRESS_COLOR);
      material.emissive.setHex(PRESS_COLOR);
      material.emissiveIntensity = PRESS_GLOW;
    } else {
      material.color.copy(this.restColor);
      material.emissiveIntensity = 0;
    }
    this.#invalidate();
  }

  setLed(hex, off) {
    const color = new THREE.Color(hex);
    this.ledLight.color.copy(color);
    this.ledLight.intensity = off ? 0 : 0.05;
    if (this.bodyMaterial) {
      this.bodyMaterial.emissive.copy(color);
      this.bodyMaterial.emissiveIntensity = off ? 0 : LED_STRENGTH;
    }
    this.#invalidate();
  }

  reset() {
    this.setWheelAngle(0);
    this.setButton("left", false);
    this.setButton("right", false);
  }

  // ─── Bild ───────────────────────────────────────────

  #resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.#invalidate();
  }

  #invalidate() {
    if (this.frame || !this.visible || document.hidden) return;
    this.frame = requestAnimationFrame(() => this.#draw());
  }

  #draw() {
    this.frame = 0;
    const idle = performance.now() - this.lastInput;
    let moving = false;

    if (idle > RETURN_DELAY) {
      const azimuth = shortestAngle(this.azimuth, HOME.azimuth);
      this.azimuth += azimuth * RETURN_EASE;
      this.polar += (HOME.polar - this.polar) * RETURN_EASE;
      moving = Math.abs(azimuth) > 1e-4
        || Math.abs(HOME.polar - this.polar) > 1e-4;
      if (!moving) {
        this.azimuth = HOME.azimuth;
        this.polar = HOME.polar;
      }
    }

    this.camera.position.set(
      Math.sin(this.polar) * Math.sin(this.azimuth),
      Math.cos(this.polar),
      Math.sin(this.polar) * Math.cos(this.azimuth),
    ).multiplyScalar(DISTANCE);
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
    if (moving) this.#invalidate();
  }
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

// Kürzester Weg zurück zur Ausgangsrichtung, damit die Ansicht nach mehreren
// Umdrehungen nicht zurückspult.
function shortestAngle(from, to) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
