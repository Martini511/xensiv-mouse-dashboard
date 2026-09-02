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
const LED = "led";
const DPI = "dpi";
const SENSOR = "sensor";
const WHEEL = ["wheel_1055", "wheel_cover"];
const GUARD = "axis_holder";
const AXLE = "axis_2205";

// Blickrichtung ohne Zutun des Betrachters: leicht von rechts oben auf die
// Vorderseite. Winkel als Kugelkoordinaten um den Modellmittelpunkt.
const HOME = { azimuth: 0.55, polar: 1.02 };
const POLAR_LIMITS = [0.25, 1.45];

// Der optische Sensor sitzt auf der Unterseite. Wer seine Auflösung einstellt,
// soll ihn sehen - das Gerät liegt dafür auf dem Rücken. Gedreht wird hier
// nicht: Es gibt genau eine Seite, um die es geht.
const UNDER_HOME = { azimuth: 0.55, polar: Math.PI - 0.95 };

// Die nackte Platine ist flach: Von schräg oben zeigt sie am meisten von sich
// und füllt das Bild, statt als Strich darin zu liegen.
const BOARD_HOME = { azimuth: 0.55, polar: 0.62 };

// Der Radsensor liegt unter dem Achshalter und ist von fast überall verdeckt.
// Ein Strahlentest über alle Blickrichtungen findet genau zwei, aus denen er
// ganz frei steht - diese ist die bessere: von hinten über die Platine, das
// Rad aufrecht in der Mitte und der Sensor davor. Von hier aus beginnt die
// Radansicht, und hierhin gleitet sie zurück.
const WHEEL_HOME = { azimuth: 3.53, polar: 1.08 };

// Nur diesen einen Sensor gibt es, und die Kalibrierung dreht sich um ihn.
const WHEEL_SENSOR = "wheel.centre";
const WHEEL_SENSOR_NAME = "TLI493D-M4D7";

// Von wo aus der Prüfstrahl auf den Sensor zuläuft, und wie viel Luft er dem
// Bauteil selbst lässt - sonst meldete dessen eigene Oberfläche einen Treffer.
const GUARD_REACH = 0.3;                                 // m
const GUARD_SKIN = 0.0015;                               // m

// Rad, Radkappe und Achse drehen sich um dieselbe Achse, sind also Dreh-
// körper. Für die Sichtprobe tritt deshalb je Teil ein Zylinder an seine
// Stelle; ein Strahl gegen deren knapp dreihundert Dreiecke kostet ein
// Sechstel dessen, was die vierzehntausend der Teile selbst kosten.
const PROXY_SIDES = 24;

// Beim Blick auf die nackte Platine darf der Betrachter auch darunter
// schauen. Die Pole bleiben knapp ausgespart - genau senkrecht von oben
// verliert die Kamera ihre Ausrichtung.
const POLAR_FREE = [0.05, Math.PI - 0.05];

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

// Der Wechsel des Reiters ist etwas anderes als die traege Rueckkehr nach
// dem Loslassen: Er ist gewollt, und die Ansicht darf ihm zuegiger folgen -
// aber eben folgen und nicht umspringen. Wer den Reiter wechselt, soll
// sehen, wohin die Ansicht wandert; sonst muss er das Modell jedes Mal neu
// suchen.
const VIEW_EASE = 0.09;

// Die Maus zeigt mit der Nase zum Betrachter. Wer sie bedient, sitzt also
// dahinter – seine linke Taste liegt damit auf der +X-Seite des Modells.
const LEFT_IS_POSITIVE_X = true;

// Die vier Sensoren sind drei Millimeter groß und haben dieselbe Farbe wie
// die übrige Bestückung. Eine Linie an ihren scharfen Kanten hebt sie aus
// der Reihe der Quader heraus, auch wenn sie gerade nicht eingefärbt sind.
// Der Schwellwinkel hält Rundungen frei: Gezeigt wird die Silhouette, nicht
// jede Facette der Tesselierung.
const EDGE_ANGLE = 30;                                   // Grad
const EDGE_COLOR = 0x06181a;
const EDGE_OPACITY = 0.55;

// Liegt der eingestellte Sensor hinter der Platine, tritt sein gestrichelter
// Umriss an seine Stelle. Er steht dabei immer im Lichthof, denn beides
// erscheint nur gemeinsam – und gegen dessen Helligkeit kommt keine helle
// Linie an. Eine dunkle schon: Sie liest sich im Schein wie auf der Platine,
// und dunkle Strichlinien sind in der technischen Zeichnung ohnehin die
// Regel.
const HIDDEN_COLOR = 0x02201d;
const HIDDEN_OPACITY = 1;

// Gedrückt wird die Taste eingefärbt, nicht nur aufgehellt: Auf dem hellen
// Deckel ginge ein reiner Leuchtanteil im Glanzlicht unter. Die Farbe ist
// dieselbe, die auch die Zeichnung benutzt.
const PRESS_COLOR = 0x12a190;
const PRESS_GLOW = 0.35;

// Der Weg zur Schwelle und das Ausloesen sind zweierlei, und die Taste sagt
// beides. Waehrend des Anlaufs traegt sie Blau - je fester gedrueckt wird,
// desto tiefer. Beim Ueberschreiten springt sie ohne Uebergang auf das Gruen,
// das in dieser Oberflaeche ueberall "ausgeloest" heisst. So ist der
// Ausloesepunkt am Farbwechsel abzulesen.
//
// Blau und nicht das Orange der Schwellenmarke, aus zwei Gruenden. Aufgehellt
// bleibt Blau erkennbar Blau, waehrend Orange zu Rosa wird - einer anderen
// Farbe, nicht derselben in schwach. Und Orange neben Gruen ist genau das
// Paar, das bei Rot-Gruen-Sehschwaeche zusammenfaellt; Blau neben Gruen bleibt
// auch dann zu unterscheiden.
const PRESS_NEAR_COLOR = 0x6bb2ff;
const PRESS_NEAR_DEEP = 0x0b4fbe;
const PRESS_TRIP_COLOR = PRESS_COLOR;

// Eine halbe Beimischung auf weissem Gehaeuse ergibt keine halbe Farbe,
// sondern Pastell. Dagegen hilft zweierlei: Der Ton dunkelt mit dem Druck
// nach, und die Beimischung waechst anfangs steiler als der Druck. Bei null
// bleibt sie null, damit eine unberuehrte Taste weiss bleibt.
const PRESS_NEAR_CURVE = 0.5;

// Oberhalb der Schwelle ist die Beimischung schon voll ausgefahren und kann
// den weiteren Druck nicht mehr zeigen. Sie durch Leuchten zu steigern hat
// sich als Irrweg erwiesen: Auf dem hellen Deckel brennt das die Farbe aus,
// und aus dem kraeftigen Gruen wird ein blasses Mint - je fester gedrueckt,
// desto weniger Farbe. Auf hellem Grund liest sich "staerker" als satter und
// tiefer. Der Ton wandert deshalb ins Dunkle; das Leuchten setzt nur eine
// Kante und bleibt so schwach, dass es nichts ueberstrahlt.
const PRESS_DEEP_COLOR = 0x02463d;
const PRESS_TRIP_GLOW = [0.1, 0.45];

// Ein Sensorgehäuse misst drei Millimeter auf einer Platine von hundert. Bei
// der Leuchtstärke einer Taste wäre es ein Fleck, den man suchen muss – und
// selbst hell bliebe es klein. Deshalb bekommt es zusätzlich einen Lichthof,
// so wie das Video die Bauteile mit einer Fahne herausstellt.
const SENSOR_GLOW = 1.6;
const SENSOR_HALO = 0.028;                               // m

// Wie heiß der Kern des Lichtflecks ist. Über der hellen Platine würde ein
// voller Kern ins Weiße laufen und den Sensor verschlucken, den er zeigen
// soll - dort ist Zurückhaltung geboten. Das Fenster in der dunklen
// Unterseite hat dieses Problem nicht: Es soll leuchten, nicht andeuten.
const HALO_CORE = 0.42;
const DPI_CORE = 1.0;

// Der Lichthof scheint durch die Platine hindurch. Der Tiefenpuffer bliebe
// zwar der ehrlichere Weg, gibt aber ein hässliches Bild: Vom Schein kämen
// nur die Teile durch, die zufällig auf die Schlitze neben den Stegen
// treffen, und statt eines Kreises sähe man deren Umrisse. Lieber ein
// sauberer Kreis, der über allem liegt – dass der Sensor dahinter sitzt,
// sagt ohnehin sein gestrichelter Umriss.
//
// Ganz senkrecht auf die Platinenkante geschaut würde der Kreis bedeutungs-
// los: Er stünde über einer Fläche, die man gar nicht sieht. Dieser Wert
// sagt, ab welcher Neigung die Seite als abgewandt gilt.
const FACING_EDGE = 0.04;                                // Kosinus zur Fläche

// Zeigt der Betrachter auf eine Sensorzeile, rückt das Modell den Sensor
// heran. Die Blickrichtung dreht dabei mit: Der Hall-Sensor liegt oben auf
// dem Steg, der Force-Sensor unten darunter – ohne den Schwenk sähe man nur
// die Platine, die ihn verdeckt. Der Schwenk zur Seite holt ihn aus der
// Verkürzung heraus, in der er sonst am Rand der Platine käme.
//
// Der Lichthof schrumpft dabei: Aus der Entfernung macht er das Bauteil
// überhaupt erst auffindbar, aus der Nähe überstrahlte er genau das, was
// man sehen will.
// Der Fokus rückt auf diesen Bruchteil des Ruheabstands heran. Ein fester
// Abstand in Metern taugt dafür nicht: Wie gross das Bauteil erscheint, hängt
// auch am Zeichenfeld, und das wächst mit dem Fenster.
const FOCUS_ZOOM = 0.22;
const FOCUS_TILT = 0.8;                                  // rad zur Senkrechten
const FOCUS_SWING = 0.7;                                 // rad zur Sensorseite
const FOCUS_EASE = 0.11;
const FOCUS_HALO = 0.5;                                  // Vielfaches

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

// Das Bewegungslicht im Fenster der Unterseite. Es steht für die Abtastung:
// je feiner die Auflösung, desto heller. Rot, weil ein optischer Maussensor
// rot leuchtet - die türkise Farbe gehört der Deckenbeleuchtung.
//
// Zu sehen ist vor allem der Schein nach außen, derselbe Lichthof wie an den
// hervorgehobenen Sensoren. Die Lampe im Gehäuse begleitet ihn nur: Sie legt
// etwas Rot auf die Kanten der Öffnung, damit der Schein nicht wie ein
// aufgeklebter Fleck wirkt.
const DPI_COLOR = 0xff2a18;
const DPI_LIGHT = [0.06, 1.5];                           // dunkelster, hellster
const DPI_HALO = [0.012, 0.046];                         // m, Durchmesser
const DPI_HALO_FADE = [0.3, 1.0];                        // Deckkraft
const DPI_HALO_OUT = 0.004;                              // m, vor dem Fenster

// Das Rad dreht sich bei der Kalibrierung von selbst weiter - so ist auf
// einen Blick klar, worum es auf dem Reiter geht.
const SPIN_SPEED = 80;                                   // Grad je Sekunde

// Was die Ansicht zeigt und was sie zulässt. Die Live-Ansicht bleibt bei
// "live"; die Konfigurationsseite schaltet mit dem geöffneten Reiter um.
// `turn` ist der erlaubte Höhenwinkel oder null, wenn nicht gedreht wird.
// `tag` nennt einen Sensor, dessen Schild ohne Zutun des Betrachters steht.
const VIEWS = {
  live: { shell: true, spin: false, turn: POLAR_LIMITS, home: HOME },
  light: { shell: true, spin: false, turn: null, home: HOME },
  pointer: { shell: true, spin: false, turn: null, home: UNDER_HOME },
  sensors: { shell: false, spin: false, turn: POLAR_FREE, home: BOARD_HOME },
  wheel: {
    shell: false, spin: true, turn: POLAR_FREE, home: WHEEL_HOME,
    tag: { key: WHEEL_SENSOR, name: WHEEL_SENSOR_NAME },
  },
};

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
    this.lastFrame = 0;
    this.frame = 0;
    this.visible = true;
    this.view = VIEWS.live;
    this.shell = [];
    this.edges = [];
    this.sensors = {};
    this.chosen = {};
    this.focus = null;
    this.marked = null;
    this.settling = false;
    this.wheels = [];
    this.wheelMaterials = [];
    this.restWheel = [];
    this.press = null;
    this.hull = [];
    this.distance = 0.3;
    this.baseDistance = 0.3;

    // Rechengrößen für die Bildschleife, einmal angelegt statt je Bild neu.
    this.direction = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.upward = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.baseTarget = new THREE.Vector3();
    this.place = new THREE.Vector3();
    this.worldUp = new THREE.Vector3(0, 1, 0);
    this.blockers = [];
    this.ray = new THREE.Raycaster();
    this.probe = new THREE.Vector3();
    this.away = new THREE.Vector3();

    // Das Namensschild ist eine Beschriftung, kein Bauteil: Als Text im
    // Dokument bleibt es bei jeder Auflösung scharf und nimmt die Schrift
    // der Seite an. Seinen Platz bekommt es je Bild aus der Kamera.
    this.label = document.createElement("div");
    this.label.className = "model-label";
    this.label.hidden = true;
    canvas.parentElement.appendChild(this.label);

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

    // Dasselbe für das Fenster in der Unterseite. Die kurze Reichweite hält
    // den Schein am Ort: Er soll aus der Öffnung dringen, nicht die halbe
    // Schale von innen ausleuchten.
    this.dpiLight = new THREE.PointLight(DPI_COLOR, 0, 0.05, 1.8);
    this.dpiHalo = null;
    this.dpiShare = 0;
    this.scene.add(this.dpiLight);
  }

  #setupInput() {
    const pointers = new Map();
    let last = null;

    this.canvas.addEventListener("pointerdown", (event) => {
      pointers.set(event.pointerId, event);
      last = event;
      // Wer selbst dreht, hat Vorrang vor einem laufenden Reiterwechsel.
      this.settling = false;
      this.canvas.setPointerCapture(event.pointerId);
      this.lastInput = Infinity;      // solange gehalten wird, kein Rücklauf
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId) || !last) return;
      if (!this.view.turn || this.focus) return;
      this.azimuth -= (event.clientX - last.clientX) * 0.008;
      this.polar = clamp(
        this.polar - (event.clientY - last.clientY) * 0.008, ...this.view.turn);
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

    const place = new THREE.Vector3();
    const spinning = [];
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      const name = object.name.toLowerCase();

      if (WHEEL.some((key) => name.includes(key))) {
        this.wheels.push(object);
        this.wheelMaterials.push(object.material);
        this.restWheel.push(object.material.color.clone());
      }
      if (name.includes(COVER)) this.#prepareCover(object);
      if (name.includes(COVER) || name.includes(BODY)) this.shell.push(object);

      // Was dem Radsensor im Weg stehen kann: der Halter mit seiner Form,
      // die Drehteile je mit ihrem Platzbedarf.
      if (name.includes(GUARD)) this.blockers.push(object);
      if (name.includes(AXLE) || WHEEL.some((key) => name.includes(key))) {
        spinning.push(object);
      }
      if (name === LED) {
        // Der Körper dient nur als Ortsangabe: Er verrät, wo auf der Platine
        // die LED sitzt, und tritt danach ab.
        object.visible = false;
        centreOf(object, this.ledLight.position);
      }
      if (name === DPI) {
        object.visible = false;
        centreOf(object, this.dpiLight.position);

        // Der Schein gehört vor das Fenster, nicht dahinter. Die Lampe steht
        // im Gehäuse, wo sie hingehört; der Lichthof rückt nach außen, sonst
        // läge er hinter dem Boden, durch den er dringen soll.
        this.dpiHalo = this.#addHalo(this.dpiLight.position, DPI_CORE);
        this.dpiHalo.position.y -= DPI_HALO_OUT;
        this.dpiHalo.material.color.setHex(DPI_COLOR);
      }
      if (name.startsWith(SENSOR)) {
        // Der Name nennt die Familie, die Lage die Seite – letzteres nach
        // derselben Regel wie bei den Tasten, damit beides zusammenpasst.
        // Der Radsensor sitzt auf der Mittellinie und hat keine Seite.
        centreOf(object, place);
        const family = name.includes("hall") ? "hall"
          : name.includes("force") ? "force"
            : "wheel";
        const side = family === "wheel" ? "centre"
          : (place.x >= 0) === LEFT_IS_POSITIVE_X ? "left" : "right";

        this.sensors[`${family}.${side}`] = {
          material: object.material,
          rest: object.material.color.clone(),
          halo: this.#addHalo(place),
          hidden: this.#addEdges(object),
          position: place.clone(),
          // Der Hall-Sensor sitzt oben auf dem Steg, der Force-Sensor unten.
          // Der Radsensor liegt ebenfalls oben, aber unter dem Achshalter:
          // Dass seine Seite dem Betrachter zugewandt ist, heisst bei ihm
          // noch nicht, dass man ihn sieht.
          facing: family === "force" ? -1 : 1,
          guarded: family === "wheel",
          plain: false,
          lit: false,
        };
      }
    });

    // Der Hüllkörper zählt nur, was auch zu sehen ist – die LED ist eben
    // abgetreten, das Gehäuse kann später folgen.
    this.#measure(gltf.scene);
    spinning.forEach((part) => this.#addSpinProxy(part));

    // Die Ansicht kann schon vor dem Laden gesetzt worden sein; erst jetzt
    // gibt es die Sensoren, die sie hervorhebt.
    this.#showSensors();
    this.#showDpi();
    this.#invalidate();
    return this;
  }

  // Äußere Punkte und Mittelpunkt des Sichtbaren. Beides hängt zusammen: Ohne
  // Gehäuse liegt die Platine nicht mehr in der Mitte der Baugruppe, und eine
  // Kamera, die weiter auf den Ursprung zielt, schöbe sie an den Bildrand.
  #measure(root) {    const points = extremePoints(root);
    const box = new THREE.Box3();
    points.forEach((point) => box.expandByPoint(point));
    box.getCenter(this.baseTarget);
    this.hull = points.map((point) => point.sub(this.baseTarget));
    this.target.copy(this.baseTarget);
    this.#updateFraming();
  }

  // ─── Darstellung wählen ─────────────────────────────

  // Die Konfigurationsseite zeigt zu jedem Reiter, worum es geht: Beim
  // Tastenreiter fällt das Gehäuse weg und die Sensoren treten hervor, bei
  // der Radkalibrierung dreht sich das Rad. Der Bildausschnitt wird dabei neu
  // bestimmt – ohne Gehäuse ist deutlich weniger zu zeigen.
  setView(name) {
    const view = VIEWS[name] || VIEWS.live;
    if (view === this.view) return;
    this.view = view;
    this.clearFocus();

    this.shell.forEach((part) => { part.visible = view.shell; });

    // Gezeigt werden die Kanten genau dann, wenn das Gehäuse fehlt: Am
    // vollständigen Gerät sind die Sensoren ohnehin verdeckt.
    this.edges.forEach((line) => { line.visible = !view.shell; });

    this.wheelMaterials.forEach((material, index) => {
      tint(material, this.restWheel[index], view.spin);
    });
    this.#showSensors();
    this.#showLed();
    this.#showDpi();

    // Nicht die Winkel setzen, sondern den Weg dorthin freigeben: Die
    // Bildschleife gleitet in die neue Ruhelage. Abstand und Blickpunkt
    // gleiten ohnehin schon mit - es fehlte allein der Winkel.
    this.settling = true;
    this.#measure(this.pivot);
    this.#invalidate();
  }

  // Hervorgehoben wird je Taste der Sensor, der im Gerät auch misst. Die
  // Platine trägt beide Familien: den Hall-Sensor oben am freien Ende des
  // Stegs, den Force-Sensor unten an seiner Einspannung. Übergeben wird je
  // Seite "hall", "force" oder nichts.
  setSensors(chosen) {
    this.chosen = chosen;
    this.#showSensors();
  }

  // Zeigt der Betrachter auf eine Sensorzeile, holt das Modell diesen einen
  // Sensor heran und nennt seinen Namen – auch einen abgeschalteten, denn
  // gerade beim Umstellen will man sehen, worum es geht.
  focusSensor(family, side, name) {
    const sensor = this.sensors[`${family}.${side}`];
    if (!sensor || this.view !== VIEWS.sensors) return;

    this.focus = {
      sensor,
      key: `${family}.${side}`,
      // Von der Fläche her, auf der er klebt, und von seiner Seite: Sonst
      // verdeckte ihn die Platine oder er verschwände in der Verkürzung.
      polar: family === "hall" ? FOCUS_TILT : Math.PI - FOCUS_TILT,
      azimuth: Math.sign(sensor.position.x) * FOCUS_SWING,
    };
    this.label.textContent = name;
    this.#showSensors();
  }

  clearFocus() {
    if (!this.focus) return;
    this.focus = null;
    this.#showSensors();
  }

  // Die Ruhelage der Sensoransicht zeigt die Platine von schräg oben. Dass
  // die Force-Sensoren darunter sitzen, trägt jetzt die gestrichelte
  // Darstellung – die Ansicht muss sich dafür nicht mehr umdrehen.
  #showSensors() {
    Object.entries(this.sensors).forEach(([key, sensor]) => {
      const [family, side] = key.split(".");
      const aimed = this.focus?.key === key;
      // Der Radsensor gehoert zur Radkalibrierung und wird dort nicht
      // gewaehlt: Es gibt nur diesen einen, und er misst immer.
      const on = family === "wheel"
        ? this.view === VIEWS.wheel
        : this.view === VIEWS.sensors
          && (aimed || this.chosen[side] === family);

      tint(sensor.material, sensor.rest, on, SENSOR_GLOW);
      sensor.lit = on;
      sensor.halo.visible = on;
      sensor.halo.scale.setScalar(aimed ? SENSOR_HALO * FOCUS_HALO : SENSOR_HALO);
    });

    // Das Schild nennt, worum es gerade geht: beim Zeigen den Sensor unter
    // dem Zeiger, sonst den, um den sich die Ansicht ohnehin dreht.
    const tag = this.view.tag;
    this.marked = this.focus?.sensor || (tag && this.sensors[tag.key]) || null;
    if (this.marked && !this.focus) this.label.textContent = tag.name;

    this.#invalidate();
  }

  // Auf welcher Seite der Platine steht der Betrachter? Je Bild neu, denn die
  // Antwort ändert sich mit jeder Drehung. Sie entscheidet allein über den
  // gestrichelten Umriss; der Lichthof scheint in jedem Fall herauf.
  #faceMarks() {
    Object.values(this.sensors).forEach((sensor) => {
      const facing = this.direction.y * sensor.facing;
      // Die Probe kostet eine knappe halbe Millisekunde - wenig, aber je
      // Bild. Wer gerade nicht leuchtet, braucht sie gar nicht.
      sensor.plain = facing > FACING_EDGE
        && !(sensor.guarded && sensor.lit && this.#blocked(sensor.position));
      sensor.hidden.visible = sensor.lit && !sensor.plain;
    });
  }

  // Steht dem Sensor etwas im Weg? Ein Strahl von aussen auf das Bauteil
  // sagt es. Geprüft wird gegen zwei Hindernisse: den Achshalter, dessen
  // Form zählt, weil gerade seine Lücke den Sensor freigibt, und die
  // Drehteile als Zylinder. Die Platine deckt schon der Seitenvergleich ab.
  // Gegen alle sichtbaren Netze gerechnet kam über 1488 Blickrichtungen
  // dasselbe heraus, bis auf vier - und die liegen kantig zur Platine, wo
  // der Sensor ohnehin ein Strich ist.
  #blocked(position) {
    if (!this.blockers.length) return false;
    this.probe.copy(this.direction).multiplyScalar(GUARD_REACH).add(position);
    this.ray.set(this.probe, this.away.copy(this.direction).negate());
    return this.ray.intersectObjects(this.blockers, false)
      .some((hit) => hit.distance < GUARD_REACH - GUARD_SKIN);
  }

  // Rad, Radkappe und Achse sind Drehkörper um dieselbe Achse; ihr Umriss
  // ändert sich beim Drehen nicht. Für die Sichtprobe tritt deshalb je Teil
  // ein Zylinder an seine Stelle - unsichtbar, und zusammen kosten sie ein
  // Sechstel dessen, was die echten Netze kosten.
  //
  // Je Teil einer, nicht einer um alle drei: Der nähme die Länge von der
  // zweiundzwanzig Millimeter breiten Achse und den Durchmesser von der
  // zwanzig Millimeter hohen Kappe und wäre damit eine Trommel, die es nicht
  // gibt. Sie verdeckte den Sensor in über hundert Blickrichtungen, aus denen
  // er in Wahrheit zu sehen ist.
  #addSpinProxy(part) {
    part.geometry.computeBoundingBox();
    const box = part.geometry.boundingBox.clone()
      .applyMatrix4(part.matrixWorld);
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.y, size.z) * 0.5;

    const proxy = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, size.x, PROXY_SIDES));
    proxy.rotation.z = Math.PI / 2;
    proxy.position.copy(box.getCenter(new THREE.Vector3()));
    proxy.visible = false;
    this.pivot.add(proxy);
    proxy.updateMatrixWorld(true);
    this.blockers.push(proxy);
  }

  // Der Lichthof liegt als Schild im Raum und dreht sich mit dem Blick mit.
  // Er verdeckt nichts, denn er wird addiert statt darübergemalt, und er
  // fragt nicht nach der Tiefe: So bleibt er ein Kreis, auch wenn zwischen
  // ihm und dem Auge die Platine steht.
  #addHalo(position, core = HALO_CORE) {
    this.haloTextures = this.haloTextures || new Map();
    if (!this.haloTextures.has(core)) {
      this.haloTextures.set(core, makeHalo(core));
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.haloTextures.get(core),
      color: PRESS_COLOR,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }));
    halo.scale.setScalar(SENSOR_HALO);
    halo.position.copy(position);
    halo.visible = false;
    this.pivot.add(halo);
    return halo;
  }

  // Die Kanten hängen als Kind am Sensor: So machen sie jede Bewegung mit,
  // ohne dass jemand ihre Lage nachführen müsste. Die Fläche selbst rückt
  // dabei ein Stück nach hinten – sonst läge die Linie genau auf ihr und der
  // Tiefenpuffer könnte sich nicht entscheiden.
  //
  // Denselben Umriss gibt es ein zweites Mal, gestrichelt und ohne
  // Tiefenprüfung: Er tritt an die Stelle des Sensors, wenn dieser hinter der
  // Platine liegt. Verdeckte Kanten gestrichelt zu zeichnen ist die Regel der
  // technischen Zeichnung – und sie behauptet nichts Falsches, anders als ein
  // Schein, der durch das Material zu dringen scheint.
  #addEdges(mesh) {
    const material = mesh.material;
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;

    const outline = new THREE.EdgesGeometry(mesh.geometry, EDGE_ANGLE);
    const edges = new THREE.LineSegments(outline, new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: EDGE_OPACITY,
    }));
    edges.visible = false;
    mesh.add(edges);
    this.edges.push(edges);

    // Die Strichlänge folgt der Größe des Bauteils. Ein fester Wert ginge
    // nicht: Die Eckpunkte liegen quantisiert vor, und jedes Netz bringt
    // seinen eigenen Maßstab mit – dieselbe Zahl ergäbe je Sensor ein
    // anderes Muster.
    outline.computeBoundingSphere();
    const dash = outline.boundingSphere.radius / 7;

    const hidden = new THREE.LineSegments(outline, new THREE.LineDashedMaterial({
      color: HIDDEN_COLOR,
      dashSize: dash,
      gapSize: dash * 0.8,
      transparent: true,
      opacity: HIDDEN_OPACITY,
      depthTest: false,
    }));
    hidden.computeLineDistances();
    hidden.renderOrder = 1;
    hidden.visible = false;
    mesh.add(hidden);
    return hidden;
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
      uNearColor: { value: new THREE.Color(PRESS_NEAR_COLOR) },
      uNearDeep: { value: new THREE.Color(PRESS_NEAR_DEEP) },
      uTripColor: { value: new THREE.Color(PRESS_TRIP_COLOR) },
      uDeepColor: { value: new THREE.Color(PRESS_DEEP_COLOR) },
      uNearCurve: { value: PRESS_NEAR_CURVE },
      uPressGlow: { value: new THREE.Vector2(...PRESS_TRIP_GLOW) },
      uPressed: { value: new THREE.Vector2(0, 0) },
      uPressTrip: { value: new THREE.Vector2(0, 0) },
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
          uniform vec2 uPressTrip;
          uniform vec2 uPressFade;
          varying float vShare;
          varying float vTrip;
          varying float vFade;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float pressSide = position.x >= 0.0 ? 1.0 : 0.0;
          vShare = mix(uPressed.y, uPressed.x, pressSide);
          vTrip = mix(uPressTrip.y, uPressTrip.x, pressSide);
          vFade = smoothstep(uPressFade.y, uPressFade.x, position.z);`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
          uniform vec3 uNearColor;
          uniform vec3 uNearDeep;
          uniform vec3 uTripColor;
          uniform vec3 uDeepColor;
          uniform float uNearCurve;
          uniform vec2 uPressGlow;
          varying float vShare;
          varying float vTrip;
          varying float vFade;
          // Beide Abschnitte arbeiten gleich: Der Ton dunkelt mit dem Druck
          // nach. Nur der Anlauf regelt zusaetzlich die Beimischung hoch,
          // waehrend sie oberhalb der Schwelle voll steht. Der Uebergang
          // dazwischen ist keiner - step, nicht smoothstep: Der Farbwechsel ist
          // die Meldung, dass die Schwelle ueberschritten ist, und eine Meldung
          // gilt oder gilt nicht.
          float pressTrip() { return step(0.5, vTrip); }
          vec3 pressTone() {
            return mix(mix(uNearColor, uNearDeep, vShare),
              mix(uTripColor, uDeepColor, vShare), pressTrip());
          }
          float pressAmount() {
            return vFade * mix(pow(vShare, uNearCurve), 1.0, pressTrip());
          }`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, pressTone(), pressAmount());`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          totalEmissiveRadiance += pressTone() * (pressAmount() * pressTrip()
            * mix(uPressGlow.x, uPressGlow.y, vShare));`);
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

  // Wie stark sich die Taste faerbt, sagt der Druck; welche Farbe sie traegt,
  // sagt allein die Schwelle. Der Anteil zaehlt dabei innerhalb des jeweiligen
  // Abschnitts: unter der Schwelle der Anlauf auf sie zu, darueber das, was
  // ueber sie hinausgeht.
  setButton(side, share = 0, tripped = false) {
    if (!this.press) return;
    const positive = (side === "left") === LEFT_IS_POSITIVE_X;
    const axis = positive ? "x" : "y";

    this.press.uPressed.value[axis] = clamp(share, 0, 1);
    this.press.uPressTrip.value[axis] = tripped ? 1 : 0;
    this.#invalidate();
  }

  // Der Radklick färbt Rad und Radabdeckung im selben Ton wie eine gedrückte
  // Taste. Das Rad ist dunkel, deshalb trägt hier vor allem die Farbe – der
  // Leuchtanteil setzt nur die Kante ab.
  setWheelPressed(pressed) {
    this.wheelMaterials.forEach((material, index) => {
      tint(material, this.restWheel[index], pressed);
    });
    this.#invalidate();
  }

  setLed(hex, off) {
    this.ledColor = hex;
    this.ledOff = off;
    this.#showLed();
  }

  // Wie hell das Fenster leuchtet, sagt der Anteil, den der eingestellte Wert
  // in seinem Bereich einnimmt. Die Grenzen kommen von dort, wo sie ohnehin
  // stehen - am Schieberegler; hier noch einmal gefuehrt hiesse, sie zweimal
  // zu pflegen.
  setDpi(value, low, high) {
    this.dpiShare = clamp((value - low) / (high - low), 0, 1);
    this.#showDpi();
  }

  // Ohne Gehäuse hat das Licht keine Waben mehr, durch die es dringen könnte -
  // es würde die nackte Platine bloss türkis überziehen und die hervorgehobenen
  // Teile übertönen. Deshalb bleibt es dort aus.
  #showLed() {
    this.ledLight.color.set(this.ledColor || "#12a190");
    this.ledLight.intensity =
      this.ledOff || !this.view.shell ? 0 : LED_LIGHT;
    this.#invalidate();
  }

  // Nur wer auf die Unterseite sieht, sieht das Fenster. In jeder anderen
  // Ansicht bliebe vom Licht ein roter Fleck im Inneren - sichtbar durch die
  // Waben, ohne dass irgendetwas ihn erklaerte.
  #showDpi() {
    const on = this.view === VIEWS.pointer;
    const share = this.dpiShare;
    const between = ([low, high]) => low + (high - low) * share;

    this.dpiLight.intensity = on ? between(DPI_LIGHT) : 0;
    if (this.dpiHalo) {
      this.dpiHalo.visible = on;
      this.dpiHalo.scale.setScalar(between(DPI_HALO));
      this.dpiHalo.material.opacity = between(DPI_HALO_FADE);
    }
    this.#invalidate();
  }

  reset() {
    this.setWheelAngle(0);
    this.setWheelPressed(false);
    this.setButton("left", 0, false);
    this.setButton("right", 0, false);
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
  // Maus ihre ganze Länge quer ins Bild legt. Steht die Ansicht fest, genügt
  // die eine Richtung und das Modell darf entsprechend größer erscheinen.
  #updateFraming() {
    if (!this.hull.length) return;

    const vertical = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);
    const horizontal = vertical * this.camera.aspect;

    if (!this.view.turn) {
      const home = this.view.home;
      this.baseDistance = this.#fitDistance(
        home.azimuth, home.polar, horizontal, vertical) * FIT_MARGIN;
      // Waehrend eines Reiterwechsels nicht zupacken: Der Abstand gleitet
      // dann mit, statt den weichen Uebergang mit einem Sprung zu zerreissen.
      if (!this.focus && !this.settling) this.distance = this.baseDistance;
      return;
    }

    const [lowPolar, highPolar] = this.view.turn;
    let worst = 0;

    for (let a = 0; a < FRAMING_AZIMUTHS; a++) {
      const azimuth = (a / FRAMING_AZIMUTHS) * Math.PI * 2;
      for (let p = 0; p <= FRAMING_POLARS; p++) {
        const polar = lowPolar + (highPolar - lowPolar) * (p / FRAMING_POLARS);
        worst = Math.max(worst,
          this.#fitDistance(azimuth, polar, horizontal, vertical));
      }
    }
    this.baseDistance = worst * FIT_MARGIN;
    if (!this.focus && !this.settling) this.distance = this.baseDistance;
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
    const now = performance.now();
    const elapsed = Math.min(now - (this.lastFrame || now), 100) / 1000;
    this.lastFrame = now;
    const idle = now - this.lastInput;
    let moving = false;

    // Bei der Radkalibrierung dreht sich das Rad von selbst weiter. Das ist
    // zugleich der einzige Fall, in dem ohne Zutun ein Bild nach dem anderen
    // gebraucht wird.
    if (this.view.spin) {
      const step = THREE.MathUtils.degToRad(SPIN_SPEED * elapsed);
      this.wheels.forEach((wheel) => { wheel.rotation.x -= step; });
      moving = true;
    }

    // Beim Fokus führt der Sensor die Kamera: Sie schwenkt auf die Seite, von
    // der er zu sehen ist, und rückt an ihn heran. Ohne Fokus gilt wieder die
    // Ruhelage, in die die Ansicht nach kurzer Zeit zurückgleitet.
    if (this.focus) {
      const swing = shortestAngle(this.azimuth, this.focus.azimuth);
      this.azimuth += swing * FOCUS_EASE;
      this.polar += (this.focus.polar - this.polar) * FOCUS_EASE;
      moving = moving || Math.abs(swing) > 1e-3
        || Math.abs(this.focus.polar - this.polar) > 1e-3;
    } else if (this.settling || idle > RETURN_DELAY) {
      const home = this.view.home;
      const ease = this.settling ? VIEW_EASE : RETURN_EASE;
      const azimuth = shortestAngle(this.azimuth, home.azimuth);
      const polar = home.polar - this.polar;
      this.azimuth += azimuth * ease;
      this.polar += polar * ease;
      // Angekommen ist die Ansicht erst, wenn beide Winkel stimmen. Wird nur
      // die Drehung geprüft, endet ein Wechsel zwischen zwei Lagen gleicher
      // Drehrichtung sofort – und die Neigung springt in einem Schritt.
      const arrived = Math.abs(azimuth) <= 1e-4 && Math.abs(polar) <= 1e-4;
      moving = moving || !arrived;
      if (arrived) {
        this.azimuth = home.azimuth;
        this.polar = home.polar;
        this.settling = false;
      }
    }

    const wantDistance = this.focus
      ? this.baseDistance * FOCUS_ZOOM : this.baseDistance;
    const wantTarget = this.focus ? this.focus.sensor.position : this.baseTarget;
    this.distance += (wantDistance - this.distance) * FOCUS_EASE;
    this.target.lerp(wantTarget, FOCUS_EASE);
    moving = moving
      || Math.abs(wantDistance - this.distance) > 1e-5
      || this.target.distanceTo(wantTarget) > 1e-5;

    this.direction.set(
      Math.sin(this.polar) * Math.sin(this.azimuth),
      Math.cos(this.polar),
      Math.sin(this.polar) * Math.cos(this.azimuth),
    );
    this.#faceMarks();
    this.camera.position.copy(this.direction)
      .multiplyScalar(this.distance).add(this.target);
    this.camera.lookAt(this.target);

    this.renderer.render(this.scene, this.camera);
    this.#placeLabel();
    if (moving) this.#invalidate();
  }

  // Das Schild hängt am Bauteil, nicht am Bildrand: Sein Platz wird aus der
  // Kamera zurückgerechnet, damit es beim Heranfahren mitwandert. Der Versatz
  // des Zeichenfelds gehört dazu - es steht mittig in der Bühne, nicht bündig.
  #placeLabel() {
    // Das Schild nennt ein Bauteil, das man sieht. Steckt es hinter etwas,
    // sagt das seine Strichlinie - ein Name daneben behauptete zu viel. Beim
    // Zeigen auf eine Zeile gilt das nicht: Dort holt die Kamera den Sensor
    // gerade erst hervor, und das Schild soll den Weg dorthin begleiten.
    if (!this.marked || (!this.focus && !this.marked.plain)) {
      this.label.hidden = true;
      return;
    }
    this.place.copy(this.marked.position).project(this.camera);
    const left = this.canvas.offsetLeft
      + (this.place.x * 0.5 + 0.5) * this.canvas.clientWidth;
    const top = this.canvas.offsetTop
      + (-this.place.y * 0.5 + 0.5) * this.canvas.clientHeight;
    this.label.style.left = `${Math.round(left)}px`;
    this.label.style.top = `${Math.round(top)}px`;
    this.label.hidden = false;
  }
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

// Dieselbe Farbtreppe, die der Deckel zeigt - als CSS-Farbe fuer die Balken
// daneben. Die Skala gehoert an eine Stelle: Zwei Tabellen, die dasselbe
// bedeuten sollen, laufen frueher oder spaeter auseinander.
export function pressColor(share, tripped) {
  const part = clamp(share, 0, 1);
  const [from, to] = tripped
    ? [PRESS_TRIP_COLOR, PRESS_DEEP_COLOR]
    : [PRESS_NEAR_COLOR, PRESS_NEAR_DEEP];
  const channel = (shift) => {
    const low = (from >> shift) & 0xff;
    return Math.round(low + (((to >> shift) & 0xff) - low) * part);
  };
  return `rgb(${channel(16)} ${channel(8)} ${channel(0)})`;
}

// Wo ein Bauteil steckt, sagt seine Geometrie, nicht sein Knoten: Der Export
// legt alle Teile in einen gemeinsamen Ursprung und verschiebt allein ihre
// Punkte. `getWorldPosition` gäbe deshalb überall die Mitte des Modells.
function centreOf(mesh, out) {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox.getCenter(out)
    .applyMatrix4(mesh.matrixWorld);
}

// Weicher Lichtfleck, in der Mitte hell und nach außen auslaufend. Wie hell
// der Kern sein darf, hängt am Untergrund: Der Schein wird addiert, und über
// der hellen Platine liefe ein voller Kern ins Weiße aus. Die Abstufung nach
// außen bleibt in jedem Fall dieselbe.
function makeHalo(core) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  const glow = context.createRadialGradient(
    size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, `rgba(255, 255, 255, ${core})`);
  glow.addColorStop(.25, `rgba(255, 255, 255, ${core * 0.62})`);
  glow.addColorStop(.6, `rgba(255, 255, 255, ${core * 0.19})`);
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
}

// Hervorheben heißt einfärben statt nur aufhellen: Rad und Sensorgehäuse sind
// dunkel, ein reiner Leuchtanteil ginge darauf unter.
function tint(material, rest, on, glow = PRESS_GLOW) {
  if (on) {
    material.color.setHex(PRESS_COLOR);
    material.emissive.setHex(PRESS_COLOR);
    material.emissiveIntensity = glow;
  } else {
    material.color.copy(rest);
    material.emissiveIntensity = 0;
  }
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
    if (!object.isMesh || !object.visible) return;
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
