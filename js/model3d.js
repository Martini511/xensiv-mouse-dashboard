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
const LED = "led";
const WHEEL = ["wheel_1055", "wheel_cover"];

// Blickrichtung ohne Zutun des Betrachters: leicht von rechts oben auf die
// Vorderseite. Winkel als Kugelkoordinaten um den Modellmittelpunkt.
const HOME = { azimuth: 0.55, polar: 1.02 };
const POLAR_LIMITS = [0.25, 1.45];

// Luft zwischen Modell und Bildrand.
const FIT_MARGIN = 1.04;

// So viele Blickrichtungen prüft die Abstandssuche. Feiner lohnt nicht: Die
// ungünstigste Lage ändert sich über wenige Grad kaum.
const FRAMING_AZIMUTHS = 48;
const FRAMING_POLARS = 8;

// So viele Richtungen tastet der Ladevorgang ab, um die äußersten Punkte des
// Modells zu finden. Der Hüllquader wäre einfacher, seine Ecken ragen aber weit
// über die gerundete Maus hinaus - das Bild bliebe unnötig weit weg.
const HULL_DIRECTIONS = 64;

// Nach dieser Ruhezeit gleitet die Ansicht zurück in die Ausgangslage.
const RETURN_DELAY = 2200;
const RETURN_EASE = 0.055;

// Die Maus zeigt mit der Nase zum Betrachter. Wer sie bedient, sitzt also
// dahinter – seine linke Taste liegt damit auf der +X-Seite des Modells.
const LEFT_IS_POSITIVE_X = true;

// Gedrückt wird die Taste eingefärbt, nicht nur aufgehellt: Auf dem hellen
// Deckel ginge ein reiner Leuchtanteil im Glanzlicht unter. Die Farbe ist
// dieselbe, die auch die Zeichnung benutzt.
const PRESS_COLOR = 0x12a190;
const PRESS_GLOW = 0.35;

// Über diesen Anteil der Tastenlänge klingt die Farbe nach hinten aus. Sie
// erlischt genau am Schlitzende – dort hört die Taste auf – reißt dort aber
// nicht an einer Kante ab, sondern verliert sich schon vorher. Ein Viertel
// reicht: Der Umschlagpunkt liegt damit hinter dem Radausschnitt, sodass die
// gut sichtbare Fläche zwischen Rad und Wabenfeld noch voll trägt.
const PRESS_FADE = 0.25;

// Die LED auf der Platine bleibt selbst unsichtbar - zu sehen ist nur ihr
// Licht im Gehäuse, das durch die Waben nach außen dringt. Das Innere ist
// dunkel und wirft wenig zurück, deshalb ist der Wert deutlich höher, als es
// für eine frei stehende Lampe nötig wäre.
const LED_LIGHT = 1.6;

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
    this.wheelMaterials = [];
    this.restWheel = [];
    this.press = null;
    this.hull = [];
    this.distance = 0.3;

    // Rechengrößen für die Bildschleife, einmal angelegt statt je Bild neu.
    this.direction = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.upward = new THREE.Vector3();
    this.worldUp = new THREE.Vector3(0, 1, 0);

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

    // Sitzt im Gehäuse und färbt den Blick durch die Waben. Der schwache
    // Abfall trägt das Licht bis in die Ecken der Schale; ihren Platz bekommt
    // sie beim Laden, sobald die LED gefunden ist.
    this.ledLight = new THREE.PointLight(0x12a190, 0, 0.4, 1.2);
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
    this.pivot.updateMatrixWorld(true);
    this.hull = extremePoints(gltf.scene);
    this.#updateFraming();

    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      const name = object.name.toLowerCase();

      if (WHEEL.some((key) => name.includes(key))) {
        this.wheels.push(object);
        this.wheelMaterials.push(object.material);
        this.restWheel.push(object.material.color.clone());
      }
      if (name.includes(COVER)) this.#prepareCover(object);
      if (name === LED) {
        // Der Körper dient nur als Ortsangabe: Er verrät, wo auf der Platine
        // die LED sitzt, und tritt danach ab.
        object.visible = false;
        object.getWorldPosition(this.ledLight.position);
      }
    });

    this.#invalidate();
    return this;
  }

  // Der Deckel ist ein einziges Bauteil; die Tasten sind darin nur durch den
  // Schlitz in seiner Mitte angedeutet. Die Rückmeldung malt deshalb der
  // Shader: Er färbt die Taste vorn kräftig ein und lässt die Farbe zum
  // Schlitzende hin ausklingen. An der Geometrie ändert sich nichts.
  #prepareCover(mesh) {
    const geometry = mesh.geometry;
    const index = geometry.getIndex();
    const position = geometry.getAttribute("position");
    if (!index) return;

    const end = slotEnd(index, position);
    if (end === -Infinity) return;

    geometry.computeBoundingBox();
    const nose = geometry.boundingBox.max.z;
    this.press = {
      uPressColor: { value: new THREE.Color(PRESS_COLOR) },
      uPressGlow: { value: PRESS_GLOW },
      uPressed: { value: new THREE.Vector2(0, 0) },
      uPressFade: { value: new THREE.Vector2(end + (nose - end) * PRESS_FADE, end) },
    };

    // Ein eigenes Material, damit der Umbau nicht auf andere Bauteile
    // durchschlägt. Der eigene Schlüssel ist dabei Pflicht: Ohne ihn hielte
    // three.js die Kopie für das Original und gäbe ihr dessen Programm.
    const material = mesh.material.clone();
    material.customProgramCacheKey = () => "cover-press";
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.press);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>
          uniform vec2 uPressed;
          uniform vec2 uPressFade;
          varying float vPress;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vPress = smoothstep(uPressFade.y, uPressFade.x, position.z)
            * (position.x >= 0.0 ? uPressed.x : uPressed.y);`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
          uniform vec3 uPressColor;
          uniform float uPressGlow;
          varying float vPress;`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, uPressColor, vPress);`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          totalEmissiveRadiance += uPressColor * (vPress * uPressGlow);`);
    };
    mesh.material = material;
  }

  // ─── Anzeige ────────────────────────────────────────

  // Das Vorzeichen dreht die Richtung um: Ein wachsender Winkel aus der
  // Firmware bedeutet eine Drehung, bei der die Radoberseite zum Betrachter
  // wandert – am Modell entspricht das einer Drehung um die negative Achse.
  setWheelAngle(degrees) {
    const radians = THREE.MathUtils.degToRad(-degrees);
    this.wheels.forEach((wheel) => { wheel.rotation.x = radians; });
    this.#invalidate();
  }

  setButton(side, pressed) {
    if (!this.press) return;
    const positive = (side === "left") === LEFT_IS_POSITIVE_X;
    this.press.uPressed.value[positive ? "x" : "y"] = pressed ? 1 : 0;
    this.#invalidate();
  }

  // Der Radklick färbt Rad und Radabdeckung im selben Ton wie eine gedrückte
  // Taste. Das Rad ist dunkel, deshalb trägt hier vor allem die Farbe – der
  // Leuchtanteil setzt nur die Kante ab.
  setWheelPressed(pressed) {
    this.wheelMaterials.forEach((material, index) => {
      if (pressed) {
        material.color.setHex(PRESS_COLOR);
        material.emissive.setHex(PRESS_COLOR);
        material.emissiveIntensity = PRESS_GLOW;
      } else {
        material.color.copy(this.restWheel[index]);
        material.emissiveIntensity = 0;
      }
    });
    this.#invalidate();
  }

  setLed(hex, off) {
    this.ledLight.color.set(hex);
    this.ledLight.intensity = off ? 0 : LED_LIGHT;
    this.#invalidate();
  }

  reset() {
    this.setWheelAngle(0);
    this.setWheelPressed(false);
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
    this.#updateFraming();
    this.#invalidate();
  }

  #invalidate() {
    if (this.frame || !this.visible || document.hidden) return;
    this.frame = requestAnimationFrame(() => this.#draw());
  }

  // Der Abstand gilt für jede erreichbare Blickrichtung, nicht nur für die
  // gerade gezeigte: Sonst wüchse und schrumpfte die Maus beim Drehen. Gesucht
  // ist also die ungünstigste Lage – sie liegt in der Seitenansicht, wo die
  // Maus ihre ganze Länge quer ins Bild legt.
  #updateFraming() {
    if (!this.hull.length) return;

    const vertical = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);
    const horizontal = vertical * this.camera.aspect;
    const [lowPolar, highPolar] = POLAR_LIMITS;
    let worst = 0;

    for (let a = 0; a < FRAMING_AZIMUTHS; a++) {
      const azimuth = (a / FRAMING_AZIMUTHS) * Math.PI * 2;
      for (let p = 0; p <= FRAMING_POLARS; p++) {
        const polar = lowPolar + (highPolar - lowPolar) * (p / FRAMING_POLARS);
        worst = Math.max(worst,
          this.#fitDistance(azimuth, polar, horizontal, vertical));
      }
    }
    this.distance = worst * FIT_MARGIN;
  }

  // Wie weit muss die Kamera weg, damit das Modell ins Bild passt? Ein Punkt
  // ist sichtbar, solange sein seitlicher Abstand kleiner bleibt als die
  // Bildbreite in seiner Tiefe – nach dem Abstand aufgelöst ergibt das je
  // Hüllpunkt eine Untergrenze, die größte davon gilt.
  #fitDistance(azimuth, polar, horizontal, vertical) {
    this.direction.set(
      Math.sin(polar) * Math.sin(azimuth),
      Math.cos(polar),
      Math.sin(polar) * Math.cos(azimuth),
    );
    this.right.crossVectors(this.worldUp, this.direction).normalize();
    this.upward.crossVectors(this.direction, this.right);

    let distance = 0;
    for (const point of this.hull) {
      const depth = point.dot(this.direction);
      distance = Math.max(distance,
        depth + Math.abs(point.dot(this.right)) / horizontal,
        depth + Math.abs(point.dot(this.upward)) / vertical);
    }
    return distance;
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

    this.direction.set(
      Math.sin(this.polar) * Math.sin(this.azimuth),
      Math.cos(this.polar),
      Math.sin(this.polar) * Math.cos(this.azimuth),
    );
    this.camera.position.copy(this.direction).multiplyScalar(this.distance);
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
    if (moving) this.#invalidate();
  }
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

// Wo läuft der Schlitz zwischen den Tasten aus? Vor seinem Ende ist der Deckel
// in der Mitte durchtrennt – dort überspannt kein einziges Dreieck die
// Mittelebene. Das vorderste Dreieck, das sie doch überspannt, markiert also
// die Schlitzspitze und damit das hintere Ende der Tasten.
function slotEnd(index, position) {
  let end = -Infinity;
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const a = index.getX(triangle);
    const b = index.getX(triangle + 1);
    const c = index.getX(triangle + 2);
    const xa = position.getX(a);
    const xb = position.getX(b);
    const xc = position.getX(c);
    if (Math.min(xa, xb, xc) > 0 || Math.max(xa, xb, xc) < 0) continue;
    end = Math.max(end, position.getZ(a), position.getZ(b), position.getZ(c));
  }
  return end;
}

// Die äußersten Punkte des Modells in gleichmäßig über die Kugel verteilte
// Richtungen. Das Ergebnis umschließt die Maus deutlich enger als ihr
// Hüllquader und ist die Grundlage für den Bildausschnitt.
function extremePoints(root) {
  const directions = [];
  for (let i = 0; i < HULL_DIRECTIONS; i++) {
    const y = 1 - (2 * i + 1) / HULL_DIRECTIONS;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = i * 2.399963;                        // goldener Winkel
    directions.push([Math.cos(angle) * radius, y, Math.sin(angle) * radius]);
  }

  const best = directions.map(() => ({ value: -Infinity, point: null }));
  const vertex = new THREE.Vector3();

  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!object.isMesh) return;
    const position = object.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      for (let d = 0; d < directions.length; d++) {
        const direction = directions[d];
        const value = vertex.x * direction[0]
          + vertex.y * direction[1]
          + vertex.z * direction[2];
        if (value > best[d].value) {
          best[d].value = value;
          best[d].point = vertex.clone();
        }
      }
    }
  });

  return best.filter((entry) => entry.point).map((entry) => entry.point);
}

// Kürzester Weg zurück zur Ausgangsrichtung, damit die Ansicht nach mehreren
// Umdrehungen nicht zurückspult.
function shortestAngle(from, to) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
