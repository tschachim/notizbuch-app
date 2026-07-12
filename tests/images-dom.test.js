// @vitest-environment jsdom
// FileReader-basierte Helfer brauchen DOM-APIs; Canvas-Funktionen
// (makeNotebookIcon, prepareImage-Verkleinerung) sind in jsdom nicht
// verfügbar und werden über die E2E-Testfälle abgedeckt.
import { describe, it, expect } from "vitest";
import { prepareImage, readAsDataURL } from "../src/lib/images.js";
import { fileToBase64 } from "../src/lib/knowledge.js";
import { b64ToUtf8 } from "../src/lib/github.js";

describe("readAsDataURL / fileToBase64", () => {
  it("liest Dateien als data-URL bzw. reines Base64 (Roundtrip)", async () => {
    const f = new File(["Inhalt äöü"], "t.txt", { type: "text/plain" });
    const dataUrl = await readAsDataURL(f);
    expect(dataUrl).toMatch(/^data:text\/plain;base64,/);
    const b64 = await fileToBase64(f);
    expect(dataUrl.endsWith(b64)).toBe(true);
    expect(b64ToUtf8(b64)).toBe("Inhalt äöü");
  });
});

describe("prepareImage (kleiner Pfad, ohne Canvas)", () => {
  it("gibt kleine Bilder unverändert zurück und übernimmt den MIME-Typ", async () => {
    const f = new File([new Uint8Array(100)], "mini.webp", { type: "image/webp" });
    const { dataUrl, mime } = await prepareImage(f);
    expect(mime).toBe("image/webp");
    expect(dataUrl).toMatch(/^data:image\/webp;base64,/);
  });
  it("fällt bei unbekanntem Typ auf png zurück", async () => {
    const f = new File([new Uint8Array(10)], "roh.bin", { type: "" });
    expect((await prepareImage(f)).mime).toBe("image/png");
  });
});
