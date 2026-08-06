// @vitest-environment jsdom
//
// v7.41 Teil B (Nutzerwunsch "Ich würde gerne Bilder direkt in den Editor
// kopieren können. Das geht auch, aber ich kann es nicht speichern."):
// echter TipTap/markdown-it-Zyklus nach demselben Muster wie
// tests/docEditorIndent.test.jsx/docEditorOutline.test.jsx statt String-
// Helfer nachzubauen. Deckt die reinen, aus DocEditor.jsx exportierten
// Bausteine ab (siehe Kopfkommentar dort, direkt über der Komponente):
//  1. extractImageFiles: .items bevorzugt, .files nur als Fallback, Filter
//     auf image/*, Randfälle (kein dataTransfer, gemischte Typen).
//  2. findRemoteImageSrc/detectPastedImages: erkennt eine von einer
//     Webseite kopierte <img src="https://…">-Grafik OHNE Datei, lässt
//     reinen Text/HTML UNVERÄNDERT durch (kein false positive).
//  3. insertImagesSequentially: Erfolgspfad (Dokument enthält danach
//     ![…](img:<id>) und KEIN data:, echter unresolveImgs/unescapeMd-
//     Roundtrip), Fehlerpfad (kein halber Zustand, onError greift, Rest
//     der Liste läuft weiter), mehrere Bilder in korrekter Reihenfolge.
//  4. UNRESOLVED_IMG_RE: das Sicherheitsnetz aus save() bleibt für den
//     Ausnahmefall (ohne Verbindung eingefügt/von einer Webseite kopiert)
//     scharf, lässt normale img:-Referenzen und normale Text-Links
//     unangetastet.
//  5. Regressionstests aus dem Code-Review VOR dem v7.41-Commit:
//     stripRemoteImages (Finding 4 – ein Webseiten-Ausschnitt MIT Bild
//     durfte nicht mehr den kompletten Paste blockieren), Positions-
//     Klemmung in insertImagesSequentially nach einem await (Finding 8),
//     akzeptierte Bild-MIME-Typen (Finding 10 – SVG/AVIF/BMP werden NICHT
//     mehr übernommen, extForMime kennt sie nicht), Finding 9
//     (onAddImage-Prop soll bei Paste/Drop nie veralten – siehe der
//     entsprechende Test unten für das ÜBERRASCHENDE Ergebnis).
// Nur DIESE Datei braucht jsdom (per-Datei-Override), der Rest der Suite
// bleibt bei environment:"node" (vitest.config.js).
import { describe, it, expect, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import DocEditor, {
  BlockImage, unescapeMd, unresolveImgs,
  extractImageFiles, findRemoteImageSrc, detectPastedImages, stripRemoteImages,
  insertImagesSequentially, UNRESOLVED_IMG_RE,
} from "../src/components/DocEditor.jsx";
import { ACCEPTED_IMAGE_MIME, isAcceptedImageType } from "../src/lib/images.js";

function buildEditor(md = "# T\n\nHallo") {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
      BlockImage,
      Markdown.configure({ html: true, bulletListMarker: "-", tightLists: true }),
    ],
    content: md,
  });
}

// Simuliert exakt den relevanten Ausschnitt von save() in DocEditor.jsx
// (unresolveImgs -> unescapeMd), ohne collapseChecklistGaps (hier nicht
// gebraucht) – siehe tests/docEditorIndent.test.jsx#saveLike für dasselbe
// Muster.
function saveLike(editor, imgMap) {
  return unescapeMd(unresolveImgs(editor.storage.markdown.getMarkdown(), imgMap));
}

describe("extractImageFiles (reine Funktion)", () => {
  it("liefert Bilddateien aus .items (kind:file, image/*)", () => {
    const file = new File([new Uint8Array(4)], "shot.png", { type: "image/png" });
    const dt = { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] };
    expect(extractImageFiles(dt)).toEqual([file]);
  });

  it("ignoriert Nicht-Bild-Einträge in .items (z. B. eine mitkopierte Textdatei)", () => {
    const dt = { items: [{ kind: "file", type: "text/plain", getAsFile: () => new File([""], "a.txt") }] };
    expect(extractImageFiles(dt)).toEqual([]);
  });

  it("ignoriert string-Einträge in .items (Text/HTML-Paste, kein Datei-kind)", () => {
    const dt = { items: [{ kind: "string", type: "text/html" }] };
    expect(extractImageFiles(dt)).toEqual([]);
  });

  it("fällt auf .files zurück, wenn .items KEIN Bild ergab (z. B. Browser ohne .items-Unterstützung)", () => {
    const file = new File([new Uint8Array(4)], "shot.png", { type: "image/png" });
    const dt = { items: [], files: [file] };
    expect(extractImageFiles(dt)).toEqual([file]);
  });

  it("nutzt NUR .items, wenn dort bereits ein Bild gefunden wurde (kein doppeltes Einfügen über .files)", () => {
    const fromItems = new File([new Uint8Array(4)], "shot.png", { type: "image/png" });
    const fromFiles = new File([new Uint8Array(4)], "shot.png", { type: "image/png" });
    const dt = { items: [{ kind: "file", type: "image/png", getAsFile: () => fromItems }], files: [fromFiles] };
    expect(extractImageFiles(dt)).toEqual([fromItems]);
  });

  it("mehrere Bilder in .items werden alle übernommen, in Reihenfolge", () => {
    const f1 = new File([new Uint8Array(1)], "a.png", { type: "image/png" });
    const f2 = new File([new Uint8Array(1)], "b.jpg", { type: "image/jpeg" });
    const dt = { items: [
      { kind: "file", type: "image/png", getAsFile: () => f1 },
      { kind: "file", type: "image/jpeg", getAsFile: () => f2 },
    ] };
    expect(extractImageFiles(dt)).toEqual([f1, f2]);
  });

  it("liefert [] für fehlendes/leeres dataTransfer (kein Absturz)", () => {
    expect(extractImageFiles(null)).toEqual([]);
    expect(extractImageFiles(undefined)).toEqual([]);
    expect(extractImageFiles({})).toEqual([]);
  });
});

describe("findRemoteImageSrc / detectPastedImages (reine Funktionen)", () => {
  it("liefert null für reinen Fließtext ohne jedes Bild (Paste von reinem Text bleibt unverändert)", () => {
    const editor = buildEditor("# T\n\nEinfacher Fließtext ohne Bild.");
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    editor.destroy();
    expect(findRemoteImageSrc(slice)).toBeNull();
    expect(detectPastedImages({}, slice)).toBeNull();
  });

  it("erkennt eine von einer Webseite kopierte <img src=\"https://…\">-Grafik im geparsten Inhalt", () => {
    // html:true lässt rohes HTML durch markdown-it passieren (siehe
    // Markdown.configure oben) – BlockImage.parseHTML (allowBase64:true,
    // Selektor "img[src]") übernimmt daraus einen echten image-Node.
    const editor = buildEditor('# T\n\n<img src="https://example.com/pic.png">');
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    let hadImage = false;
    editor.state.doc.descendants((n) => { if (n.type.name === "image") hadImage = true; });
    editor.destroy();
    expect(hadImage).toBe(true); // Testaufbau-Kontrolle: das Bild kam wirklich als Node an
    expect(findRemoteImageSrc(slice)).toBe("https://example.com/pic.png");
  });

  it("ignoriert ein internes Bild mit data:-Quelle (kommt beim Ziehen INNERHALB des Editors vor, ist kein Remote-Fall)", () => {
    const editor = buildEditor('# T\n\n<img src="data:image/png;base64,AAAA">');
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    editor.destroy();
    expect(findRemoteImageSrc(slice)).toBeNull();
  });

  it("ignoriert eine normale img:-Referenz (kein http(s)-Schema)", () => {
    const editor = buildEditor("# T\n\n![Alt](img:abc123)");
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    editor.destroy();
    expect(findRemoteImageSrc(slice)).toBeNull();
  });

  it("findRemoteImageSrc wirft nie bei leerer/fehlender Slice", () => {
    expect(findRemoteImageSrc(null)).toBeNull();
    expect(findRemoteImageSrc(undefined)).toBeNull();
  });

  it("detectPastedImages bevorzugt echte Dateien vor einer im Inhalt gefundenen Remote-Grafik", () => {
    const file = new File([new Uint8Array(4)], "shot.png", { type: "image/png" });
    const dt = { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] };
    const editor = buildEditor('# T\n\n<img src="https://example.com/pic.png">');
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    editor.destroy();
    expect(detectPastedImages(dt, slice)).toEqual({ files: [file] });
  });

  it("detectPastedImages liefert { remoteSrc } ohne Datei", () => {
    const editor = buildEditor('# T\n\n<img src="https://example.com/pic.png">');
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    editor.destroy();
    expect(detectPastedImages({}, slice)).toEqual({ remoteSrc: "https://example.com/pic.png" });
  });
});

describe("insertImagesSequentially (echter TipTap-Roundtrip)", () => {
  it("Erfolgspfad: fügt EIN Bild an der Startposition ein – nach unresolveImgs/unescapeMd steht img:<id>, KEIN data: im Dokument", async () => {
    const editor = buildEditor("# T\n\nAbsatz");
    const onAddImage = vi.fn().mockResolvedValue({ id: "abc111", dataUrl: "data:image/png;base64,AAAA" });
    const onError = vi.fn();
    const startPos = editor.state.doc.content.size; // ans Dokumentende
    await insertImagesSequentially(editor, [new File([new Uint8Array(1)], "a.png")], startPos, onAddImage, onError);

    expect(onAddImage).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    let insertedIndent = null;
    editor.state.doc.descendants((n) => { if (n.type.name === "image") insertedIndent = n.attrs.indent; });
    expect(insertedIndent).toBe(0); // neu eingefügte Bilder starten uneingerückt (Auftrag)

    const out = saveLike(editor, { abc111: "data:image/png;base64,AAAA" });
    editor.destroy();
    expect(out).toContain("![](img:abc111)");
    expect(out).not.toContain("data:");
    expect(UNRESOLVED_IMG_RE.test(out)).toBe(false); // Sicherheitsnetz bleibt still
  });

  it("mehrere Bilder gleichzeitig: beide landen NACHEINANDER im Dokument, in Aufruf-Reihenfolge", async () => {
    const editor = buildEditor("# T\n\nAbsatz");
    const calls = [];
    const onAddImage = vi.fn(async (file) => {
      calls.push(file.name);
      return { id: "img" + calls.length, dataUrl: "data:image/png;base64,DATA" + calls.length };
    });
    const onError = vi.fn();
    const files = [
      new File([new Uint8Array(1)], "eins.png", { type: "image/png" }),
      new File([new Uint8Array(1)], "zwei.png", { type: "image/png" }),
    ];
    await insertImagesSequentially(editor, files, editor.state.doc.content.size, onAddImage, onError);

    expect(calls).toEqual(["eins.png", "zwei.png"]); // sequentiell, nicht parallel
    expect(onError).not.toHaveBeenCalled();

    const imgSrcs = [];
    editor.state.doc.descendants((n) => { if (n.type.name === "image") imgSrcs.push(n.attrs.src); });
    expect(imgSrcs).toEqual(["data:image/png;base64,DATA1", "data:image/png;base64,DATA2"]);

    const out = saveLike(editor, { img1: "data:image/png;base64,DATA1", img2: "data:image/png;base64,DATA2" });
    editor.destroy();
    expect(out).toContain("![](img:img1)");
    expect(out).toContain("![](img:img2)");
    expect(out).not.toContain("data:");
    // Reihenfolge im Dokument entspricht der Einfüge-Reihenfolge.
    expect(out.indexOf("img:img1")).toBeLessThan(out.indexOf("img:img2"));
  });

  it("Fehlerpfad (z. B. nicht verbunden/Upload-Fehler): KEIN Bild-Node wird eingefügt, onError bekommt die Meldung, kein halber Zustand", async () => {
    const editor = buildEditor("# T\n\nAbsatz");
    const onAddImage = vi.fn().mockRejectedValue(new Error("Nicht verbunden – ein eingefügtes Bild kann nicht dauerhaft gespeichert werden."));
    const onError = vi.fn();
    const before = editor.storage.markdown.getMarkdown();

    await insertImagesSequentially(editor, [new File([new Uint8Array(1)], "a.png")], editor.state.doc.content.size, onAddImage, onError);

    expect(onError).toHaveBeenCalledWith("Nicht verbunden – ein eingefügtes Bild kann nicht dauerhaft gespeichert werden.");
    let hasImage = false;
    editor.state.doc.descendants((n) => { if (n.type.name === "image") hasImage = true; });
    const after = editor.storage.markdown.getMarkdown();
    editor.destroy();
    expect(hasImage).toBe(false);
    expect(after).toBe(before); // Dokument unverändert – kein halber Zustand
  });

  it("EIN fehlgeschlagenes Bild bricht die übrigen NICHT ab: das zweite wird trotzdem eingefügt", async () => {
    const editor = buildEditor("# T\n\nAbsatz");
    const onAddImage = vi.fn()
      .mockRejectedValueOnce(new Error("Upload fehlgeschlagen"))
      .mockResolvedValueOnce({ id: "ok1", dataUrl: "data:image/png;base64,OK" });
    const onError = vi.fn();
    const files = [
      new File([new Uint8Array(1)], "kaputt.png"),
      new File([new Uint8Array(1)], "gut.png"),
    ];
    await insertImagesSequentially(editor, files, editor.state.doc.content.size, onAddImage, onError);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Upload fehlgeschlagen");
    let count = 0;
    editor.state.doc.descendants((n) => { if (n.type.name === "image") count++; });
    editor.destroy();
    expect(count).toBe(1); // nur das erfolgreiche Bild
  });

  it("ein Fehler ohne .message-Eigenschaft fällt auf eine generische Meldung zurück (kein Absturz)", async () => {
    const editor = buildEditor("# T\n\nAbsatz");
    const onAddImage = vi.fn().mockRejectedValue("kaputt"); // kein Error-Objekt
    const onError = vi.fn();
    await insertImagesSequentially(editor, [new File([new Uint8Array(1)], "a.png")], editor.state.doc.content.size, onAddImage, onError);
    editor.destroy();
    expect(onError).toHaveBeenCalledWith("Bild konnte nicht eingefügt werden");
  });
});

describe("UNRESOLVED_IMG_RE (Sicherheitsnetz in save())", () => {
  it("erkennt eine data:-Bildreferenz (z. B. ohne Verbindung eingefügt und trotzdem im Dokument gelandet)", () => {
    expect(UNRESOLVED_IMG_RE.test("Text\n\n![Alt](data:image/png;base64,AAAA)\n")).toBe(true);
  });
  it("erkennt eine von einer Webseite kopierte https-Bildreferenz", () => {
    expect(UNRESOLVED_IMG_RE.test("![Screenshot](https://example.com/a.png)")).toBe(true);
  });
  it("lässt eine normale img:-Referenz (auch mit Breiten-Suffix) unangetastet", () => {
    expect(UNRESOLVED_IMG_RE.test("![Alt|w320](img:abc123)")).toBe(false);
  });
  it("lässt einen normalen Text-Link (kein Bild) mit https-Ziel unangetastet", () => {
    expect(UNRESOLVED_IMG_RE.test("Siehe [Titel](https://example.org/a) dazu.")).toBe(false);
  });
  it("ignoriert ein '!' das NICHT direkt vor einer Bild-Klammer steht", () => {
    expect(UNRESOLVED_IMG_RE.test("Wow! [Link](https://example.com)")).toBe(false);
  });
  it("bleibt bei einem Dokument ganz ohne Bilder/Links unauffällig", () => {
    expect(UNRESOLVED_IMG_RE.test("# T\n\nGanz normaler Text.")).toBe(false);
  });
});

// BUGFIX (Code-Review vor v7.41-Commit, 🟡 Finding 4): handlePaste/handleDrop
// gaben bei EINEM gefundenen Remote-Bild bisher "true" zurück, OHNE selbst
// etwas einzufügen – der GESAMTE Paste/Drop ging verloren, auch begleitender
// Text. stripRemoteImages entfernt NUR die Remote-Bild-Knoten, der Rest
// bleibt erhalten.
describe("stripRemoteImages (Finding 4)", () => {
  it("entfernt ein Remote-Bild MITTEN in einem kopierten Text-Ausschnitt, behält Text davor UND danach", () => {
    const editor = buildEditor('# T\n\nVorher <img src="https://example.com/a.png"> Nachher');
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    const cleaned = stripRemoteImages(slice);
    let hasImage = false;
    let text = "";
    cleaned.content.forEach((n) => {
      n.descendants((d) => { if (d.type.name === "image") hasImage = true; });
      text += n.textContent;
    });
    editor.destroy();
    expect(hasImage).toBe(false);
    expect(text).toContain("Vorher");
    expect(text).toContain("Nachher");
  });

  it("liefert einen Slice mit content.size 0, wenn NUR das Remote-Bild kopiert wurde (Aufrufer fügt dann nichts ein)", () => {
    const editor = buildEditor('# T\n\n<img src="https://example.com/a.png">');
    // Nur den Bild-Node selbst slicen (ohne die Überschrift).
    let imgPos = null;
    editor.state.doc.descendants((n, p) => { if (n.type.name === "image") imgPos = p; });
    const slice = editor.state.doc.slice(imgPos, imgPos + 1);
    const cleaned = stripRemoteImages(slice);
    editor.destroy();
    expect(cleaned.content.size).toBe(0);
  });

  it("lässt einen Slice OHNE jedes Remote-Bild komplett unverändert (dieselbe Referenz)", () => {
    const editor = buildEditor("# T\n\nGanz normaler Text ohne Bild.");
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    const cleaned = stripRemoteImages(slice);
    editor.destroy();
    expect(cleaned).toBe(slice); // No-op: identische Referenz, kein unnötiger Klon
  });

  it("lässt ein internes Bild mit data:-Quelle unangetastet (kein Remote-Fall)", () => {
    const editor = buildEditor('# T\n\n<img src="data:image/png;base64,AAAA">');
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    const cleaned = stripRemoteImages(slice);
    let hasImage = false;
    cleaned.content.forEach((n) => { if (n.type.name === "image") hasImage = true; });
    editor.destroy();
    expect(hasImage).toBe(true);
  });

  it("entfernt MEHRERE Remote-Bilder aus demselben Ausschnitt", () => {
    const editor = buildEditor(
      '# T\n\nEins <img src="https://example.com/a.png"> Zwei <img src="https://example.com/b.png"> Drei'
    );
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    const cleaned = stripRemoteImages(slice);
    let imageCount = 0;
    let text = "";
    cleaned.content.forEach((n) => {
      n.descendants((d) => { if (d.type.name === "image") imageCount++; });
      text += n.textContent;
    });
    editor.destroy();
    expect(imageCount).toBe(0);
    expect(text).toContain("Eins");
    expect(text).toContain("Zwei");
    expect(text).toContain("Drei");
  });

  it("wirft nie bei leerer/fehlender Slice", () => {
    expect(() => stripRemoteImages(null)).not.toThrow();
    expect(() => stripRemoteImages(undefined)).not.toThrow();
    expect(stripRemoteImages(null)).toBeNull();
  });

  // WICHTIG (beim Testschreiben gefunden): Ein Slice MUSS aus demselben
  // Editor/derselben Schema-INSTANZ stammen wie das Ziel-Dokument, in das er
  // eingefügt wird – zwei per new Editor(...) gebaute Instanzen mit
  // IDENTISCHER Extensions-Konfiguration erzeugen trotzdem ZWEI VERSCHIEDENE
  // Schema-Objekte (jede eigene NodeType-Instanzen); node.type.canReplace(…)
  // vergleicht Objektidentität, ein "fremder" Paragraph-Node passt dadurch
  // NIE in ein Ziel-Schema, selbst wenn der Node-Name identisch ist – ein
  // Test-Artefakt, das im echten Editor nie auftritt (dort stammt der
  // Paste-Slice IMMER aus derselben View/Schema-Instanz, siehe
  // handlePaste/handleDrop, Parameter "view"). Der Test simuliert deshalb
  // realistisch: EIN Editor, der bereits einen "kopierten" Ausschnitt
  // enthält – der wird gesliced, bereinigt und an anderer Stelle in
  // DEMSELBEN Dokument wieder eingefügt (schema-konsistent).
  it("handlePaste-Integration: der bereinigte Slice lässt sich per replaceRange/replaceSelection einfügen und ergibt ein gültiges Dokument ohne das Remote-Bild", () => {
    const editor = buildEditor(
      '# T\n\nZiel-Absatz\n\nKopierter Text <img src="https://example.com/logo.png"> mit Logo'
    );
    let sliceStart = null;
    editor.state.doc.descendants((n, p) => {
      if (sliceStart === null && n.isText && n.text === "Kopierter Text") sliceStart = p - 1;
    });
    const sliceEnd = editor.state.doc.content.size;
    const slice = editor.state.doc.slice(sliceStart, sliceEnd);
    const cleaned = stripRemoteImages(slice);
    // Ersetzt GENAU den Bereich, aus dem der Ausschnitt stammt, durch die
    // bereinigte Fassung – derselbe ReplaceStep-Mechanismus wie
    // "view.dispatch(view.state.tr.replaceSelection(cleaned).scrollIntoView())"
    // in handlePaste, hier über replaceRange mit expliziten Grenzen.
    editor.view.dispatch(editor.state.tr.replaceRange(sliceStart, sliceEnd, cleaned).scrollIntoView());
    const out = saveLike(editor, {});
    editor.destroy();
    expect(out).not.toContain("example.com/logo.png");
    expect(out).toContain("Kopierter Text");
    expect(out).toContain("mit Logo");
    // Der Rest des Dokuments (vor dem ersetzten Bereich) bleibt unangetastet.
    expect(out).toContain("Ziel-Absatz");
  });
});

// Finding 8 (Code-Review vor v7.41-Commit): "pos" konnte nach dem "await"
// außerhalb des inzwischen (durch eine parallele Nutzeraktion) verkürzten
// Dokuments liegen – insertContentAt hätte dann mit einer RangeError
// abstürzen können, OBWOHL der Upload bereits erfolgreich war (Waisen-Datei
// UND verlorenes Bild).
describe("insertImagesSequentially: Positions-Klemmung nach await (Finding 8)", () => {
  it("eine Startposition, die nach dem Upload außerhalb des (verkürzten) Dokuments liegt, stürzt nicht ab und fügt das Bild trotzdem ein", async () => {
    const editor = buildEditor("# T\n\nAbsatz");
    const onAddImage = vi.fn(async () => {
      // Simuliert eine parallele Nutzeraktion WÄHREND des Uploads: der
      // Nutzer löscht Text, das Dokument wird kürzer als "startPos".
      editor.commands.setTextSelection(1);
      editor.commands.deleteRange({ from: 1, to: editor.state.doc.content.size - 1 });
      return { id: "x1", dataUrl: "data:image/png;base64,AAAA" };
    });
    const onError = vi.fn();
    const farBeyondPos = 9999; // garantiert außerhalb nach dem Löschen oben
    await expect(
      insertImagesSequentially(editor, [new File([new Uint8Array(1)], "a.png")], farBeyondPos, onAddImage, onError)
    ).resolves.not.toThrow();
    expect(onError).not.toHaveBeenCalled();
    let hasImage = false;
    editor.state.doc.descendants((n) => { if (n.type.name === "image") hasImage = true; });
    editor.destroy();
    expect(hasImage).toBe(true);
  });
});

// Finding 10 (Code-Review vor v7.41-Commit): accept="image/*" bzw. der
// generische ".startsWith(\"image/\")"-Filter ließen JEDES Bildformat zu,
// auch SVG/AVIF/BMP – extForMime (lib/images.js) kennt diese Formate nicht
// und legt sie fälschlich unter ".png" ab (kaputtes Bild beim nächsten
// Lesen). Direkt-Einfügen ist jetzt auf die vier von extForMime korrekt
// unterstützten Formate beschränkt.
describe("Akzeptierte Bild-MIME-Typen (Finding 10)", () => {
  it("isAcceptedImageType akzeptiert genau png/jpeg/webp/gif", () => {
    expect(isAcceptedImageType("image/png")).toBe(true);
    expect(isAcceptedImageType("image/jpeg")).toBe(true);
    expect(isAcceptedImageType("image/webp")).toBe(true);
    expect(isAcceptedImageType("image/gif")).toBe(true);
  });

  it("isAcceptedImageType lehnt SVG/AVIF/BMP und Nicht-Bild-Typen ab", () => {
    expect(isAcceptedImageType("image/svg+xml")).toBe(false);
    expect(isAcceptedImageType("image/avif")).toBe(false);
    expect(isAcceptedImageType("image/bmp")).toBe(false);
    expect(isAcceptedImageType("text/plain")).toBe(false);
    expect(isAcceptedImageType("")).toBe(false);
    expect(isAcceptedImageType(undefined)).toBe(false);
  });

  it("ACCEPTED_IMAGE_MIME enthält genau die vier von extForMime unterstützten Typen", () => {
    expect(ACCEPTED_IMAGE_MIME.sort()).toEqual(["image/gif", "image/jpeg", "image/png", "image/webp"].sort());
  });

  it("extractImageFiles lehnt eine per Zwischenablage eingefügte SVG-Datei ab (kein false positive)", () => {
    const file = new File([new Uint8Array(4)], "icon.svg", { type: "image/svg+xml" });
    const dt = { items: [{ kind: "file", type: "image/svg+xml", getAsFile: () => file }] };
    expect(extractImageFiles(dt)).toEqual([]);
  });

  it("extractImageFiles lehnt eine per Drag&Drop abgelegte AVIF-Datei ab, akzeptiert aber ein gemischtes PNG daneben", () => {
    const avif = new File([new Uint8Array(1)], "foto.avif", { type: "image/avif" });
    const png = new File([new Uint8Array(1)], "foto.png", { type: "image/png" });
    const dt = { items: [
      { kind: "file", type: "image/avif", getAsFile: () => avif },
      { kind: "file", type: "image/png", getAsFile: () => png },
    ] };
    expect(extractImageFiles(dt)).toEqual([png]);
  });

  it("extractImageFiles fällt bei einer abgelehnten .items-SVG NICHT auf .files zurück (verhindert einen doppelten Fallback-Fehlgriff)", () => {
    // .items liefert NUR die SVG (kein Bild-Treffer) -> fromItems bleibt
    // leer -> der Fallback auf .files greift wie vorgesehen, prüft dort
    // aber ERNEUT isAcceptedImageType (keine Sonderbehandlung nötig).
    const svg = new File([new Uint8Array(1)], "icon.svg", { type: "image/svg+xml" });
    const dt = { items: [{ kind: "file", type: "image/svg+xml", getAsFile: () => svg }], files: [svg] };
    expect(extractImageFiles(dt)).toEqual([]);
  });
});

// Finding 9 (Code-Review vor v7.41-Commit): Vermutung, handlePaste/
// handleDrop würden den "onAddImage"-Prop vom ERSTEN Render dauerhaft
// einfrieren (useEditor() ohne deps-Array), sodass ein Nutzer, der den
// Editor OHNE Verbindung öffnet und sich DANACH verbindet, per Paste/Drop
// weiterhin "nicht verbunden" bekäme. ÜBERRASCHENDES ERGEBNIS beim
// Nachstellen mit einem ECHTEN Paste-Event auf zwei aufeinanderfolgenden
// Renderings derselben Komponente: Das lässt sich NICHT reproduzieren – die
// installierte @tiptap/react-Version (2.27.2) aktualisiert die
// "editorProps" der LEBENDEN View bei JEDEM Render über
// editor.setOptions()/view.setProps() (siehe node_modules/@tiptap/react/
// src/useEditor.ts#EditorInstanceManager.onRender/compareOptions und
// @tiptap/core#Editor.setOptions), weil "editorProps" bei jedem Render ein
// NEUES Objektliteral ist und die Options dadurch als "verschieden" gelten
// – ganz OHNE Ref war "onAddImage" hier bereits aktuell. Der Test bleibt
// als Dokumentation/Absicherung stehen: Er beweist, dass Paste weiterhin
// den AKTUELLEN onAddImage-Wert benutzt (mit ODER ohne die zusätzliche
// Ref in DocEditor.jsx) – ein künftiges tiptap-Upgrade, das dieses
// Refresh-Verhalten ändert, würde hier auffallen.
describe("onAddImage bleibt bei Paste über mehrere Renders aktuell (Finding 9, Ergebnis siehe Bericht)", () => {
  it("ein Paste NACH einem Prop-Wechsel (Re-Render) benutzt den NEUEN onAddImage, nicht den vom ersten Render", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onAddImage1 = vi.fn().mockResolvedValue({ id: "one", dataUrl: "data:image/png;base64,AAA" });
    const onAddImage2 = vi.fn().mockResolvedValue({ id: "two", dataUrl: "data:image/png;base64,BBB" });
    const props = (onAddImage) => ({
      initialDoc: "# T\n\nAbsatz",
      imgMap: {},
      onSave: () => {},
      onCancel: () => {},
      saving: false,
      navWidth: 148,
      autocorrect: undefined,
      onAddImage,
    });

    act(() => { root.render(<DocEditor {...props(onAddImage1)} />); });
    // Re-Render MIT NEUER onAddImage-Prop (simuliert "Nutzer verbindet sich,
    // während der Editor bereits offen ist").
    act(() => { root.render(<DocEditor {...props(onAddImage2)} />); });

    const editable = container.querySelector(".tiptap-doc");
    expect(editable).toBeTruthy();

    const file = new File([new Uint8Array(4)], "shot.png", { type: "image/png" });
    // Minimale DataTransfer-Attrappe – getData() wird von TipTaps eigenem
    // Link-Paste-Plugin VOR unserem handlePaste abgefragt (someProp läuft
    // über ALLE registrierten Plugins), ohne die Stub-Funktion würfe das.
    const dataTransfer = {
      items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      files: [file],
      types: ["Files"],
      getData: () => "",
    };
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", { value: dataTransfer });

    await act(async () => {
      editable.dispatchEvent(pasteEvent);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onAddImage1).not.toHaveBeenCalled();
    expect(onAddImage2).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });
});
