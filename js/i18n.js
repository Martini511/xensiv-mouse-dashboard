// Die Oberflaeche in zwei Sprachen.
//
// Englisch ist die Vorgabe und steht zugleich unuebersetzt im HTML: Bleibt
// dieses Modul aus - kein JavaScript, ein Ladefehler, ein alter Browser -,
// ist die Seite trotzdem vollstaendig lesbar. Das Deutsche liegt allein hier
// und wird beim Umschalten darueber gelegt.
//
// Uebersetzt wurde einmal und von Hand ins Repository gelegt, nicht im
// Browser beim Aufruf. Ein Schluessel fuer einen Uebersetzungsdienst waere im
// JavaScript einer statischen Seite fuer jeden lesbar, und der Text ist
// konstant - ihn je Besuch neu uebersetzen zu lassen hiesse, fuer dieselbe
// Antwort wieder und wieder zu zahlen.
//
// Die Fachbegriffe sind bewusst nicht durchgaengig eingedeutscht oder
// eingeenglischt: "Force" und "Hall" bezeichnen Bauteilfamilien und heissen
// in beiden Sprachen so, die Typbezeichnungen ohnehin.

export const LANGUAGES = { en: "English", de: "Deutsch" };
export const DEFAULT_LANGUAGE = "en";

const STORE = "xensiv.sprache";

const TEXTS = {
  en: {
    "page.title": "Infineon | XENSIV\u2122 Mouse Configurator",
    "intro.skip": "Skip",

    "brand.aria": "Infineon XENSIV mouse configurator",
    "brand.name": "XENSIV\u2122 Mouse",
    "brand.sub": "Configuration console",
    "battery.title": "Battery level",
    "lang.aria": "Language",
    "header.reconnect": "Reconnect",
    "header.connect": "Connect mouse",
    "header.disconnect": "Disconnect",

    "tabs.aria": "Views",
    "tabs.live": "Live monitoring",
    "tabs.config": "Configuration",

    "stage.device": "DEVICE 01",
    "stage.model": "MODEL",
    "stage.view": "VIEW",
    "stage.wheelAngle": "WHEEL ANGLE",
    "stage.buttons": "BUTTONS",
    "stage.led": "LED",
    "model.aria": "Model of the XENSIV mouse",
    "svg.aria": "Schematic view of the XENSIV mouse",

    "live.eyebrow": "LIVE TELEMETRY",
    "live.heading": "Sensor values",
    "live.rateBefore": "reaching",
    "live.rateAfter": "Hz",
    "live.clear": "Clear",
    "live.press": "Button pressure",
    "live.history": "History",

    "chart.angle": "ANGLE",
    "chart.samples": "Samples",
    "chart.field": "X / Z FIELD",
    "chart.path": "Magnetic path",

    "metric.angleCal": "ANGLE CALIBRATED",
    "metric.angleRaw": "ANGLE RAW",
    "metric.degrees": "Degrees",
    "metric.field": "FIELD X / Z",
    "metric.calibrated": "calibrated",
    "metric.raw": "raw",
    "metric.wheelPress": "WHEEL PRESSURE",
    "metric.radiusMax": "Radius / maximum length",

    "press.value": "Pressure",
    "press.threshold": "threshold",

    "config.eyebrow": "CONFIGURATION",
    "config.heading": "Mouse settings",
    "config.overview": "OVERVIEW",

    "acc.light.title": "Lighting",
    "acc.light.sub": "Colour of the top lighting",
    "led.pick": "Choose colour",
    "led.apply": "Apply",
    "led.quick": "QUICK COLOURS",
    "color.red": "Red",
    "color.green": "Green",
    "color.blue": "Blue",
    "color.off": "Off",
    "led.motion": "Switch on motion light",

    "acc.dpi.title": "Pointer resolution",
    "acc.dpi.sub": "Sampling rate of the optical sensor",
    "dpi.hint": "The value is transmitted as a 16-bit integer in little-endian "
      + "format. The model shows the underside: a light sits in the window of "
      + "the optical sensor and grows brighter with the resolution set.",

    "acc.buttons.title": "Button sensors",
    "acc.buttons.sub": "Enable and thresholds",
    "buttons.legend": "FOUR SENSORS \u00b7 THRESHOLD 0 \u2013 127",
    "buttons.load": "Load",
    "buttons.write": "Write to mouse",
    "buttons.colSensor": "Sensor",
    "buttons.colMode": "Trigger",
    "buttons.colThreshold": "Threshold",
    "buttons.colActive": "Active",

    "trigger.title": "Trigger behaviour",
    "trigger.aria": "Trigger mode",
    "trigger.fixed": "Fixed",
    "trigger.rapid": "Rapid",
    "trigger.press": "Press sensitivity",
    "trigger.release": "Release sensitivity",
    "trigger.deadzone": "Deadzone",
    "trigger.needsConnection": "Connect the mouse first. The trigger mode is "
      + "read from the device, not remembered by this page.",
    "trigger.unavailable": "Requires WebHID. This setting travels on the HID "
      + "feature report, which Web Bluetooth cannot reach \u2013 the HID service "
      + "is on the browser blocklist. Please use a current Chrome or Edge over "
      + "HTTPS and pair the mouse as a HID device.",
    "trigger.hint": "Fixed actuates above the threshold and releases at 85\u00a0% "
      + "of it. Rapid follows the signal instead: it releases as soon as you "
      + "back off by the release sensitivity and fires again once you push "
      + "back in by the press sensitivity, so a repeat click needs no return "
      + "past a fixed point. Lower values mean more sensitive. The deadzone "
      + "near rest forces a release and resets the tracking. Both modes keep "
      + "their own values in the mouse, so switching back and forth loses "
      + "nothing. The two marker lines on the live pressure bars show where "
      + "the device is actually switching.",
    "buttons.hint1": "Only one sensor measures per button: enabling one "
      + "releases the one so far on the same side. The thresholds take effect "
      + "in the device itself \u2013 if a threshold lies above the pressure the "
      + "sensor actually reaches, the button stops triggering across the whole "
      + "computer, even after this page is closed. The enable also decides "
      + "which sensor live monitoring follows per button; it shows the values "
      + "that can be reached.",
    "buttons.hint2": "If the mouse reports no enable at all when read \u2013 "
      + "recognisable by an answer in which no byte lies above 127 \u2013, what "
      + "was last written to the device takes its place. That note stays in "
      + "this browser, even after disconnecting and reloading. \u201cLoad\u201d "
      + "therefore discards unsaved changes. If nothing has ever been written, "
      + "the assumption is that the force sensors measure. The thresholds come "
      + "from the device in every case, and on writing the enable goes across "
      + "in full.",

    "acc.wheel.title": "Wheel calibration",
    "acc.wheel.sub": "Offsets, amplitudes and pressure threshold",
    "cal.offsetX": "Offset X",
    "cal.offsetZ": "Offset Z",
    "cal.amplitudeX": "Amplitude X",
    "cal.amplitudeZ": "Amplitude Z",
    "cal.ellipse": "Ellipse angle",
    "cal.trigger": "Pressure threshold",
    "cal.load": "Load values",
    "cal.save": "Save values",
    "cal.start": "Start 360\u00b0 calibration",
    "cal.hint": "The calibration run expects one full revolution of the wheel. "
      + "The pressure threshold is shown a thousand times larger than the "
      + "firmware keeps it \u2013 exactly as in the desktop tool. The live view "
      + "shows the mark a hundred units lower: the mouse clicks that much "
      + "earlier than the stored value suggests.",

    "acc.sleep.title": "Sleep mode",
    "acc.sleep.sub": "Power saving after inactivity",
    "sleep.label": "Sleep mode",
    "sleep.aria": "Sleep mode of the mouse",
    "sleep.on": "On \u2013 the mouse sleeps after a while without movement",
    "sleep.off": "Off \u2013 the mouse never goes to sleep on its own",
    "sleep.unknown": "Not read from the mouse yet",
    "sleep.needsConnection": "Connect the mouse first. The setting is read "
      + "from the device, not remembered by this page.",
    "sleep.unavailable": "Requires WebHID. This setting travels on the HID "
      + "feature report, which Web Bluetooth cannot reach \u2013 the HID service "
      + "is on the browser blocklist. Please use a current Chrome or Edge over "
      + "HTTPS and pair the mouse as a HID device.",
    "sleep.hint": "The setting is stored in the mouse: it survives "
      + "disconnecting and a reboot, and this page only reads it back. "
      + "Switched off, the mouse never goes to sleep on its own, which "
      + "noticeably shortens battery life. Independently of this, sleep stays "
      + "suspended for as long as the dashboard is connected \u2013 otherwise the "
      + "mouse would drop the connection mid-session. That suspension is not "
      + "stored and lapses by itself once this page lets go.",
    "sleep.confirm": "Switching sleep mode off is stored in the mouse. It "
      + "stays off after disconnecting and after a reboot, and the mouse then "
      + "never goes to sleep on its own \u2013 which noticeably shortens battery "
      + "life.\n\nThe connection does not need this: sleep is suspended anyway "
      + "for as long as this page is connected.\n\nSwitch sleep mode off?",

    "sensor.leftForce": "Left Force",
    "sensor.leftTmr2d": "Left 2D TMR",
    "sensor.leftHall": "Left Hall",
    "sensor.rightForce": "Right Force",
    "sensor.rightHall": "Right Hall",
    "sensor.active": "{sensor} active",

    "side.left": "Left button",
    "side.right": "Right button",

    "view.light": "Whole device",
    "view.pointer": "Underside \u00b7 motion light",
    "view.sensors": "Housing hidden \u00b7 sensors",
    "view.wheel": "Housing hidden \u00b7 wheel",

    "state.offline": "Not connected",
    "state.unnamed": "XENSIV\u2122 Mouse",
    "state.selecting": "Select mouse",
    "state.resetting": "Resetting",
    "state.running": "Live monitoring running",
    "state.paused": "Live monitoring paused",
    "state.unsupported": "Not supported",
    "state.autoConnect": "Connecting automatically",

    "msg.noTransport": "Neither WebHID nor Web Bluetooth is available. Please "
      + "use a current Chrome, Edge or Opera over HTTPS or localhost.",
    "msg.connected": "Mouse connected",
    "msg.sleepOn": "Sleep mode switched on \u2013 stored in the mouse",
    "msg.sleepOff": "Sleep mode switched off \u2013 stored in the mouse",
    "msg.sleepFailed": "Sleep mode could not be changed: {error}",
    "msg.sleepUnreadable": "Sleep mode not readable: {error}",
    "msg.lost": "The connection to the mouse was lost \u2013 most likely sleep "
      + "mode. The browser does not release a mouse that has signed off "
      + "again on its own; please connect anew.",
    "msg.configUnreadable": "Button configuration not readable: {error}. The "
      + "thresholds shown come from the presets.",
    "msg.ledSet": "LED set to {hex}",
    "msg.motionOn": "Motion light switched on",
    "msg.dpiSet": "Resolution set to {dpi} DPI",
    "msg.buttonsLoaded": "Button settings loaded",
    "msg.triggerSet": "{sensor}: trigger mode {mode}",
    "msg.triggerTuned": "{sensor}: {what} {value}",
    "msg.triggerFailed": "{sensor}: trigger setting not written \u2013 {error}",
    "msg.triggerUnreadable": "{sensor}: trigger setting not readable \u2013 "
      + "{error}",
    "msg.buttonsSaved": "Button settings saved",
    "msg.calLoaded": "Calibration loaded",
    "msg.calSaved": "Calibration saved",
    "msg.calStarted": "Calibration started. Please turn the wheel one full "
      + "revolution.",
    "msg.pressWarning": "The stored maximum length ({trigger}) lies below the "
      + "resting radius of the wheel ({radius}). A wheel click cannot be told "
      + "apart that way \u2013 please run the 360\u00b0 calibration.",
    "msg.answer": "\u00b7 ANSWER {bytes}",

    "confirm.head": "This setting can render the mouse buttons unusable:",
    "confirm.tail": "Write to the mouse anyway?",
    "problem.noSensor": "{side}: no sensor active \u2013 the button no longer "
      + "triggers",
    "problem.tooHigh": "{sensor}: threshold {threshold} lies above the highest "
      + "measured pressure {seen}",
    "problem.neverRead": "The values were never read from the device \u2013 they "
      + "are presets of this page, not those of the mouse",

    "error.noBluetooth": "Web Bluetooth is not available. Please use Chrome or "
      + "Edge over HTTPS or localhost.",
    "error.noWebhid": "WebHID is not available. Please use a current Chrome or "
      + "Edge over HTTPS or localhost.",
    "error.noneChosen": "No XENSIV mouse selected",
    "error.noReport": "The chosen mouse does not offer feature report 0x10. "
      + "Please update the firmware and pair the device again.",
    "error.noneReleased": "No mouse has been released yet.",
    "error.notConnected": "The mouse is not connected",
    "error.timeout": "The mouse did not answer – most likely sleep mode",
    "error.sleepRejected": "The mouse still reports the old setting",

    "error.payloadTooBig": "Payload does not fit into the feature report",
    "error.wrongLength": "Answer has {actual} instead of {expected} bytes",
    "error.wrongCommand": "Answer belongs to command {actual}, not {expected}",
    "error.commandFailed": "Command {command}: {reason}",
    "error.shortValue": "{what}: {actual} instead of {expected} bytes",
    "status.1": "unknown command",
    "status.2": "invalid payload length",
    "status.3": "device rejected the command",
    "status.unknown": "error {code}",
  },

  de: {
    "page.title": "Infineon | XENSIV\u2122 Maus Konfigurator",
    "intro.skip": "\u00dcberspringen",

    "brand.aria": "Infineon XENSIV Maus Konfigurator",
    "brand.name": "XENSIV\u2122 Maus",
    "brand.sub": "Konfigurationskonsole",
    "battery.title": "Batteriestand",
    "lang.aria": "Sprache",
    "header.reconnect": "Neu verbinden",
    "header.connect": "Maus verbinden",
    "header.disconnect": "Trennen",

    "tabs.aria": "Ansichten",
    "tabs.live": "Live-\u00dcberwachung",
    "tabs.config": "Konfiguration",

    "stage.device": "GER\u00c4T 01",
    "stage.model": "MODELL",
    "stage.view": "ANSICHT",
    "stage.wheelAngle": "RADWINKEL",
    "stage.buttons": "TASTEN",
    "stage.led": "LED",
    "model.aria": "Modell der XENSIV Maus",
    "svg.aria": "Schematische Darstellung der XENSIV Maus",

    "live.eyebrow": "LIVE-TELEMETRIE",
    "live.heading": "Sensorwerte",
    "live.rateBefore": "erreicht",
    "live.rateAfter": "Hz",
    "live.clear": "Leeren",
    "live.press": "Tastendruck",
    "live.history": "Verlauf",

    "chart.angle": "WINKEL",
    "chart.samples": "Messpunkte",
    "chart.field": "FELD X / Z",
    "chart.path": "Magnetbahn",

    "metric.angleCal": "WINKEL KALIBRIERT",
    "metric.angleRaw": "WINKEL ROH",
    "metric.degrees": "Grad",
    "metric.field": "FELD X / Z",
    "metric.calibrated": "kalibriert",
    "metric.raw": "roh",
    "metric.wheelPress": "RADDRUCK",
    "metric.radiusMax": "Radius / Maximall\u00e4nge",

    "press.value": "Druck",
    "press.threshold": "Schwelle",

    "config.eyebrow": "KONFIGURATION",
    "config.heading": "Einstellungen der Maus",
    "config.overview": "\u00dcBERSICHT",

    "acc.light.title": "Beleuchtung",
    "acc.light.sub": "Farbe der Deckenbeleuchtung",
    "led.pick": "Farbe w\u00e4hlen",
    "led.apply": "\u00dcbernehmen",
    "led.quick": "SCHNELLFARBEN",
    "color.red": "Rot",
    "color.green": "Gr\u00fcn",
    "color.blue": "Blau",
    "color.off": "Aus",
    "led.motion": "Bewegungslicht einschalten",

    "acc.dpi.title": "Zeigeraufl\u00f6sung",
    "acc.dpi.sub": "Abtastrate des optischen Sensors",
    "dpi.hint": "Der Wert wird als 16-Bit-Ganzzahl im Little-Endian-Format "
      + "\u00fcbertragen. Das Modell zeigt die Unterseite: Im Fenster des "
      + "optischen Sensors steht ein Licht, das mit der eingestellten "
      + "Aufl\u00f6sung heller wird.",

    "acc.buttons.title": "Tastensensorik",
    "acc.buttons.sub": "Freigabe und Schwellwerte",
    "buttons.legend": "VIER SENSOREN \u00b7 SCHWELLWERT 0 \u2013 127",
    "buttons.load": "Laden",
    "buttons.write": "In die Maus schreiben",
    "buttons.colSensor": "Sensor",
    "buttons.colMode": "Ausl\u00f6sung",
    "buttons.colThreshold": "Schwelle",
    "buttons.colActive": "Aktiv",

    "trigger.title": "Ausl\u00f6severhalten",
    "trigger.aria": "Ausl\u00f6severhalten",
    "trigger.fixed": "Fest",
    "trigger.rapid": "Schnell",
    "trigger.press": "Ansprechen",
    "trigger.release": "Loslassen",
    "trigger.deadzone": "Totzone",
    "trigger.needsConnection": "Zuerst die Maus verbinden. Das "
      + "Ausl\u00f6severhalten kommt aus dem Ger\u00e4t und wird von dieser Seite "
      + "nicht gemerkt.",
    "trigger.unavailable": "Ben\u00f6tigt WebHID. Diese Einstellung l\u00e4uft \u00fcber "
      + "den HID-Feature-Report, und den erreicht Web Bluetooth nicht \u2013 der "
      + "HID-Dienst steht auf der Sperrliste des Browsers. Bitte aktuelles "
      + "Chrome oder Edge \u00fcber HTTPS verwenden und die Maus als HID-Ger\u00e4t "
      + "koppeln.",
    "trigger.hint": "Fest l\u00f6st oberhalb der Schwelle aus und f\u00e4llt bei "
      + "85\u00a0% davon wieder ab. Schnell folgt stattdessen dem Signal: Es "
      + "l\u00e4sst los, sobald man um den Wert f\u00fcr das Loslassen zur\u00fcckgeht, und "
      + "l\u00f6st wieder aus, sobald man um den Wert f\u00fcrs Ansprechen nachdr\u00fcckt "
      + "\u2013 ein erneuter Klick braucht damit keinen Weg zur\u00fcck \u00fcber einen "
      + "festen Punkt. Kleinere Werte hei\u00dfen empfindlicher. Die Totzone nahe "
      + "der Ruhelage erzwingt das Loslassen und setzt die Verfolgung "
      + "zur\u00fcck. Beide Betriebsarten behalten ihre eigenen Werte in der "
      + "Maus; hin und her zu schalten verliert also nichts. Die beiden "
      + "Marken auf den Druckbalken der Live-Ansicht zeigen, wo das Ger\u00e4t "
      + "tats\u00e4chlich schaltet.",
    "buttons.hint1": "Je Taste misst nur ein Sensor: Eine Freigabe hebt die "
      + "bisherige derselben Seite auf. Die Schwellwerte wirken im Ger\u00e4t "
      + "selbst \u2013 liegt eine Schwelle \u00fcber dem Druck, den der Sensor "
      + "tats\u00e4chlich erreicht, l\u00f6st die Taste am ganzen Rechner nicht mehr "
      + "aus, auch nach dem Schlie\u00dfen dieser Seite. Die Freigabe entscheidet "
      + "zugleich, welchem Sensor die Live-\u00dcberwachung je Taste folgt; sie "
      + "zeigt die erreichbaren Werte.",
    "buttons.hint2": "Meldet die Maus beim Lesen keine einzige Freigabe "
      + "zur\u00fcck \u2013 erkennbar an einer Antwort, in der kein Byte \u00fcber 127 "
      + "liegt \u2013, tritt an ihre Stelle, was zuletzt in das Ger\u00e4t geschrieben "
      + "wurde. Dieser Vermerk bleibt in diesem Browser erhalten, auch nach "
      + "dem Trennen und Neuladen. \u201eLaden\u201c verwirft dann also "
      + "ungespeicherte \u00c4nderungen. Wurde noch nie geschrieben, gilt die "
      + "Annahme, es messe die Force-Sensorik. Die Schwellwerte kommen in "
      + "jedem Fall aus dem Ger\u00e4t, und beim Schreiben geht die Freigabe "
      + "vollst\u00e4ndig hin.",

    "acc.wheel.title": "Radkalibrierung",
    "acc.wheel.sub": "Offsets, Amplituden und Druckschwelle",
    "cal.offsetX": "Offset X",
    "cal.offsetZ": "Offset Z",
    "cal.amplitudeX": "Amplitude X",
    "cal.amplitudeZ": "Amplitude Z",
    "cal.ellipse": "Ellipsenwinkel",
    "cal.trigger": "Druckschwelle",
    "cal.load": "Werte laden",
    "cal.save": "Werte speichern",
    "cal.start": "360\u00b0-Kalibrierung starten",
    "cal.hint": "Der Kalibrierlauf erwartet eine vollst\u00e4ndige Umdrehung des "
      + "Rads. Die Druckschwelle wird tausendfach gr\u00f6\u00dfer angezeigt, als die "
      + "Firmware sie f\u00fchrt \u2013 genau wie im Desktop-Werkzeug. Die Live-Ansicht "
      + "zeigt die Marke hundert Einheiten tiefer: So viel fr\u00fcher klickt die "
      + "Maus, als der gespeicherte Wert vermuten l\u00e4sst.",

    "acc.sleep.title": "Ruhezustand",
    "acc.sleep.sub": "Stromsparen nach Untaetigkeit",
    "sleep.label": "Ruhezustand",
    "sleep.aria": "Ruhezustand der Maus",
    "sleep.on": "Ein \u2013 die Maus schl\u00e4ft nach einer Weile ohne Bewegung",
    "sleep.off": "Aus \u2013 die Maus schl\u00e4ft nie von selbst ein",
    "sleep.unknown": "Noch nicht aus der Maus gelesen",
    "sleep.needsConnection": "Zuerst die Maus verbinden. Die Einstellung "
      + "kommt aus dem Ger\u00e4t und wird von dieser Seite nicht gemerkt.",
    "sleep.unavailable": "Ben\u00f6tigt WebHID. Diese Einstellung l\u00e4uft \u00fcber den "
      + "HID-Feature-Report, und den erreicht Web Bluetooth nicht \u2013 der "
      + "HID-Dienst steht auf der Sperrliste des Browsers. Bitte aktuelles "
      + "Chrome oder Edge \u00fcber HTTPS verwenden und die Maus als HID-Ger\u00e4t "
      + "koppeln.",
    "sleep.hint": "Die Einstellung liegt in der Maus: Sie \u00fcberdauert das "
      + "Trennen und den Neustart, und diese Seite liest sie nur zur\u00fcck. "
      + "Abgeschaltet schl\u00e4ft die Maus nie von selbst ein, was die Laufzeit "
      + "sp\u00fcrbar verk\u00fcrzt. Davon unabh\u00e4ngig bleibt der Ruhezustand "
      + "ausgesetzt, solange das Dashboard verbunden ist \u2013 sonst risse die "
      + "Maus die Verbindung mitten in der Sitzung ab. Dieses Aussetzen liegt "
      + "nirgends und f\u00e4llt von selbst weg, sobald diese Seite losl\u00e4sst.",
    "sleep.confirm": "Den Ruhezustand abzuschalten wird in der Maus "
      + "gespeichert. Er bleibt nach dem Trennen und nach einem Neustart aus, "
      + "und die Maus schl\u00e4ft dann nie von selbst ein \u2013 was die Laufzeit "
      + "sp\u00fcrbar verk\u00fcrzt.\n\nF\u00fcr die Verbindung ist das nicht n\u00f6tig: Der "
      + "Ruhezustand ist ohnehin ausgesetzt, solange diese Seite verbunden "
      + "ist.\n\nRuhezustand abschalten?",

    "sensor.leftForce": "Links Force",
    "sensor.leftTmr2d": "Links 2D TMR",
    "sensor.leftHall": "Links Hall",
    "sensor.rightForce": "Rechts Force",
    "sensor.rightHall": "Rechts Hall",
    "sensor.active": "{sensor} aktiv",

    "side.left": "Linke Taste",
    "side.right": "Rechte Taste",

    "view.light": "Gesamtes Ger\u00e4t",
    "view.pointer": "Unterseite \u00b7 Bewegungslicht",
    "view.sensors": "Geh\u00e4use ausgeblendet \u00b7 Sensoren",
    "view.wheel": "Geh\u00e4use ausgeblendet \u00b7 Rad",

    "state.offline": "Nicht verbunden",
    "state.unnamed": "XENSIV\u2122 Maus",
    "state.selecting": "Maus ausw\u00e4hlen",
    "state.resetting": "Wird zur\u00fcckgesetzt",
    "state.running": "Live-\u00dcberwachung l\u00e4uft",
    "state.paused": "Live-\u00dcberwachung angehalten",
    "state.unsupported": "Nicht unterst\u00fctzt",
    "state.autoConnect": "Verbinde automatisch",

    "msg.noTransport": "Weder WebHID noch Web Bluetooth stehen zur "
      + "Verf\u00fcgung. Bitte ein aktuelles Chrome, Edge oder Opera \u00fcber HTTPS "
      + "oder localhost nutzen.",
    "msg.connected": "Maus verbunden",
    "msg.sleepOn": "Ruhezustand eingeschaltet \u2013 in der Maus gespeichert",
    "msg.sleepOff": "Ruhezustand abgeschaltet \u2013 in der Maus gespeichert",
    "msg.sleepFailed": "Ruhezustand lie\u00df sich nicht umstellen: {error}",
    "msg.sleepUnreadable": "Ruhezustand nicht lesbar: {error}",
    "msg.lost": "Die Verbindung zur Maus ist verloren \u2013 vermutlich "
      + "Ruhezustand. Eine abgemeldete Maus gibt der Browser nicht von selbst "
      + "wieder frei; bitte neu verbinden.",
    "msg.configUnreadable": "Tastenkonfiguration nicht lesbar: {error}. Die "
      + "angezeigten Schwellwerte stammen aus der Voreinstellung.",
    "msg.ledSet": "LED auf {hex} gesetzt",
    "msg.motionOn": "Bewegungslicht eingeschaltet",
    "msg.dpiSet": "Aufl\u00f6sung auf {dpi} DPI gesetzt",
    "msg.buttonsLoaded": "Tasteneinstellungen geladen",
    "msg.triggerSet": "{sensor}: Ausl\u00f6severhalten {mode}",
    "msg.triggerTuned": "{sensor}: {what} {value}",
    "msg.triggerFailed": "{sensor}: Ausl\u00f6severhalten nicht geschrieben \u2013 "
      + "{error}",
    "msg.triggerUnreadable": "{sensor}: Ausl\u00f6severhalten nicht lesbar \u2013 "
      + "{error}",
    "msg.buttonsSaved": "Tasteneinstellungen gespeichert",
    "msg.calLoaded": "Kalibrierung geladen",
    "msg.calSaved": "Kalibrierung gespeichert",
    "msg.calStarted": "Kalibrierung gestartet. Bitte das Rad einmal "
      + "vollst\u00e4ndig drehen.",
    "msg.pressWarning": "Die gespeicherte Maximall\u00e4nge ({trigger}) liegt unter "
      + "dem Ruheradius des Rads ({radius}). Ein Radklick l\u00e4sst sich damit "
      + "nicht unterscheiden \u2013 bitte die 360\u00b0-Kalibrierung ausf\u00fchren.",
    "msg.answer": "\u00b7 ANTWORT {bytes}",

    "confirm.head": "Diese Einstellung kann die Maustasten unbrauchbar machen:",
    "confirm.tail": "Trotzdem in die Maus schreiben?",
    "problem.noSensor": "{side}: kein Sensor aktiv \u2013 die Taste l\u00f6st nicht "
      + "mehr aus",
    "problem.tooHigh": "{sensor}: Schwelle {threshold} liegt \u00fcber dem "
      + "h\u00f6chsten gemessenen Druck {seen}",
    "problem.neverRead": "Die Werte wurden nie vom Ger\u00e4t gelesen \u2013 es sind "
      + "Voreinstellungen dieser Seite, nicht die der Maus",

    "error.noBluetooth": "Web Bluetooth steht nicht zur Verf\u00fcgung. Bitte "
      + "Chrome oder Edge \u00fcber HTTPS beziehungsweise localhost verwenden.",
    "error.noWebhid": "WebHID steht nicht zur Verf\u00fcgung. Bitte aktuelles "
      + "Chrome oder Edge \u00fcber HTTPS beziehungsweise localhost verwenden.",
    "error.noneChosen": "Keine XENSIV Maus ausgew\u00e4hlt",
    "error.noReport": "Die gew\u00e4hlte Maus bietet den Feature-Report 0x10 nicht "
      + "an. Bitte die Firmware aktualisieren und das Ger\u00e4t neu koppeln.",
    "error.noneReleased": "Es ist noch keine Maus freigegeben.",
    "error.notConnected": "Die Maus ist nicht verbunden",
    "error.timeout": "Die Maus hat nicht geantwortet – vermutlich Ruhezustand",
    "error.sleepRejected": "Die Maus meldet weiterhin die alte Einstellung",

    "error.payloadTooBig": "Nutzdaten passen nicht in den Feature-Report",
    "error.wrongLength": "Antwort hat {actual} statt {expected} Byte",
    "error.wrongCommand": "Antwort geh\u00f6rt zu Befehl {actual}, nicht {expected}",
    "error.commandFailed": "Befehl {command}: {reason}",
    "error.shortValue": "{what}: {actual} statt {expected} Byte",
    "status.1": "unbekannter Befehl",
    "status.2": "ung\u00fcltige Nutzdatenl\u00e4nge",
    "status.3": "Ger\u00e4t hat den Befehl abgelehnt",
    "status.unknown": "Fehler {code}",
  },
};

let current = recall();
const listeners = new Set();

// Die zuletzt gewaehlte Sprache ueberdauert den Besuch. Was aus der Ablage
// kommt, ist ungeprueft - eine fremde Hand, ein alter Stand -, deshalb gilt
// nur, was es auch wirklich gibt.
function recall() {
  try {
    const saved = localStorage.getItem(STORE);
    return saved in LANGUAGES ? saved : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

// Platzhalter stehen in geschweiften Klammern. Fehlt ein Schluessel, kommt er
// selbst zum Vorschein - das faellt beim Ansehen auf, waehrend ein leeres Feld
// unbemerkt bliebe.
export function t(key, values) {
  const text = TEXTS[current][key] ?? TEXTS[DEFAULT_LANGUAGE][key] ?? key;
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    (name in values ? String(values[name]) : whole));
}

export function language() {
  return current;
}

export function setLanguage(code) {
  if (!(code in LANGUAGES) || code === current) return;
  current = code;
  try {
    localStorage.setItem(STORE, code);
  } catch {
    // Ohne Ablage gilt die Wahl eben nur fuer diesen Besuch.
  }
  translate();
  listeners.forEach((listener) => listener(code));
}

// Wer eigene Texte setzt - Meldungen, Beschriftungen aus dem Modell -, muss
// sie beim Wechsel neu setzen. Dafuer ist diese Anmeldung da.
export function onLanguage(listener) {
  listeners.add(listener);
}

// Traegt die Sprache in das Markup ein. `data-i18n` setzt den Text,
// `data-i18n-aria` und `data-i18n-title` die gleichnamigen Merkmale - beides
// gehoert uebersetzt, auch wenn man es nur hoert oder beim Verweilen sieht.
export function translate(root = document) {
  document.documentElement.lang = current;
  document.title = t("page.title");

  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAria));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });
}
