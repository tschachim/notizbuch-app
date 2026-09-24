// @vitest-environment jsdom
//
// v7.56, Nutzerwunsch "in der Handyansicht sind oben zu viele Knöpfe in
// mehreren Zeilen, geht das einzeilig und zum Hin-und-her-Schieben mit dem
// Finger?": prüft die mobile Formatierungs-Toolbar aus DocEditor.jsx
// (Strip-Klassen, shrink-0 auf allen Kindern außer dem Abstandhalter,
// fixed-positionierte Popover unterhalb md, Wisch-Hinweis-Blende) – nach
// demselben Muster wie tests/docEditorToolbarFocus.test.jsx (DocEditor wird
// ECHT gerendert, keine reinen Quelltext-Stichproben wo ein echter Render
// aussagekräftiger ist).
//
// GRENZE (wie im Fokus-Test ehrlich benannt): jsdom hat kein echtes Layout,
// getBoundingClientRect() liefert OHNE Weiteres für JEDES Element nur
// Nullen. Ein Test, der sich auf ECHTE Bildschirmmaße verlässt, wäre
// deshalb keine Aussage über echtes Verhalten. Die Messlogik selbst
// (measurePickerTop: rect.bottom + 2, Neu-Messung bei resize/
// orientationchange UND bei jedem Render, Listener-Auf-/Abbau beim Öffnen/
// Schließen) lässt sich trotzdem deterministisch prüfen: vi.spyOn(...,
// "getBoundingClientRect") ersetzt jsdoms Null-Stub durch einen
// kontrollierten Rückgabewert – wir testen dann nicht "wie groß ist der
// Bildschirm wirklich", sondern "rechnet/misst die Komponente korrekt mit
// dem, was sie von getBoundingClientRect zurückbekommt". Die reine
// Format-Prüfung (Punkt 3 im ursprünglichen Auftrag) bleibt zusätzlich als
// Smoke-Test über alle vier Popover erhalten.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import DocEditor from "../src/components/DocEditor.jsx";

async function mountDocEditor(initialDoc, extraProps = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = {
    initialDoc,
    imgMap: {},
    onSave: () => {},
    onCancel: () => {},
    saving: false,
    navWidth: 148,
    autocorrect: undefined,
    ...extraProps,
  };
  await act(async () => {
    root.render(<DocEditor {...props} />);
    // autofocus:"start" stößt denselben RAF-verzögerten Fokus-Mechanismus
    // an wie im Fokus-Test – ohne diesen Flush feuert die Callback später
    // in einem anderen Test (siehe dortiger Kommentar).
    await new Promise((r) => requestAnimationFrame(r));
  });
  // Review-Fix (🟢 Finding 8): root.unmount() allein entfernt nur den
  // React-Baum, NICHT den an document.body gehängten Container – über die
  // vielen mountDocEditor-Aufrufe dieser Datei akkumulierten sonst leere
  // <div>s im jsdom-Body (aktuell folgenlos, weil jede Query hier über
  // "container" läuft statt über document, aber quickNotesTab.test.jsx
  // macht es aus genau diesem Grund richtig). cleanup() bündelt beides.
  const cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return { container, root, cleanup };
}

function byTitle(container, title) {
  const el = container.querySelector('button[title="' + title + '"]');
  if (!el) throw new Error('Button mit title="' + title + '" nicht gefunden');
  return el;
}

function strip(container) {
  const el = container.querySelector(".toolbar-strip");
  if (!el) throw new Error(".toolbar-strip nicht gefunden");
  return el;
}

// Der einzige "reine Abstandhalter" der Toolbar (siehe DocEditor.jsx:
// <div className="flex-1" /> zwischen den Tabellen-Werkzeugen und
// Rückgängig/Wiederholen) – erkennbar daran, dass er GENAU eine Klasse
// trägt und sonst nichts (kein anderes Toolbar-Kind hat ausschließlich
// "flex-1" als Klasse).
function isSpacer(el) {
  return el.tagName === "DIV" && el.className.trim() === "flex-1";
}

// Review-Fix Runde 2 (🟢 Finding 1): der versteckte Datei-Input trägt nur
// noch "hidden" (kein wirkungsloses "shrink-0" mehr auf einem
// display:none-Element, das am Flex-Layout des Strips gar nicht teilnimmt)
// – solche Kinder werden bei der shrink-0-Prüfung übersprungen.
function isHiddenChild(el) {
  return el.classList.contains("hidden");
}

const DOC_EDITOR_SRC = readFileSync(resolve(process.cwd(), "src/components/DocEditor.jsx"), "utf8");

// Review-Fix Runde 2 (🟢 Finding 2): vi.spyOn auf window.addEventListener/
// removeEventListener (Listener-Test weiter unten) wird sonst nie
// zurückgesetzt – vitest.config.js setzt kein restoreMocks. Global statt
// pro Test, damit ein SPÄTER in dieser Datei ergänzter Test nicht auf
// akkumulierten mock.calls aus einem früheren Test aufsetzt.
afterEach(() => vi.restoreAllMocks());

describe("Mobile Toolbar (v7.56): Strip-Container", () => {
  it("trägt flex-nowrap/overflow-x-auto unterhalb md und md:flex-wrap/md:overflow-visible ab md", async () => {
    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    const el = strip(container);
    expect(el.classList.contains("flex-nowrap")).toBe(true);
    expect(el.classList.contains("overflow-x-auto")).toBe(true);
    expect(el.classList.contains("md:flex-wrap")).toBe(true);
    expect(el.classList.contains("md:overflow-visible")).toBe(true);
    await cleanup();
  });
});

describe("Mobile Toolbar (v7.56): JEDES direkte Kind hat shrink-0, außer dem flex-1-Abstandhalter", () => {
  it("im normalen Modus (inkl. Bild-Trigger-Knopf + verstecktem Datei-Input, onAddImage gesetzt)", async () => {
    const { container, cleanup } = await mountDocEditor("# T\n\nText", { onAddImage: vi.fn() });
    const children = Array.from(strip(container).children);
    // Sanity: mehr als nur der Abstandhalter, sonst würde der Test bei
    // einem leeren Strip trivial (und sinnlos) grün sein.
    expect(children.length).toBeGreaterThan(10);
    const spacerCount = children.filter(isSpacer).length;
    expect(spacerCount).toBe(1); // GENAU ein Abstandhalter
    for (const child of children) {
      if (isSpacer(child) || isHiddenChild(child)) continue; // display:none nimmt am Flex-Layout nicht teil
      expect(child.classList.contains("shrink-0"), child.outerHTML.slice(0, 80)).toBe(true);
    }
    await cleanup();
  });

  it("im Tabellen-Modus (Cursor in einer GFM-Tabelle, +Zeile/+Spalte/… + Trenner zusätzlich sichtbar)", async () => {
    // Dokument beginnt DIREKT mit einer Tabelle + autofocus:"start" (siehe
    // useEditor() in DocEditor.jsx) -> die Selektion steht beim Mounten
    // bereits in der ersten Zelle, exakt wie im entsprechenden Fall in
    // tests/docEditorToolbarFocus.test.jsx.
    const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const { container, cleanup } = await mountDocEditor(md, { onAddImage: vi.fn() });
    expect(container.querySelector('button[title="Zeile unterhalb einfügen"]')).toBeTruthy();
    const children = Array.from(strip(container).children);
    const spacerCount = children.filter(isSpacer).length;
    expect(spacerCount).toBe(1);
    for (const child of children) {
      if (isSpacer(child) || isHiddenChild(child)) continue; // display:none nimmt am Flex-Layout nicht teil
      expect(child.classList.contains("shrink-0"), child.outerHTML.slice(0, 80)).toBe(true);
    }
    await cleanup();
  });
});

describe("Mobile Toolbar (v7.56): Popover unterhalb md per position:fixed statt absolute", () => {
  async function openAndGetPopover(title, initialDoc = "# T\n\nText") {
    const { container, cleanup } = await mountDocEditor(initialDoc);
    const btnEl = byTitle(container, title);
    await act(async () => { btnEl.click(); });
    const popover = btnEl.nextElementSibling;
    return { container, cleanup, popover };
  }

  // Tabelle einfügen: EIGENES Erwartungs-Set (Review-Fix, Regression ggü.
  // v7.55) – "right-4" gäbe dem Popover unterhalb md eine DEFINITE Breite
  // (Viewport − 32px), auf die das block-level "grid grid-cols-6"-Raster
  // seine 1fr-Spalten voll verteilen würde (36 winzige Punkte mit riesigen
  // Lücken statt des kompakten ~106px-Rasters). "right-auto" lässt die
  // Breite wie ab md ("md:right-auto") per Shrink-to-fit aus dem Inhalt
  // berechnen, siehe Kommentar in DocEditor.jsx direkt vor diesem Popover.
  it.each([
    ["Schriftfarbe", "right-4"],
    ["Textmarker", "right-4"],
    ["Link einfügen/bearbeiten", "right-4"],
  ])("%s-Popover trägt fixed/left-4/%s/md:absolute/md:top-full und eine gesetzte --pop-top-Variable", async (title, rightClass) => {
    const { cleanup, popover } = await openAndGetPopover(title);
    expect(popover, title + ": Popover-Element nicht gefunden").toBeTruthy();
    expect(popover.classList.contains("fixed"), title).toBe(true);
    expect(popover.classList.contains("left-4"), title).toBe(true);
    expect(popover.classList.contains(rightClass), title).toBe(true);
    expect(popover.classList.contains("md:absolute"), title).toBe(true);
    expect(popover.classList.contains("md:top-full"), title).toBe(true);
    const popTop = popover.style.getPropertyValue("--pop-top");
    expect(popTop, title + ": --pop-top nicht gesetzt").toMatch(/^-?\d+(\.\d+)?px$/);
    await cleanup();
  });

  it("Tabelle einfügen-Popover trägt fixed/left-4/right-auto (KEIN right-4)/md:absolute/md:top-full und eine gesetzte --pop-top-Variable", async () => {
    const { cleanup, popover } = await openAndGetPopover("Tabelle einfügen");
    expect(popover).toBeTruthy();
    expect(popover.classList.contains("fixed")).toBe(true);
    expect(popover.classList.contains("left-4")).toBe(true);
    expect(popover.classList.contains("right-auto")).toBe(true);
    expect(popover.classList.contains("right-4")).toBe(false); // exakt die Regression aus dem Review
    expect(popover.classList.contains("md:absolute")).toBe(true);
    expect(popover.classList.contains("md:top-full")).toBe(true);
    const popTop = popover.style.getPropertyValue("--pop-top");
    expect(popTop).toMatch(/^-?\d+(\.\d+)?px$/);
    await cleanup();
  });
});

describe("Mobile Toolbar (v7.56): --pop-top misst die Strip-Position exakt (rect.bottom + 2)", () => {
  // vi.spyOn ersetzt jsdoms Null-Stub durch einen kontrollierten Wert (siehe
  // Kopfkommentar) – geprüft wird die ECHTE Rechnung/Messlogik aus
  // measurePickerTop/openPicker (DocEditor.jsx), nicht ein echtes Layout.
  // "+ 2" statt "+ 4" (Nachbesserung, Abschluss-Review v7.56): der Strip
  // trägt seit dem Fokus-Ring-Fix "py-0.5" (2px eigenes Padding), das schon
  // in rect.bottom steckt – "+ 2" bringt den sichtbaren Abstand damit auf
  // dieselben 4px wie am Desktop (siehe Kommentar in DocEditor.jsx).
  it("misst beim Öffnen SOFORT (rect.bottom + 2), misst bei offenem Picker nach resize NEU, und misst beim erneuten Öffnen wieder frisch (keine stehengebliebenen alten Werte)", async () => {
    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    const el = strip(container);
    const rectSpy = vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ bottom: 100 });
    const btnEl = byTitle(container, "Schriftfarbe");

    // Öffnen -> openPicker() misst sofort (measurePickerTop).
    await act(async () => { btnEl.click(); });
    let popover = btnEl.nextElementSibling;
    expect(popover.style.getPropertyValue("--pop-top")).toBe("102px");

    // Bei offenem Picker hängt ein resize-Listener (siehe useEffect in
    // DocEditor.jsx, an "picker" gekoppelt) -> neue Messung.
    rectSpy.mockReturnValue({ bottom: 200 });
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    popover = btnEl.nextElementSibling;
    expect(popover.style.getPropertyValue("--pop-top")).toBe("202px");

    // Schließen (Öffner-Knopf ist ein Toggle, siehe openAndGetPopover oben).
    await act(async () => { btnEl.click(); });
    expect(btnEl.nextElementSibling).toBeNull(); // Popover ist weg

    // Erneutes Öffnen mit geändertem Rect -> FRISCHE Messung (kein
    // Hängenbleiben am zuletzt gemessenen 202px-Stand).
    rectSpy.mockReturnValue({ bottom: 300 });
    await act(async () => { btnEl.click(); });
    popover = btnEl.nextElementSibling;
    expect(popover.style.getPropertyValue("--pop-top")).toBe("302px");

    await cleanup();
  });

  it("misst pickerTop auch OHNE resize/orientationchange neu nach, wenn ein Render die Toolbar-Position verschiebt (useLayoutEffect nach jedem Render)", async () => {
    // Bildet z. B. ein Banner ab, das über der Toolbar erscheint, WÄHREND
    // ein Popover offen ist (siehe Review-Ergänzung in DocEditor.jsx: der
    // ohnehin nach jedem Render laufende useLayoutEffect misst pickerTop
    // bei offenem Picker zusätzlich nach) – ausgelöst hier durch einen
    // Klick auf "Fett" (löst über onTransaction/setTick einen Re-Render
    // aus, OHNE resize- oder orientationchange-Event).
    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    const el = strip(container);
    const rectSpy = vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ bottom: 50 });
    const colorBtn = byTitle(container, "Schriftfarbe");
    await act(async () => { colorBtn.click(); });
    expect(colorBtn.nextElementSibling.style.getPropertyValue("--pop-top")).toBe("52px");

    rectSpy.mockReturnValue({ bottom: 90 });
    const boldBtn = byTitle(container, "Fett");
    await act(async () => { boldBtn.click(); });
    expect(colorBtn.nextElementSibling.style.getPropertyValue("--pop-top")).toBe("92px");

    await cleanup();
  });
});

describe("Mobile Toolbar (v7.56): resize/orientationchange-Listener nur solange ein Picker offen ist", () => {
  // Review-Fix (🟡 Finding 1): vi.stubGlobal("visualViewport", ...) wird in
  // einem der Tests unten gesetzt – ein afterEach statt eines inline vor
  // cleanup() platzierten Aufrufs stellt sicher, dass der Stub AUCH dann
  // entfernt wird, wenn eine Assertion im Testkörper vorher fehlschlägt
  // (sonst leckt visualViewport in den nächsten Test dieser Datei, siehe
  // dessen eigene Sanity-Prüfung "jsdom liefert hier keinen Stub").
  afterEach(() => vi.unstubAllGlobals());

  it("registriert beim Öffnen genau EINEN resize- und EINEN orientationchange-Listener und entfernt exakt diese beim Schließen wieder", async () => {
    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    const btnEl = byTitle(container, "Schriftfarbe");
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    await act(async () => { btnEl.click(); }); // öffnen
    expect(addSpy.mock.calls.filter(([type]) => type === "resize").length).toBe(1);
    expect(addSpy.mock.calls.filter(([type]) => type === "orientationchange").length).toBe(1);

    addSpy.mockClear();
    removeSpy.mockClear();
    await act(async () => { btnEl.click(); }); // schließen (Toggle)
    expect(removeSpy.mock.calls.filter(([type]) => type === "resize").length).toBe(1);
    expect(removeSpy.mock.calls.filter(([type]) => type === "orientationchange").length).toBe(1);
    // nach dem Schließen registriert der [picker]-Effekt keinen neuen Listener mehr
    expect(addSpy.mock.calls.filter(([type]) => type === "resize" || type === "orientationchange").length).toBe(0);

    await cleanup();
  });

  // Nachbesserung (Abschluss-Review v7.56, entschärft Restrisiko (3) aus
  // DECISIONS #115): eine virtuelle Bildschirmtastatur auf iOS verschiebt
  // den Layout-Viewport ohne window-"resize" – window.visualViewport meldet
  // das separat. jsdom kennt visualViewport nicht, deshalb hier ein
  // minimaler EventTarget-Stub (die Komponente ruft nur addEventListener/
  // removeEventListener darauf auf, mehr braucht der Test nicht).
  it("mit gestubbtem window.visualViewport registriert das Öffnen zusätzlich genau einen resize- und einen scroll-Listener DARAUF, entfernt exakt diese beim Schließen wieder, UND der registrierte Handler misst pickerTop tatsächlich neu (Review-Fix 🟡 Finding 1: ein leerer Listener bliebe sonst grün)", async () => {
    const vv = new EventTarget();
    vi.stubGlobal("visualViewport", vv);
    const addSpy = vi.spyOn(vv, "addEventListener");
    const removeSpy = vi.spyOn(vv, "removeEventListener");

    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    const el = strip(container);
    const rectSpy = vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ bottom: 100 });
    const btnEl = byTitle(container, "Schriftfarbe");

    await act(async () => { btnEl.click(); }); // öffnen
    expect(addSpy.mock.calls.filter(([type]) => type === "resize").length).toBe(1);
    expect(addSpy.mock.calls.filter(([type]) => type === "scroll").length).toBe(1);
    expect(btnEl.nextElementSibling.style.getPropertyValue("--pop-top")).toBe("102px");

    // Kernaussage der Nachbesserung: der auf "vv" registrierte Handler ist
    // measurePickerTop selbst (nicht nur irgendein Listener) – ein
    // visualViewport-"scroll" (iOS-Tastatur schiebt den Ausschnitt) UND ein
    // visualViewport-"resize" müssen --pop-top jeweils NEU aus
    // getBoundingClientRect() berechnen, genau wie beim window-resize-Test
    // oben.
    rectSpy.mockReturnValue({ bottom: 200 });
    await act(async () => { vv.dispatchEvent(new Event("scroll")); });
    expect(btnEl.nextElementSibling.style.getPropertyValue("--pop-top")).toBe("202px");

    rectSpy.mockReturnValue({ bottom: 300 });
    await act(async () => { vv.dispatchEvent(new Event("resize")); });
    expect(btnEl.nextElementSibling.style.getPropertyValue("--pop-top")).toBe("302px");

    await act(async () => { btnEl.click(); }); // schließen (Toggle)
    expect(removeSpy.mock.calls.filter(([type]) => type === "resize").length).toBe(1);
    expect(removeSpy.mock.calls.filter(([type]) => type === "scroll").length).toBe(1);

    await cleanup();
  });

  it("ohne window.visualViewport (jsdom-Standard: undefined) öffnet/schließt der Picker ohne Fehler (null-sicherer Zugriff)", async () => {
    expect(window.visualViewport).toBeUndefined(); // Sanity: jsdom liefert hier keinen Stub
    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    const btnEl = byTitle(container, "Schriftfarbe");

    await expect(act(async () => { btnEl.click(); })).resolves.not.toThrow(); // öffnen
    await expect(act(async () => { btnEl.click(); })).resolves.not.toThrow(); // schließen

    await cleanup();
  });
});

describe("Mobile Toolbar (v7.56): Wisch-Hinweis-Blende", () => {
  it("erscheint NICHT, solange scrollWidth<=clientWidth+scrollLeft (jsdom-Default: beide 0)", async () => {
    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    expect(container.querySelector(".toolbar-scroll-fade")).toBeNull();
    await cleanup();
  });

  it("erscheint, sobald der Strip weiter nach rechts scrollen könnte, und verschwindet wieder am Scroll-Ende", async () => {
    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    const el = strip(container);
    Object.defineProperty(el, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(el, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(el, "scrollLeft", { value: 0, configurable: true, writable: true });

    await act(async () => {
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const fade = container.querySelector(".toolbar-scroll-fade");
    expect(fade).toBeTruthy();
    // Review-Fix Runde 2 (🟡 Finding 1): die reine Existenzprüfung oben
    // bliebe grün, auch wenn jemand eine der tragenden Klassen entfernt
    // oder die Blende in den Strip verschiebt. "md:hidden" ist ab md die
    // EINZIGE Absicherung von "Desktop unverändert" (ein geöffnetes
    // md:absolute-Popover zählt sonst zur Überlaufbreite des Strips und
    // würde canScrollRight auch auf dem Desktop wahr werden lassen);
    // "pointer-events-none" verhindert, dass die 32px-Blende unterhalb md
    // Taps auf darunterliegende Knöpfe schluckt; "absolute" + Geschwister-
    // Prüfung belegen, dass die Blende NICHT im scrollenden Strip selbst
    // liegt (sonst würde sie mitscrollen, siehe DocEditor.jsx-Kommentar
    // direkt über der Blende).
    for (const cls of ["md:hidden", "pointer-events-none", "absolute"]) {
      expect(fade.classList.contains(cls), cls).toBe(true);
    }
    expect(fade.getAttribute("aria-hidden")).toBe("true");
    expect(fade.parentElement).toBe(el.parentElement); // Geschwister des Strips, nicht darin
    expect(el.contains(fade)).toBe(false);

    // Ans Ende gescrollt: 200 + 300 >= 500 - 1 -> keine Blende mehr.
    el.scrollLeft = 200;
    await act(async () => {
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(container.querySelector(".toolbar-scroll-fade")).toBeNull();

    await cleanup();
  });

  it("erscheint auch OHNE Scroll-Event, wenn ein normaler Render die Breite ändert (useLayoutEffect nach jedem Render, DocEditor.jsx)", async () => {
    // Bildet den im Auftrag genannten Fall nach: Werkzeuge blenden ein/aus
    // (z. B. Tabellen-Knöpfe) und lassen scrollWidth wachsen, OHNE dass ein
    // Scroll-Event feuert. Hier ausgelöst über einen Klick auf "Fett", der
    // via onTransaction/setTick einen normalen Re-Render auslöst.
    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    const el = strip(container);
    Object.defineProperty(el, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(el, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(el, "scrollLeft", { value: 0, configurable: true, writable: true });
    // Noch kein Re-Render seit dem Setzen der Maße -> noch keine Blende.
    expect(container.querySelector(".toolbar-scroll-fade")).toBeNull();

    const boldBtn = byTitle(container, "Fett");
    await act(async () => { boldBtn.click(); }); // KEIN Scroll-Event, nur ein Render
    expect(container.querySelector(".toolbar-scroll-fade")).toBeTruthy();

    await cleanup();
  });

  it("erscheint auch nach einem reinen window-resize (ohne Scroll-Event, ohne offenen Picker) – der dauerhafte Fade-Resize-Listener", async () => {
    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    const el = strip(container);
    Object.defineProperty(el, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(el, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(el, "scrollLeft", { value: 0, configurable: true, writable: true });
    expect(container.querySelector(".toolbar-scroll-fade")).toBeNull();

    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(container.querySelector(".toolbar-scroll-fade")).toBeTruthy();

    await cleanup();
  });

  it("Toleranzgrenze (\"- 1\"): bei scrollLeft+clientWidth === scrollWidth-1 keine Blende, einen Pixel davor schon", async () => {
    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    const el = strip(container);
    Object.defineProperty(el, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(el, "scrollWidth", { value: 500, configurable: true }); // scrollWidth - 1 = 499
    Object.defineProperty(el, "scrollLeft", { value: 199, configurable: true, writable: true }); // 199+300=499

    await act(async () => { el.dispatchEvent(new Event("scroll", { bubbles: true })); });
    expect(container.querySelector(".toolbar-scroll-fade")).toBeNull(); // genau an der Toleranzgrenze

    el.scrollLeft = 198; // 198+300=498 < 499
    await act(async () => { el.dispatchEvent(new Event("scroll", { bubbles: true })); });
    expect(container.querySelector(".toolbar-scroll-fade")).toBeTruthy();

    await cleanup();
  });
});

// Review-Fix: belowMd()-Kurzschluss in measurePickerTop/updateScrollFade
// (DocEditor.jsx) - ab md sind Blende und "--pop-top" rein mobile Konzepte
// (CSS blendet beides über "md:hidden"/"md:top-full" ohnehin aus), der
// deps-lose useLayoutEffect lief vorher trotzdem bei JEDER Editor-
// Transaktion mit vollem getBoundingClientRect/scrollWidth-Zugriff. Alle
// ANDEREN Tests dieser Datei laufen bewusst OHNE matchMedia-Stub (jsdom
// kennt window.matchMedia nicht, siehe Kopfkommentar zu belowMd() in
// DocEditor.jsx) und decken damit den defensiven Fallback ("kein
// matchMedia -> wie unterhalb md", unverändertes Verhalten) bereits ab.
describe("Mobile Toolbar (v7.56): belowMd()-Kurzschluss ab md", () => {
  function stubMatchMedia(matches) {
    vi.stubGlobal("matchMedia", vi.fn((query) => ({
      matches,
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })));
  }
  afterEach(() => vi.unstubAllGlobals());

  it("ab md (matchMedia meldet Desktop) bleibt canScrollRight false und KEINE Blende erscheint, obwohl der Strip rechnerisch überläuft", async () => {
    stubMatchMedia(true);
    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    const el = strip(container);
    Object.defineProperty(el, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(el, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(el, "scrollLeft", { value: 0, configurable: true, writable: true });

    await act(async () => { el.dispatchEvent(new Event("scroll", { bubbles: true })); });
    expect(container.querySelector(".toolbar-scroll-fade")).toBeNull();

    await cleanup();
  });

  it("ab md misst measurePickerTop beim Öffnen eines Popovers NICHT (kein getBoundingClientRect-Aufruf)", async () => {
    stubMatchMedia(true);
    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    const el = strip(container);
    const rectSpy = vi.spyOn(el, "getBoundingClientRect");
    const btnEl = byTitle(container, "Schriftfarbe");

    await act(async () => { btnEl.click(); });
    expect(rectSpy).not.toHaveBeenCalled();

    await cleanup();
  });

  it("matchMedia meldet explizit 'unterhalb md' (matches:false) -> Blende erscheint weiterhin normal (Fallback-Zweig bleibt unverändert)", async () => {
    stubMatchMedia(false);
    const { container, cleanup } = await mountDocEditor("# T\n\nText");
    const el = strip(container);
    Object.defineProperty(el, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(el, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(el, "scrollLeft", { value: 0, configurable: true, writable: true });

    await act(async () => { el.dispatchEvent(new Event("scroll", { bubbles: true })); });
    expect(container.querySelector(".toolbar-scroll-fade")).toBeTruthy();

    await cleanup();
  });
});

// Quelltextbasierte Vollständigkeitsprüfung (wie im Fokus-Test, Punkt 2
// dortiger Kopfkommentar): belegt, dass KEIN Popover mehr ohne die
// mobilen fixed/left-4/right-4-Klassen im Quelltext übrig geblieben ist –
// ein neu hinzugefügtes Popover, das diese Migration vergisst, fällt
// damit auf.
describe("Mobile Toolbar (v7.56): Quelltext – kein 'absolute z-10 top-full left-0 mt-1'-Popover mehr ohne mobile Klassen", () => {
  it("die alte, rein absolute Popover-Positionierung kommt im Quelltext nicht mehr vor", () => {
    expect(DOC_EDITOR_SRC).not.toContain("absolute z-10 top-full left-0 mt-1");
  });

  it("alle DREI Popover-Templates (swatchGrid – gemeinsam für Schriftfarbe+Textmarker –, Tabelle, Link) tragen exakt dasselbe mobile Klassen-Set", () => {
    // swatchGrid ist EINE Funktion, die für Schriftfarbe UND Textmarker
    // wiederverwendet wird (siehe Aufruf zweimal weiter unten im Quelltext)
    // – im QUELLTEXT taucht das Klassen-Set deshalb nur DREImal auf (nicht
    // viermal), obwohl vier Popover GERENDERT werden können.
    // Review-Hinweis Runde 2 (🟢 Finding 5): "count === 3" ist ein reiner
    // ÄNDERUNGSDETEKTOR, kein Verhaltenstest – ein legitimes FÜNFTES
    // Popover-Template mit demselben mobilen Klassen-Set bricht diesen
    // Test, OHNE dass etwas kaputt ist. In dem Fall die Zahl bewusst
    // hochziehen (kein Bug, nur Nachführen dieser Zählung).
    const marker = "md:absolute md:top-full md:left-0 md:right-auto md:mt-1 top-[var(--pop-top)]";
    const count = DOC_EDITOR_SRC.split(marker).length - 1;
    expect(count).toBe(3);
  });

  it("openPicker() wird für alle vier Öffner-Pfade verwendet (Schriftfarbe/Textmarker/Tabelle direkt, Link über openLinkPicker())", () => {
    expect(DOC_EDITOR_SRC).toContain('openPicker("color")');
    expect(DOC_EDITOR_SRC).toContain('openPicker("highlight")');
    expect(DOC_EDITOR_SRC).toContain('openPicker("table")');
    expect(DOC_EDITOR_SRC).toContain('openPicker("link")');
  });
});
