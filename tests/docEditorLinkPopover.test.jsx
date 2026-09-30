// @vitest-environment jsdom
//
// v7.58 (docs/TODO.md, E2E-Beobachtung bei D7/D7b): Link-Popover im
// Dokument-Editor. Zwei Befunde, beide hier an einem ECHT gerenderten
// DocEditor mit echten Events geprüft:
//
// 1. Nach "Einfügen"/"Übernehmen" lag der DOM-Fokus nicht im Editor.
//    Ursache: editor.chain().focus() (@tiptap/core#focus) setzt den Fokus
//    erst per requestAnimationFrame. Bis dahin hält der geklickte Knopf den
//    Fokus, beim Schließen des Popovers fällt er auf <body> – und in einem
//    verdeckten Browser-Tab feuert requestAnimationFrame gar nicht, der
//    Fokus käme dort NIE an. Der Fix setzt ihn synchron (view.focus()).
//    DAHER wird requestAnimationFrame in diesen Tests durch einen Stub
//    ersetzt, der Callbacks nur sammelt und NIE ausführt (= verdeckter
//    Tab): die Fokus-Assertions gelten also ohne jedes Vorspulen von Frames
//    (siehe stubRaf unten).
// 2. Enter im Titel-/URL-Feld löste nichts aus. Jetzt = derselbe Weg wie der
//    Knopf (gleiche Validierung), nicht während einer IME-Komposition.
//
// Zusätzlich: Die Link-Mark ist wegen autolink:true INKLUSIV – ohne
// unsetMark("link") nach dem Einfügen würde sofort weitergetippter Text Teil
// des Links (Akzeptanzkriterium "Text landet hinter dem Link").
//
// GRENZEN VON JSDOM (ehrlich benannt): jsdom verschiebt bei mousedown NICHT
// den Fokus auf den Knopf (siehe tests/docEditorToolbarFocus.test.jsx) –
// browserClick() bildet den Browser-Default deshalb von Hand nach. Native
// contenteditable-Eingabe gibt es in jsdom nicht; getippter Text wird über
// denselben ProseMirror-Pfad eingespielt wie bei einem echten Tastendruck
// (handleTextInput -> tr.insertText mit den gespeicherten Marks, siehe
// typeText). Ein Implicit-Submit von Enter (Browser-Default in <form>)
// existiert in jsdom ebenfalls nicht – dass hier keines stattfinden kann,
// stützt sich auf "kein <form> im Popover" (Struktur-Test unten) plus
// event.defaultPrevented.
import { describe, it, expect, vi, afterEach } from "vitest";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import DocEditor, { normalizeLinkUrl, validateLinkTitle, unescapeMd } from "../src/components/DocEditor.jsx";
import { setLinkProviders } from "../src/lib/linkProviders.jsx";

// ---------- Aufbau / Aufräumen ----------

const mounted = [];

async function mountDocEditor(initialDoc) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  // Ein ECHTER Frame INNERHALB von act(): autofocus:"start" (useEditor) stößt
  // denselben rAF-verzögerten Fokus an, siehe docEditorToolbarFocus.test.jsx.
  // Der rAF-Stub wird bewusst erst NACH dem Mounten installiert.
  await act(async () => {
    root.render(
      <DocEditor
        initialDoc={initialDoc}
        imgMap={{}}
        onSave={() => {}}
        onCancel={() => {}}
        saving={false}
        navWidth={148}
        autocorrect={undefined}
      />
    );
    await new Promise((r) => requestAnimationFrame(r));
  });
  const pm = container.querySelector(".ProseMirror");
  // Autofokus abwarten: TipTap legt den Editor erst NACH dem Rückkehren von
  // act() an und setzt die Selektion dann per setTimeout(0) auf den
  // Dokumentanfang (commands.focus("start"), Fokus selbst folgt per rAF).
  // Ohne dieses Warten würde der Timer mitten in einem Test die vom Test
  // gesetzte Cursor-Position wieder überschreiben.
  await vi.waitFor(() => expect(document.activeElement).toBe(pm), { timeout: 2000 });
  return { container, root, pm, editor: pm.editor };
}

// Verdeckter Tab: requestAnimationFrame sammelt Callbacks, führt sie aber
// NIE aus. Die Warteschlange bleibt zur Kontrolle sichtbar.
let rafQueue = [];
function stubRaf() {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
}

const PROVIDER_AZURE = {
  id: "az", type: "azure-devops", name: "DevOps", prefix: "https://dev.azure.com/", pat: "test-pat",
};
const AZURE_URL = "https://dev.azure.com/acme/Proj/_workitems/edit/1";

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLinkProviders([]);
  while (mounted.length) {
    const { container, root } = mounted.pop();
    await act(async () => root.unmount());
    container.remove();
  }
});

// ---------- Events wie im Browser ----------

// Maus-Klick inkl. Browser-Default "mousedown fokussiert das (fokussierbare)
// Ziel, es sei denn, mousedown wurde per preventDefault abgebrochen".
async function browserClick(el) {
  await act(async () => {
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    el.dispatchEvent(down);
    if (!down.defaultPrevented) el.focus();
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// Nutzer klickt ins Feld (Fokus) und ersetzt dessen Inhalt. Der native
// Value-Setter des Prototyps umgeht Reacts Wert-Tracker, damit das
// input-Event wirklich onChange auslöst.
async function typeInto(input, value) {
  await browserClick(input);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressKey(el, init) {
  const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    el.dispatchEvent(ev);
  });
  return ev;
}

// Lässt Promise-Ketten (fetch-Mock, await in fetchLinkTitle) auslaufen.
// setImmediate wird von den Fake-Timern unten bewusst NICHT ersetzt.
async function flush() {
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
}

// ---------- Zugriff auf UI und Dokument ----------

const opener = (c) => c.querySelector('button[title="Link einfügen/bearbeiten"]');
const titleInput = (c) => c.querySelector('input[placeholder="Sprechender Titel"]');
const urlInput = (c) => c.querySelector('input[placeholder="https://…"]');
const popoverOpen = (c) => !!urlInput(c);
const popoverEl = (c) => urlInput(c).parentElement;
const buttonByText = (c, text) => {
  const b = Array.from(c.querySelectorAll("button")).find((el) => el.textContent.trim() === text);
  if (!b) throw new Error('Button "' + text + '" nicht gefunden');
  return b;
};

function linkRuns(editor) {
  const out = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === "link");
    if (mark) out.push({ text: node.text, href: mark.attrs.href, from: pos, to: pos + node.nodeSize });
  });
  return out;
}

// Position direkt HINTER dem ersten Vorkommen von needle in einem Textknoten.
function posAfter(editor, needle) {
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null || !node.isText) return;
    const i = node.text.indexOf(needle);
    if (i >= 0) found = pos + i + needle.length;
  });
  if (found === null) throw new Error('Text "' + needle + '" nicht im Dokument');
  return found;
}

const markdownOf = (editor) => unescapeMd(editor.storage.markdown.getMarkdown());

async function setSelection(editor, pos) {
  await act(async () => {
    editor.commands.setTextSelection(pos);
  });
}

// Wie ein Tastendruck im Editor: PM fragt zuerst handleTextInput (TipTap-
// Input-Rules, AutoKorrektur) und fällt sonst auf tr.insertText zurück,
// das die GESPEICHERTEN Marks (bzw. die am Cursor) übernimmt.
async function typeText(editor, text) {
  await act(async () => {
    const { view } = editor;
    const { from, to } = view.state.selection;
    if (!view.someProp("handleTextInput", (f) => f(view, from, to, text))) {
      view.dispatch(view.state.tr.insertText(text, from, to));
    }
  });
}

// Neuer Link an einer Cursor-Position mitten im Text; Popover ist geöffnet.
async function openNewLinkPopover() {
  const ctx = await mountDocEditor("Anfang Ende");
  stubRaf();
  await setSelection(ctx.editor, posAfter(ctx.editor, "Anfang "));
  await browserClick(opener(ctx.container));
  expect(popoverOpen(ctx.container)).toBe(true);
  return ctx;
}

// Bestehender Link, Cursor mitten im Linktext; Popover ist geöffnet.
async function openExistingLinkPopover() {
  const ctx = await mountDocEditor("Vorher [Alter Titel](https://example.org/alt) nachher");
  stubRaf();
  await setSelection(ctx.editor, linkRuns(ctx.editor)[0].from + 3);
  await browserClick(opener(ctx.container));
  expect(popoverOpen(ctx.container)).toBe(true);
  expect(titleInput(ctx.container).value).toBe("Alter Titel"); // Vorbelegung aus dem Link
  expect(urlInput(ctx.container).value).toBe("https://example.org/alt");
  return ctx;
}

// ---------- Einfügen: Fokus + Cursor + Nicht-Teil-des-Links ----------

describe("Einfügen per Klick: Fokus zurück im Editor, ohne dass je ein requestAnimationFrame läuft", () => {
  it("activeElement liegt sofort im Editor, Cursor steht direkt hinter dem Link, weitergetippter Text ist NICHT Teil des Links", async () => {
    const { container, pm, editor } = await openNewLinkPopover();
    await typeInto(titleInput(container), "Mein Titel");
    await typeInto(urlInput(container), "example.org/seite"); // ohne Schema -> https:// wird ergänzt

    await browserClick(buttonByText(container, "Einfügen"));

    expect(document.activeElement).toBe(pm);
    expect(popoverOpen(container)).toBe(false);
    const runs = linkRuns(editor);
    expect(runs.map((r) => [r.text, r.href])).toEqual([["Mein Titel", "https://example.org/seite"]]);
    // Cursor: leer und exakt am Ende des Link-Textes.
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(runs[0].to);

    await typeText(editor, "X");
    // X klebt HINTER dem Link und ist selbst kein Link; "Ende" bleibt unberührt.
    expect(markdownOf(editor)).toBe("Anfang [Mein Titel](https://example.org/seite)XEnde");
    expect(linkRuns(editor).map((r) => r.text)).toEqual(["Mein Titel"]);
  });

  it("der Fokus kommt ohne TipTaps rAF-Fokus an: kein Nachzügler-Frame wird eingereiht", async () => {
    const { container, pm } = await openNewLinkPopover();
    await typeInto(titleInput(container), "Titel");
    await typeInto(urlInput(container), "https://example.org/a");
    const queued = rafQueue.length;

    await browserClick(buttonByText(container, "Einfügen"));

    // Ein eingereihter rAF-Fokus würde in einem verdeckten Tab erst beim
    // Zurückwechseln feuern und den Fokus aus einem inzwischen angeklickten
    // Feld zurück in den Editor reißen.
    expect(rafQueue.length).toBe(queued);
    expect(document.activeElement).toBe(pm);
  });

  it("Absatzende: auch ohne Folgetext ist der danach getippte Text nicht Teil des Links", async () => {
    // Randfall: Cursor am ABSATZENDE (kein Folgetext, der die Mark-Grenze
    // markieren würde). Ohne unsetMark("link") trüge auch hier der Cursor die
    // inklusive Link-Mark.
    const { container, editor } = await mountDocEditor("Ende der Zeile");
    stubRaf();
    await setSelection(editor, posAfter(editor, "Ende der Zeile"));
    await browserClick(opener(container));
    await typeInto(titleInput(container), "Quelle");
    await typeInto(urlInput(container), "https://example.org/q");
    await browserClick(buttonByText(container, "Einfügen"));

    await typeText(editor, " weiter");
    expect(markdownOf(editor)).toBe("Ende der Zeile[Quelle](https://example.org/q) weiter");
  });
});

// ---------- Enter = Einfügen ----------

describe.each([
  ["URL", urlInput],
  ["Titel", titleInput],
])("Enter im %s-Feld = Einfügen", (_label, field) => {
  it("fügt den Link ein, verbraucht das Enter (kein Implicit-Submit/Umbruch) und fokussiert den Editor", async () => {
    const { container, pm, editor } = await openNewLinkPopover();
    await typeInto(titleInput(container), "Per Enter");
    await typeInto(urlInput(container), "https://example.org/enter");

    const ev = await pressKey(field(container), { key: "Enter" });

    // preventDefault: verhindert die Enter-Folgeereignisse (keypress/
    // beforeinput), die nach dem Fokuswechsel sonst im Editor einen
    // Absatzumbruch erzeugen würden.
    expect(ev.defaultPrevented).toBe(true);
    expect(popoverOpen(container)).toBe(false);
    expect(document.activeElement).toBe(pm);
    // Genau EIN Link, genau EIN Absatz (kein doppeltes Auslösen, kein Umbruch).
    expect(linkRuns(editor).map((r) => [r.text, r.href])).toEqual([["Per Enter", "https://example.org/enter"]]);
    expect(markdownOf(editor)).toBe("Anfang [Per Enter](https://example.org/enter)Ende");
    const runs = linkRuns(editor);
    expect(editor.state.selection.from).toBe(runs[0].to);
    await typeText(editor, "!");
    expect(markdownOf(editor)).toBe("Anfang [Per Enter](https://example.org/enter)!Ende");
  });
});

// Gleiche Validierung für Klick und Enter: dieselbe Datenlage, drei
// Auslöser, jeweils derselbe Fehlertext, nichts eingefügt, Popover offen.
describe.each([
  ["reine Ziffern als Titel", "42", "https://example.org/ok", validateLinkTitle("42").error],
  ["leerer Titel", "   ", "https://example.org/ok", validateLinkTitle("   ").error],
  ["javascript:-URL", "Titel", "javascript:alert(1)", normalizeLinkUrl("javascript:alert(1)").error],
  ["leere URL", "Titel", "", normalizeLinkUrl("").error],
  // Beide ungültig: wie beim Knopf gewinnt der Titel-Fehler (zuerst geprüft).
  ["ungültiger Titel UND ungültige URL", "7", "ftp://example.org/x", validateLinkTitle("7").error],
])("Validierung (%s)", (_label, title, url, expectedError) => {
  it.each([
    ["Klick auf Einfügen", async (c) => { await browserClick(buttonByText(c, "Einfügen")); }],
    ["Enter im Titel-Feld", async (c) => { await pressKey(titleInput(c), { key: "Enter" }); }],
    ["Enter im URL-Feld", async (c) => { await pressKey(urlInput(c), { key: "Enter" }); }],
  ])("%s: Fehlertext erscheint, nichts wird eingefügt, Popover bleibt offen", async (_trigger, trigger) => {
    expect(expectedError).toBeTruthy(); // Vorbedingung: die Datenlage ist wirklich ungültig
    const { container, pm, editor } = await openNewLinkPopover();
    await typeInto(titleInput(container), title);
    await typeInto(urlInput(container), url);

    await trigger(container);

    expect(popoverOpen(container)).toBe(true);
    expect(container.textContent).toContain(expectedError);
    expect(linkRuns(editor)).toEqual([]);
    expect(markdownOf(editor)).toBe("Anfang Ende");
    expect(document.activeElement).not.toBe(pm);
  });
});

describe("Enter mit Fehler: der Fokus bleibt im Feld", () => {
  it.each([
    ["URL", urlInput, "Titel", "javascript:alert(1)"],
    ["Titel", titleInput, "99", "https://example.org/ok"],
  ])("Enter im %s-Feld lässt den Fokus dort (Nutzer kann direkt korrigieren)", async (_label, field, title, url) => {
    const { container } = await openNewLinkPopover();
    await typeInto(titleInput(container), title);
    await typeInto(urlInput(container), url);
    await browserClick(field(container)); // Fokus ins zu prüfende Feld

    await pressKey(field(container), { key: "Enter" });

    expect(popoverOpen(container)).toBe(true);
    expect(document.activeElement).toBe(field(container));
    // Weitertippen löscht den Fehler (bestehendes onChange-Verhalten) und
    // erlaubt einen zweiten, dann gültigen Versuch per Enter.
    await typeInto(titleInput(container), "Korrigiert");
    await typeInto(urlInput(container), "https://example.org/ok");
    await pressKey(urlInput(container), { key: "Enter" });
    expect(popoverOpen(container)).toBe(false);
  });
});

describe("Enter: nur Enter, und nicht während einer IME-Komposition", () => {
  it.each([
    ["isComposing:true", { key: "Enter", isComposing: true }],
    // Safari meldet das Komposition-bestätigende Enter teils mit
    // isComposing:false, aber keyCode 229.
    ["keyCode 229", { key: "Enter", keyCode: 229 }],
  ])("Enter mit %s löst nichts aus (kein Einfügen, Enter wird NICHT verschluckt)", async (_label, init) => {
    const { container, editor } = await openNewLinkPopover();
    await typeInto(titleInput(container), "Komposition");
    await typeInto(urlInput(container), "https://example.org/ime");

    for (const field of [titleInput, urlInput]) {
      const ev = await pressKey(field(container), init);
      // Das Enter gehört der IME (bestätigt die Komposition) – nicht abbrechen.
      expect(ev.defaultPrevented).toBe(false);
    }

    expect(popoverOpen(container)).toBe(true);
    expect(linkRuns(editor)).toEqual([]);
    expect(markdownOf(editor)).toBe("Anfang Ende");
    // Danach (Komposition beendet) funktioniert Enter wieder normal.
    await pressKey(urlInput(container), { key: "Enter" });
    expect(popoverOpen(container)).toBe(false);
    expect(linkRuns(editor).map((r) => r.text)).toEqual(["Komposition"]);
  });

  it.each(["a", "Escape", "Tab", " "])("die Taste %j löst weder Einfügen aus noch wird sie abgefangen", async (key) => {
    const { container, editor } = await openNewLinkPopover();
    await typeInto(titleInput(container), "Titel");
    await typeInto(urlInput(container), "https://example.org/x");

    const ev = await pressKey(urlInput(container), { key });

    expect(ev.defaultPrevented).toBe(false);
    expect(popoverOpen(container)).toBe(true);
    expect(linkRuns(editor)).toEqual([]);
  });
});

// ---------- Bestehender Link ----------

describe("Bestehender Link (Übernehmen / Entfernen)", () => {
  it("Übernehmen per Enter ersetzt den KOMPLETTEN alten Link, Fokus im Editor, weitergetippter Text ist nicht Teil des Links", async () => {
    const { container, pm, editor } = await openExistingLinkPopover();
    expect(buttonByText(container, "Übernehmen")).toBeTruthy();
    await typeInto(titleInput(container), "Neuer Titel");
    await typeInto(urlInput(container), "https://example.org/neu");

    const ev = await pressKey(urlInput(container), { key: "Enter" });

    expect(ev.defaultPrevented).toBe(true);
    expect(popoverOpen(container)).toBe(false);
    expect(document.activeElement).toBe(pm);
    expect(markdownOf(editor)).toBe("Vorher [Neuer Titel](https://example.org/neu) nachher");
    const runs = linkRuns(editor);
    expect(runs).toHaveLength(1);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(runs[0].to);

    await typeText(editor, "X");
    expect(markdownOf(editor)).toBe("Vorher [Neuer Titel](https://example.org/neu)X nachher");
    expect(linkRuns(editor).map((r) => r.text)).toEqual(["Neuer Titel"]);
  });

  it("Übernehmen per Klick verhält sich wie Enter (Fokus im Editor ohne rAF)", async () => {
    const { container, pm, editor } = await openExistingLinkPopover();
    await typeInto(titleInput(container), "Per Klick");

    await browserClick(buttonByText(container, "Übernehmen"));

    expect(document.activeElement).toBe(pm);
    expect(markdownOf(editor)).toBe("Vorher [Per Klick](https://example.org/alt) nachher");
  });

  it("Entfernen gibt den Fokus zurück, lässt den Text stehen und setzt den Cursor dahinter (nächster Tastendruck überschreibt den Text NICHT)", async () => {
    const { container, pm, editor } = await openExistingLinkPopover();
    const queued = rafQueue.length;

    await browserClick(buttonByText(container, "Entfernen"));

    expect(document.activeElement).toBe(pm);
    expect(rafQueue.length).toBe(queued); // kein Nachzügler-Frame
    expect(popoverOpen(container)).toBe(false);
    expect(linkRuns(editor)).toEqual([]);
    expect(markdownOf(editor)).toBe("Vorher Alter Titel nachher");
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(posAfter(editor, "Alter Titel"));

    await typeText(editor, "X");
    expect(markdownOf(editor)).toBe("Vorher Alter TitelX nachher");
  });

  it("Öffnen bleibt unverändert: öffnet die URL, das Popover bleibt offen, der Fokus wandert NICHT in den Editor", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container, pm, editor } = await openExistingLinkPopover();
    const openBtn = buttonByText(container, "Öffnen");

    await browserClick(openBtn);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith("https://example.org/alt", "_blank", "noopener");
    expect(popoverOpen(container)).toBe(true);
    expect(document.activeElement).toBe(openBtn);
    expect(document.activeElement).not.toBe(pm);
    expect(markdownOf(editor)).toBe("Vorher [Alter Titel](https://example.org/alt) nachher");
  });

  it("Öffnen ignoriert Nicht-http(s)-URLs weiterhin (kein window.open)", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = await openExistingLinkPopover();
    await typeInto(urlInput(container), "file:///C:/Users/x/Bericht.docx");

    await browserClick(buttonByText(container, "Öffnen"));

    expect(openSpy).not.toHaveBeenCalled();
    expect(popoverOpen(container)).toBe(true);
  });
});

// ---------- Schließen ohne Aktion, Struktur, Mobil ----------

describe("Schließen ohne Aktion und Popover-Struktur", () => {
  it("erneuter Klick auf den Link-Knopf schließt das Popover wie bisher: Dokument unberührt, Fokus NICHT in den Editor gezwungen", async () => {
    const { container, pm, editor } = await openNewLinkPopover();
    await typeInto(titleInput(container), "Verworfen");
    await typeInto(urlInput(container), "https://example.org/x");

    await browserClick(opener(container));

    expect(popoverOpen(container)).toBe(false);
    expect(linkRuns(editor)).toEqual([]);
    expect(markdownOf(editor)).toBe("Anfang Ende");
    expect(document.activeElement).toBe(opener(container));
    expect(document.activeElement).not.toBe(pm);
  });

  it("alle Popover-Knöpfe tragen type=\"button\"; es gibt kein <form> (Enter läuft NUR über den Key-Handler)", async () => {
    setLinkProviders([PROVIDER_AZURE]); // blendet zusätzlich "Titel ermitteln" ein
    const { container } = await openExistingLinkPopover();
    await typeInto(urlInput(container), AZURE_URL);
    const pop = popoverEl(container);
    const labels = Array.from(pop.querySelectorAll("button")).map((b) => b.textContent.trim());
    // Alle vier Knöpfe müssen dabei sein, sonst prüft die Schleife zu wenig.
    expect(labels).toEqual(["Titel ermitteln", "Übernehmen", "Entfernen", "Öffnen"]);
    for (const b of pop.querySelectorAll("button")) {
      expect(b.getAttribute("type"), b.textContent.trim()).toBe("button");
    }
    expect(container.querySelector("form")).toBeNull();
    expect(pop.closest("form")).toBeNull();
  });

  it("Mobil unverändert: das Popover bleibt unterhalb md 'fixed' (Position aus --pop-top), ab md 'absolute'", async () => {
    const { container } = await openNewLinkPopover();
    const cls = popoverEl(container).className;
    expect(cls).toContain("fixed");
    expect(cls).toContain("md:absolute");
    expect(cls).toContain("top-[var(--pop-top)]");
    expect(cls).toContain("left-4 right-4");
  });
});

// ---------- Titel ermitteln / Auto-Fetch ----------

// Fake-Timer ERST nach dem Mounten (sonst bliebe TipTaps Autofokus-Timer
// hängen und feuerte mitten im Test, siehe mountDocEditor). Nur setTimeout/
// clearTimeout: setImmediate (act, flush) und Date bleiben echt.
function installFakeTimers() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

function azureResponse(title) {
  return {
    ok: true, status: 200, type: "basic",
    json: async () => ({ fields: { "System.Title": title, "System.WorkItemType": "Bug" } }),
  };
}

describe("Titel ermitteln / Auto-Fetch bleiben mit dem neuen Schließen-Weg konsistent", () => {
  it("'Titel ermitteln' bleibt unverändert: füllt den Titel, das Popover bleibt offen, der Fokus geht NICHT in den Editor", async () => {
    setLinkProviders([PROVIDER_AZURE]);
    const { container, pm, editor } = await openNewLinkPopover();
    installFakeTimers();
    const fetchMock = vi.fn(async () => azureResponse("Fehler beim Speichern"));
    vi.stubGlobal("fetch", fetchMock);
    await typeInto(urlInput(container), AZURE_URL);
    const fetchBtn = buttonByText(container, "Titel ermitteln");

    await browserClick(fetchBtn);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1); // der manuelle Klick verwirft den wartenden Auto-Timer
    expect(titleInput(container).value).toBe("Bug 1: Fehler beim Speichern");
    expect(popoverOpen(container)).toBe(true);
    expect(document.activeElement).not.toBe(pm);
    expect(linkRuns(editor)).toEqual([]);
    // Ein später ablaufender Debounce-Timer darf keinen zweiten Request auslösen.
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Enter vor Ablauf der Debounce-Zeit verwirft den wartenden Auto-Fetch: es geht nie ein Request raus", async () => {
    setLinkProviders([PROVIDER_AZURE]);
    const { container, editor } = await openNewLinkPopover();
    installFakeTimers();
    const fetchMock = vi.fn(async () => azureResponse("sollte nie geholt werden"));
    vi.stubGlobal("fetch", fetchMock);
    await typeInto(titleInput(container), "Mein Ticket");
    await typeInto(urlInput(container), AZURE_URL); // plant den Auto-Fetch (600 ms)
    await act(async () => { vi.advanceTimersByTime(599); });
    expect(fetchMock).not.toHaveBeenCalled();

    await pressKey(urlInput(container), { key: "Enter" });
    expect(linkRuns(editor).map((r) => [r.text, r.href])).toEqual([["Mein Ticket", AZURE_URL]]);

    await act(async () => { vi.advanceTimersByTime(10_000); });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Enter WÄHREND eines laufenden Auto-Fetches: das spät eintreffende Ergebnis ändert weder das Dokument noch ein neu geöffnetes Popover (und erzeugt keine React-Fehlermeldung)", async () => {
    setLinkProviders([PROVIDER_AZURE]);
    const { container, editor } = await openNewLinkPopover();
    installFakeTimers();
    let resolveFetch;
    const pending = new Promise((r) => { resolveFetch = r; });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await typeInto(titleInput(container), "Mein Ticket");
    await typeInto(urlInput(container), AZURE_URL);
    await act(async () => { vi.advanceTimersByTime(600); }); // Debounce feuert, Request hängt
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await pressKey(urlInput(container), { key: "Enter" });
    expect(popoverOpen(container)).toBe(false);
    // Neues Popover direkt an der Cursor-Position hinter dem Link: der Link
    // gilt dort NICHT mehr als aktiv (gespeicherte Mark entfernt) -> frisches
    // "Einfügen"-Formular mit leerem Titel.
    await browserClick(opener(container));
    expect(popoverOpen(container)).toBe(true);
    expect(titleInput(container).value).toBe("");

    await act(async () => {
      resolveFetch(azureResponse("Später Titel"));
      await new Promise((r) => setImmediate(r));
    });

    expect(titleInput(container).value).toBe(""); // Stale-Ergebnis verworfen
    expect(markdownOf(editor)).toBe("Anfang [Mein Ticket](" + AZURE_URL + ")Ende");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("Schließen ohne Aktion verwirft den wartenden Auto-Fetch ebenfalls (closeLinkPicker unverändert)", async () => {
    setLinkProviders([PROVIDER_AZURE]);
    const { container } = await openNewLinkPopover();
    installFakeTimers();
    const fetchMock = vi.fn(async () => azureResponse("nie"));
    vi.stubGlobal("fetch", fetchMock);
    await typeInto(urlInput(container), AZURE_URL);

    await browserClick(opener(container)); // schließen
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await flush();

    expect(popoverOpen(container)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
