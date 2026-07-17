// Link-Provider (v7.9): DevOps/Confluence-Icons + Titel-Ermittlung.
// Node-Umgebung reicht hier aus (vitest.config.js Default) – die einzige
// DOM-abhängige Funktion des Moduls (buildProviderIconDom, für die
// ProseMirror-Widget-Decoration) wird in tests/docEditorLinks.test.jsx
// (jsdom-Override) über den echten Editor-Pfad geprüft, siehe dort.
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  providerFor, parseWorkItemUrl, fetchLinkTitle, sanitizeLinkProviders,
  setLinkProviders, getLinkProviders, providerHasCredentials, cleanupLinkTitle,
  AzureDevOpsIcon, ConfluenceIcon, ProviderIcon,
} from "../src/lib/linkProviders.jsx";
import { serializeState } from "../src/App.jsx";

describe("providerFor", () => {
  it("liefert null ohne jeden Match (unbekannte Domain, keine Konfiguration)", () => {
    expect(providerFor("https://example.org/x", [])).toBeNull();
  });

  it("liefert null für ein Nicht-http(s)-Schema, selbst bei einem theoretisch passenden Präfix", () => {
    const configured = [{ id: "a", type: "custom", name: "A", prefix: "ftp://dev.azure.com/", pat: "" }];
    expect(providerFor("ftp://dev.azure.com/x", configured)).toBeNull();
  });

  it("der eingebaute Azure-DevOps-Provider matcht ohne jede Konfiguration", () => {
    const p = providerFor("https://dev.azure.com/acme/Proj/_workitems/edit/1", []);
    expect(p).not.toBeNull();
    expect(p.type).toBe("azure-devops");
    expect(p.builtin).toBe(true);
  });

  it("Confluence-Host-Muster (*.atlassian.net): eine Team-Subdomain matcht", () => {
    const p = providerFor("https://meinteam.atlassian.net/wiki/spaces/X/pages/1", []);
    expect(p).not.toBeNull();
    expect(p.type).toBe("confluence");
  });

  it("die nackte Domain 'atlassian.net' OHNE Team-Subdomain matcht NICHT", () => {
    expect(providerFor("https://atlassian.net/wiki/spaces/X/pages/1", [])).toBeNull();
  });

  it("Groß/Klein-Schreibung von Schema/Host spielt keine Rolle", () => {
    const p1 = providerFor("HTTPS://DEV.AZURE.COM/acme/Proj/_workitems/edit/1", []);
    expect(p1 && p1.type).toBe("azure-devops");
    const p2 = providerFor("https://MeinTeam.ATLASSIAN.NET/wiki/spaces/X/pages/1", []);
    expect(p2 && p2.type).toBe("confluence");
  });

  it("innerhalb konfigurierter Provider gewinnt der LÄNGSTE Präfix", () => {
    const configured = [
      { id: "kurz", type: "custom", name: "Kurz", prefix: "https://x.example/", icon: "🔵" },
      { id: "lang", type: "custom", name: "Lang", prefix: "https://x.example/team/", icon: "🟢" },
    ];
    const p = providerFor("https://x.example/team/seite", configured);
    expect(p.id).toBe("lang");
  });

  it("ein konfigurierter Provider gewinnt IMMER gegen einen eingebauten – auch bei kürzerem Präfix", () => {
    // "https://dev.azure.com" (ohne Trailing-Slash, 1 Zeichen kürzer als der
    // eingebaute Präfix "https://dev.azure.com/") ist die realistische
    // Hauptmotivation für diese Regel: der Nutzer hinterlegt ein PAT für
    // GENAU den vom eingebauten Provider abgedeckten Dienst.
    const configured = [
      { id: "mit-pat", type: "azure-devops", name: "Mein DevOps", prefix: "https://dev.azure.com", pat: "test-pat" },
    ];
    const p = providerFor("https://dev.azure.com/acme/Proj/_workitems/edit/1", configured);
    expect(p.id).toBe("mit-pat");
  });

  it("ein Provider ohne prefix UND ohne hostPattern (kaputter Eintrag) matcht nie, statt zu werfen", () => {
    // Kann über die öffentliche API (sanitizeLinkProviders) nicht entstehen,
    // ist aber defensiv abgesichert (matchLength()-Fallback) – ein direkt
    // konstruierter Eintrag prüft diesen Pfad ohne Umweg über die Sanitisierung.
    const configured = [{ id: "kaputt", type: "custom", name: "Kaputt" }];
    expect(providerFor("https://example.org/x", configured)).toBeNull();
  });

  it("eine strukturell kaputte URL (new URL() wirft) matcht das Confluence-Host-Muster nicht, statt zu werfen", () => {
    // "https://" ohne Host ist laut WHATWG-URL-Parser ungültig (new URL()
    // wirft) – hostOf() fängt das ab und liefert null, matchLength() damit
    // konsequent -1 statt einer ungefangenen Exception.
    expect(() => providerFor("https://", [])).not.toThrow();
    expect(providerFor("https://", [])).toBeNull();
  });

  it("passt kein konfigurierter Provider, fällt providerFor sauber auf einen passenden eingebauten zurück", () => {
    const configured = [{ id: "a", type: "custom", name: "A", prefix: "https://other.example/", icon: "🔵" }];
    // dev.azure.com matcht hier weiterhin über den eingebauten Provider,
    // NICHT über "a" – zeigt, dass eine Nicht-Übereinstimmung im
    // konfigurierten Zweig sauber auf den eingebauten Zweig zurückfällt.
    const p = providerFor("https://dev.azure.com/acme/Proj/_workitems/edit/1", configured);
    expect(p.type).toBe("azure-devops");
    expect(p.builtin).toBe(true);
  });

  // SICHERHEITS-FIX (Review-Finding 2, 🟡): ein Präfix OHNE abschließenden
  // "/" darf nur an einer sauberen URL-Grenze enden ("/", "?", "#" oder
  // Stringende) – ein reines startsWith() (die alte Implementierung) hätte
  // "https://acme.atlassian.net" (ohne "/") auch gegen
  // "https://acme.atlassian.net.evil.example/…" matchen lassen (Suffix-
  // Angriff auf einen ANDEREN Host). Siehe auch die fetchLinkTitle-
  // Regressionstests weiter unten (dort die Host-Verankerung als
  // eigenständige, zweite Absicherung).
  it("matchLength-Grenzhärtung: ein Präfix ohne '/' matcht 'net/…', aber NICHT 'net.evil.example/…'", () => {
    const configured = [
      { id: "cf", type: "confluence", name: "Confluence", prefix: "https://acme.atlassian.net", pat: "test-pat", email: "user@example.com" },
    ];
    const legit = providerFor("https://acme.atlassian.net/wiki/spaces/X/pages/1", configured);
    expect(legit && legit.id).toBe("cf");

    const spoofed = providerFor("https://acme.atlassian.net.evil.example/wiki/spaces/X/pages/1", configured);
    expect(spoofed).toBeNull();
  });

  it("matchLength-Grenzhärtung: die URL exakt gleich dem Präfix (ohne Rest) matcht noch", () => {
    const configured = [{ id: "cf", type: "custom", name: "X", prefix: "https://acme.example" }];
    expect(providerFor("https://acme.example", configured).id).toBe("cf");
  });

  it("matchLength-Grenzhärtung: ein direkt angehängtes Zeichen ohne Trenner matcht NICHT (z. B. 'x' statt '/x')", () => {
    const configured = [{ id: "cf", type: "custom", name: "X", prefix: "https://acme.example" }];
    expect(providerFor("https://acme.example.evil.test/x", configured)).toBeNull();
  });
});

describe("parseWorkItemUrl", () => {
  it("parst eine gültige Work-Item-URL", () => {
    expect(parseWorkItemUrl("https://dev.azure.com/reasult/Reasult/_workitems/edit/33487")).toEqual({
      org: "reasult", project: "Reasult", id: "33487",
    });
  });

  it("toleriert Query- und Hash-Anhängsel", () => {
    expect(parseWorkItemUrl("https://dev.azure.com/acme/Proj/_workitems/edit/1?x=1")).toEqual({
      org: "acme", project: "Proj", id: "1",
    });
    expect(parseWorkItemUrl("https://dev.azure.com/acme/Proj/_workitems/edit/1#comment")).toEqual({
      org: "acme", project: "Proj", id: "1",
    });
  });

  it("toleriert einen einzelnen Trailing-Slash", () => {
    expect(parseWorkItemUrl("https://dev.azure.com/acme/Proj/_workitems/edit/1/")).toEqual({
      org: "acme", project: "Proj", id: "1",
    });
  });

  it("dekodiert URL-encodete Org/Projekt-Namen (z. B. Leerzeichen)", () => {
    expect(parseWorkItemUrl("https://dev.azure.com/acme/Mein%20Projekt/_workitems/edit/7")).toEqual({
      org: "acme", project: "Mein Projekt", id: "7",
    });
  });

  it("liefert null bei fehlender ID", () => {
    expect(parseWorkItemUrl("https://dev.azure.com/acme/Proj/_workitems/edit/")).toBeNull();
  });

  it("liefert null bei fremdem Pfad (kein _workitems/edit)", () => {
    expect(parseWorkItemUrl("https://dev.azure.com/acme/Proj/_boards/board")).toBeNull();
  });

  it("liefert null bei fremdem Host", () => {
    expect(parseWorkItemUrl("https://example.org/acme/Proj/_workitems/edit/1")).toBeNull();
  });

  it("liefert null bei zusätzlichen Pfadsegmenten nach der ID", () => {
    expect(parseWorkItemUrl("https://dev.azure.com/acme/Proj/_workitems/edit/1/expand")).toBeNull();
  });

  it("liefert null bei kaputter Prozent-Kodierung im Projektnamen, statt zu werfen", () => {
    expect(() =>
      parseWorkItemUrl("https://dev.azure.com/acme/Pro%zzject/_workitems/edit/1")
    ).not.toThrow();
    expect(parseWorkItemUrl("https://dev.azure.com/acme/Pro%zzject/_workitems/edit/1")).toBeNull();
  });
});

describe("providerHasCredentials", () => {
  it("azure-devops: PAT vorhanden -> true, fehlend -> false", () => {
    expect(providerHasCredentials({ type: "azure-devops", pat: "test-pat" })).toBe(true);
    expect(providerHasCredentials({ type: "azure-devops", pat: "" })).toBe(false);
    expect(providerHasCredentials({ type: "azure-devops" })).toBe(false);
  });

  it("confluence: braucht E-Mail UND PAT", () => {
    expect(providerHasCredentials({ type: "confluence", email: "a@b.de", pat: "test-pat" })).toBe(true);
    expect(providerHasCredentials({ type: "confluence", email: "a@b.de", pat: "" })).toBe(false);
    expect(providerHasCredentials({ type: "confluence", email: "", pat: "test-pat" })).toBe(false);
  });

  it("custom: nie Titel-Ermittlung, selbst mit gesetztem PAT/E-Mail", () => {
    expect(providerHasCredentials({ type: "custom", pat: "test-pat", email: "a@b.de" })).toBe(false);
  });

  it("kein Provider (null) -> false", () => {
    expect(providerHasCredentials(null)).toBe(false);
  });
});

describe("cleanupLinkTitle", () => {
  it("lässt einen normalen Titel unverändert", () => {
    expect(cleanupLinkTitle("Bug 42: Login schlägt fehl")).toEqual({ title: "Bug 42: Login schlägt fehl" });
  });
  it("blockiert einen rein numerischen Titel", () => {
    expect(cleanupLinkTitle("2024").error).toMatch(/Quellen-Fußnoten reserviert/);
  });
  it("ersetzt eckige durch runde Klammern", () => {
    expect(cleanupLinkTitle("Bug [DRAFT]")).toEqual({ title: "Bug (DRAFT)" });
  });
  it("lehnt einen leeren Titel ab", () => {
    expect(cleanupLinkTitle("   ").error).toBeDefined();
  });
});

describe("sanitizeLinkProviders", () => {
  it("liefert [] für Nicht-Arrays", () => {
    expect(sanitizeLinkProviders(undefined)).toEqual([]);
    expect(sanitizeLinkProviders(null)).toEqual([]);
    expect(sanitizeLinkProviders("kaputt")).toEqual([]);
  });

  it("filtert Einträge ohne id/name/prefix, mit unbekanntem Typ oder Nicht-http(s)-Präfix", () => {
    const out = sanitizeLinkProviders([
      { id: "1", type: "custom", name: "OK", prefix: "https://ok.example/" },
      { id: "2", type: "unbekannt", name: "X", prefix: "https://x.example/" },
      { id: "3", type: "custom", name: "", prefix: "https://leer-name.example/" },
      { id: "4", type: "custom", name: "Y", prefix: "javascript:alert(1)" },
      { type: "custom", name: "ohne-id", prefix: "https://z.example/" },
      { id: "5", type: "custom", name: "Z", prefix: "" },
      null,
      42,
      "text",
    ]);
    expect(out).toEqual([{ id: "1", type: "custom", name: "OK", prefix: "https://ok.example/", icon: "", pat: "", email: "" }]);
  });

  it("normalisiert die Form (trimmt, ergänzt fehlende Felder, verwirft unbekannte Zusatzfelder)", () => {
    const out = sanitizeLinkProviders([
      { id: " lp1 ".trim(), type: "azure-devops", name: " DevOps ", prefix: " https://dev.azure.com/ ", pat: "test-pat", boese: "sollte-weg" },
    ]);
    expect(out).toEqual([
      { id: "lp1", type: "azure-devops", name: "DevOps", prefix: "https://dev.azure.com/", icon: "", pat: "test-pat", email: "" },
    ]);
    expect(out[0].boese).toBeUndefined();
  });
});

describe("Modul-Registry (setLinkProviders/getLinkProviders)", () => {
  afterEach(() => setLinkProviders([]));

  it("getLinkProviders liefert [] ohne vorherigen setLinkProviders-Aufruf", () => {
    expect(getLinkProviders()).toEqual([]);
  });

  it("setLinkProviders sanitized den übergebenen Stand (Defense-in-Depth)", () => {
    setLinkProviders([
      { id: "ok", type: "custom", name: "OK", prefix: "https://ok.example/" },
      { id: "kaputt", type: "unbekannt", name: "X", prefix: "https://x.example/" },
    ]);
    expect(getLinkProviders()).toEqual([{ id: "ok", type: "custom", name: "OK", prefix: "https://ok.example/", icon: "", pat: "", email: "" }]);
  });
});

/* ---------------- fetchLinkTitle ---------------- */

const AZURE_PROVIDER = { id: "az1", type: "azure-devops", name: "DevOps", prefix: "https://dev.azure.com/", pat: "test-pat" };
const CONFLUENCE_PROVIDER = {
  id: "cf1", type: "confluence", name: "Confluence", prefix: "https://acme.atlassian.net/",
  pat: "test-token", email: "user@example.com",
};
const AZURE_URL = "https://dev.azure.com/acme/Proj/_workitems/edit/33487";
const CONFLUENCE_URL = "https://acme.atlassian.net/wiki/spaces/TEAM/pages/123456/Titel";

const jsonResponse = (body, ok = true, status = 200) => ({
  ok, status, json: async () => body,
});

describe("fetchLinkTitle: Azure DevOps", () => {
  it("Erfolg: Titel im Format '{WorkItemType} {id}: {System.Title}'", async () => {
    const fetchImpl = async (url, init) => {
      expect(url).toContain("/acme/Proj/_apis/wit/workitems/33487");
      expect(url).toContain("api-version=7.1");
      expect(init.headers.Authorization).toMatch(/^Basic /);
      return jsonResponse({ fields: { "System.Title": "Sales receivables falsch", "System.WorkItemType": "Bug" } });
    };
    const res = await fetchLinkTitle(AZURE_URL, AZURE_PROVIDER, { fetchImpl });
    expect(res).toEqual({ ok: true, title: "Bug 33487: Sales receivables falsch" });
  });

  it("Titel mit '[' '/' rein numerischer Rohwert wird via cleanupLinkTitle bereinigt/abgelehnt", async () => {
    const fetchImpl = async () =>
      jsonResponse({ fields: { "System.Title": "Fix [Login] Bug", "System.WorkItemType": "Bug" } });
    const res = await fetchLinkTitle(AZURE_URL, AZURE_PROVIDER, { fetchImpl });
    expect(res).toEqual({ ok: true, title: "Bug 33487: Fix (Login) Bug" });
  });

  // Statusbasiertes Fehler-Mapping: siehe eigener Block "fetchLinkTitle:
  // Azure DevOps – Auth-Fehler-Mapping" weiter unten (Auftrag v7.12 Teil A,
  // löst die frühere generische "Status 401."-reason durch klare deutsche
  // Auth-Meldungen ab, siehe DECISIONS #58).

  it("ein Netzwerk-/CORS-Fehler (TypeError) wird sauber zu einer verständlichen reason, wirft NICHT", async () => {
    const fetchImpl = async () => { throw new TypeError("Failed to fetch"); };
    const res = await fetchLinkTitle(AZURE_URL, AZURE_PROVIDER, { fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Netzwerk\/CORS/);
  });

  it("ein Timeout bricht über AbortController ab und liefert eine Timeout-reason", async () => {
    const fetchImpl = (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const res = await fetchLinkTitle(AZURE_URL, AZURE_PROVIDER, { fetchImpl, timeoutMs: 20 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Zeitüberschreitung/);
  });

  it("eine URL, die nicht zum Work-Item-Muster passt, wird ohne Netzzugriff abgelehnt", async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return jsonResponse({}); };
    const res = await fetchLinkTitle("https://dev.azure.com/acme/Proj/_boards/board", AZURE_PROVIDER, { fetchImpl });
    expect(res.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("eine kaputte (nicht als JSON lesbare) Erfolgsantwort wird sauber abgefangen, statt zu werfen", async () => {
    const fetchImpl = async () => ({
      ok: true, status: 200,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    });
    const res = await fetchLinkTitle(AZURE_URL, AZURE_PROVIDER, { fetchImpl });
    expect(res).toEqual({ ok: false, reason: "Antwort von Azure DevOps konnte nicht gelesen werden." });
  });
});

// Auftrag v7.12 Teil A (DevOps-302-Maskierung, empirisch gegen dev.azure.com
// verifiziert, siehe DECISIONS #58): OHNE gültige Auth antwortet die Azure-
// DevOps-API nicht mit 401, sondern mit einem 302-Redirect zur Login-Seite,
// deren fehlende CORS-Header den Browser-fetch als nichtssagendes TypeError
// scheitern lassen ("Netzwerk/CORS-Fehler" statt einer Auth-Meldung). Fix:
// X-TFS-FedAuthRedirect:Suppress-Header (lässt die API sauber 401 liefern)
// + redirect:"manual" (Gürtel+Hosenträger: eine evtl. trotzdem auftretende
// Redirect-Response wird als opaqueredirect erkannt, nicht als Netzwerkfehler
// missgedeutet). Reason-Texte sind jetzt statuscode-spezifisch UND enthalten
// nie das PAT/den Authorization-Header.
describe("fetchLinkTitle: Azure DevOps – Auth-Fehler-Mapping (DevOps-302-Maskierung, v7.12 Teil A)", () => {
  it("sendet den X-TFS-FedAuthRedirect:Suppress-Header UND redirect:'manual' bei JEDER Anfrage", async () => {
    let seenInit = null;
    const fetchImpl = async (url, init) => { seenInit = init; return jsonResponse({ fields: {} }); };
    await fetchLinkTitle(AZURE_URL, AZURE_PROVIDER, { fetchImpl });
    expect(seenInit.headers["X-TFS-FedAuthRedirect"]).toBe("Suppress");
    expect(seenInit.redirect).toBe("manual");
    // Der Authorization-Header bleibt daneben unverändert bestehen (Fix darf
    // die bestehende Auth nicht verdrängen).
    expect(seenInit.headers.Authorization).toMatch(/^Basic /);
  });

  it("401 -> klare Auth-Meldung MIT Organisationsname, OHNE den PAT-Wert zu nennen", async () => {
    const res = await fetchLinkTitle(AZURE_URL, AZURE_PROVIDER, {
      fetchImpl: async () => jsonResponse({}, false, 401),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("PAT ungültig oder abgelaufen, oder PAT gehört nicht zur Organisation ‚acme‘.");
    expect(res.reason).not.toContain(AZURE_PROVIDER.pat);
  });

  it("403 -> Scope-/Richtlinien-Hinweis", async () => {
    const res = await fetchLinkTitle(AZURE_URL, AZURE_PROVIDER, {
      fetchImpl: async () => jsonResponse({}, false, 403),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe(
      "PAT-Berechtigung fehlt (Scope ‚Work Items: Read‘) oder Organisations-Richtlinie blockiert PAT-Zugriff."
    );
  });

  it("404 -> 'Work Item {id} nicht gefunden.'", async () => {
    const res = await fetchLinkTitle(AZURE_URL, AZURE_PROVIDER, {
      fetchImpl: async () => jsonResponse({}, false, 404),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("Work Item 33487 nicht gefunden.");
  });

  it("opaqueredirect (redirect:'manual' greift, KEIN sichtbarer Statuscode) wird wie 401 behandelt", async () => {
    // Simuliert exakt das Browser-Verhalten bei redirect:"manual", wenn die
    // API TROTZ Suppress-Header mit dem 302 zur Login-Seite antwortet: die
    // resultierende Response hat status 0 und type "opaqueredirect", KEIN
    // regulärer 401-Statuscode ist sichtbar.
    const fetchImpl = async () => ({ ok: false, status: 0, type: "opaqueredirect" });
    const res = await fetchLinkTitle(AZURE_URL, AZURE_PROVIDER, { fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("PAT ungültig oder abgelaufen, oder PAT gehört nicht zur Organisation ‚acme‘.");
  });

  it("ein sonstiger Statuscode fällt weiterhin auf eine generische, statusbasierte reason zurück", async () => {
    const res = await fetchLinkTitle(AZURE_URL, AZURE_PROVIDER, {
      fetchImpl: async () => jsonResponse({}, false, 500),
    });
    expect(res.reason).toBe("Azure DevOps antwortete mit Status 500.");
  });

  // Regressionstest: die Host-Verankerung/Sicherheitsfixe aus v7.9
  // (DECISIONS #56) dürfen durch die Header-/redirect-Änderung nicht
  // betroffen sein – ein Erfolgsfall bleibt unverändert funktionsfähig.
  it("Regression: ein regulärer Erfolgsfall funktioniert unverändert (Host-Verankerung/Format bleiben stabil)", async () => {
    const fetchImpl = async (url) => {
      expect(url).toContain("/acme/Proj/_apis/wit/workitems/33487");
      return jsonResponse({ fields: { "System.Title": "Login schlägt fehl", "System.WorkItemType": "Bug" } });
    };
    const res = await fetchLinkTitle(AZURE_URL, AZURE_PROVIDER, { fetchImpl });
    expect(res).toEqual({ ok: true, title: "Bug 33487: Login schlägt fehl" });
  });
});

describe("fetchLinkTitle: Confluence", () => {
  it("Erfolg: Titel aus dem 'title'-Feld der Content-API", async () => {
    const fetchImpl = async (url, init) => {
      expect(url).toBe("https://acme.atlassian.net/wiki/rest/api/content/123456");
      expect(init.headers.Authorization).toMatch(/^Basic /);
      return jsonResponse({ title: "Team-Handbuch" });
    };
    const res = await fetchLinkTitle(CONFLUENCE_URL, CONFLUENCE_PROVIDER, { fetchImpl });
    expect(res).toEqual({ ok: true, title: "Team-Handbuch" });
  });

  it("ein rein numerischer Seitentitel wird von cleanupLinkTitle abgelehnt (Fußnoten-Kollision)", async () => {
    const fetchImpl = async () => jsonResponse({ title: "2024" });
    const res = await fetchLinkTitle(CONFLUENCE_URL, CONFLUENCE_PROVIDER, { fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Quellen-Fußnoten reserviert/);
  });

  it("CORS-Fall (TypeError) liefert dieselbe verständliche reason wie bei Azure DevOps", async () => {
    const fetchImpl = async () => { throw new TypeError("Failed to fetch"); };
    const res = await fetchLinkTitle(CONFLUENCE_URL, CONFLUENCE_PROVIDER, { fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Netzwerk\/CORS/);
  });

  it("eine URL, die nicht zum Confluence-Seiten-Muster passt, wird ohne Netzzugriff abgelehnt", async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return jsonResponse({}); };
    const res = await fetchLinkTitle("https://acme.atlassian.net/wiki/overview", CONFLUENCE_PROVIDER, { fetchImpl });
    expect(res.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("eine kaputte (nicht als JSON lesbare) Erfolgsantwort wird sauber abgefangen, statt zu werfen", async () => {
    const fetchImpl = async () => ({
      ok: true, status: 200,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    });
    const res = await fetchLinkTitle(CONFLUENCE_URL, CONFLUENCE_PROVIDER, { fetchImpl });
    expect(res).toEqual({ ok: false, reason: "Antwort von Confluence konnte nicht gelesen werden." });
  });
});

// SICHERHEITS-REGRESSIONSTEST (Review-Finding 1, 🔴 – Fix: Host-Verankerung
// in fetchLinkTitle) + Finding 3 (🟡 – Fix: sanitizeLinkProviders verlangt
// einen echten Host im Präfix). fetchLinkTitle baute die Confluence-API-URL
// UND den Basic-Auth-Header bisher aus dem Host der eingegebenen Link-URL
// (cm[1]) statt aus dem Host des KONFIGURIERTEN Providers – jede
// */wiki/spaces/*/pages/*-URL (auch auf einem fremden Host) hätte damit das
// Confluence-PAT/die E-Mail dorthin geschickt. Diese Tests rufen
// fetchLinkTitle DIREKT mit einer bewusst nicht zum Provider passenden URL
// auf (unabhängig davon, ob providerFor so ein Paar überhaupt geliefert
// hätte) – die interne Host-Prüfung muss als Defense-in-Depth GENAUSO
// greifen, egal woher provider+url stammen.
describe("Sicherheit: Confluence-Credentials gehen NUR an den Host des konfigurierten Providers (Review-Fix)", () => {
  it("eine Link-URL auf einem FREMDEN Host (Suffix-Angriff) wird abgelehnt, OHNE fetchImpl je aufzurufen", async () => {
    const provider = {
      id: "cf", type: "confluence", name: "Confluence",
      prefix: "https://acme.atlassian.net/", pat: "test-token", email: "user@example.com",
    };
    const fetchImpl = vi.fn(async () => jsonResponse({ title: "Sollte nie ankommen" }));
    const res = await fetchLinkTitle(
      "https://acme.atlassian.net.evil.example/wiki/spaces/X/pages/1",
      provider,
      { fetchImpl }
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Host passt nicht/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ein (per Direktkonstruktion möglicher) Provider mit hostlosem Präfix 'https://' fetcht ebenfalls nie", async () => {
    // Simuliert einen Alt-/Fremd-Zustand, den sanitizeLinkProviders inzwischen
    // gar nicht mehr ins localStorage lässt (Finding 3) – die Host-Prüfung in
    // fetchLinkTitle selbst darf sich darauf trotzdem nicht verlassen.
    const provider = {
      id: "cf", type: "confluence", name: "Confluence",
      prefix: "https://", pat: "test-token", email: "user@example.com",
    };
    const fetchImpl = vi.fn(async () => jsonResponse({ title: "Sollte nie ankommen" }));
    const res = await fetchLinkTitle(
      "https://irgendein-fremder-host.example/wiki/spaces/X/pages/1",
      provider,
      { fetchImpl }
    );
    expect(res.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Positiv-Kontrolle: eine legitime URL UNTER dem konfigurierten Host funktioniert weiterhin", async () => {
    const provider = {
      id: "cf", type: "confluence", name: "Confluence",
      prefix: "https://acme.atlassian.net/", pat: "test-token", email: "user@example.com",
    };
    const fetchImpl = vi.fn(async () => jsonResponse({ title: "Team-Handbuch" }));
    const res = await fetchLinkTitle("https://acme.atlassian.net/wiki/spaces/X/pages/1", provider, { fetchImpl });
    expect(res).toEqual({ ok: true, title: "Team-Handbuch" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sanitizeLinkProviders lässt ein hostloses Präfix ('https://' allein) erst gar nicht in die Registry (Finding 3)", () => {
    expect(
      sanitizeLinkProviders([
        { id: "cf", type: "confluence", name: "Confluence", prefix: "https://", pat: "test-token", email: "user@example.com" },
      ])
    ).toEqual([]);
  });

  it("sanitizeLinkProviders verlangt einen Host MIT Punkt auch für custom-Provider (Finding 3, gilt für ALLE Typen)", () => {
    expect(
      sanitizeLinkProviders([{ id: "c", type: "custom", name: "Kaputt", prefix: "https://localhost/" }])
    ).toEqual([]);
    expect(
      sanitizeLinkProviders([{ id: "c", type: "custom", name: "OK", prefix: "https://intranet.example/" }])
    ).toEqual([{ id: "c", type: "custom", name: "OK", prefix: "https://intranet.example/", icon: "", pat: "", email: "" }]);
  });
});

// basicAuthHeader (intern) fällt auf Buffer.from(...) zurück, wenn kein
// globales btoa existiert (Node-Testumgebungen VOR der globalen btoa/atob-
// Einführung; jsdom/Browser haben es immer). vi.stubGlobal simuliert diesen
// Fall gezielt, ohne die restlichen fetchLinkTitle-Tests zu beeinflussen.
describe("fetchLinkTitle: Basic-Auth-Header ohne globales btoa (Node-Fallback)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("nutzt Buffer.from(...).toString('base64') als Fallback und liefert denselben Wert wie btoa", async () => {
    vi.stubGlobal("btoa", undefined);
    let authHeader = null;
    const fetchImpl = async (url, init) => {
      authHeader = init.headers.Authorization;
      return jsonResponse({ fields: { "System.Title": "T", "System.WorkItemType": "Bug" } });
    };
    const res = await fetchLinkTitle(AZURE_URL, AZURE_PROVIDER, { fetchImpl });
    expect(res.ok).toBe(true);
    expect(authHeader).toBe("Basic " + Buffer.from(":" + AZURE_PROVIDER.pat, "binary").toString("base64"));
  });
});

describe("fetchLinkTitle: ohne Zugangsdaten / custom-Provider", () => {
  it("custom-Provider (kein bekanntes API) liefert immer eine klare Ablehnung, ohne fetchImpl aufzurufen", async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return jsonResponse({}); };
    const res = await fetchLinkTitle("https://intranet.example/x", { type: "custom", pat: "test-pat" }, { fetchImpl });
    expect(res).toEqual({ ok: false, reason: "Kein Provider mit Zugangsdaten für diese URL." });
    expect(called).toBe(false);
  });

  it("Azure-DevOps-Provider ohne PAT liefert dieselbe Ablehnung", async () => {
    const res = await fetchLinkTitle(AZURE_URL, { type: "azure-devops", pat: "" }, { fetchImpl: async () => jsonResponse({}) });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Zugangsdaten/);
  });

  it("kein Provider (null)", async () => {
    const res = await fetchLinkTitle(AZURE_URL, null, { fetchImpl: async () => jsonResponse({}) });
    expect(res.ok).toBe(false);
  });
});

/* ---------------- Icons (Viewer-Komponenten) ---------------- */

describe("Icon-Komponenten (AzureDevOpsIcon/ConfluenceIcon/ProviderIcon)", () => {
  it("AzureDevOpsIcon rendert ein aria-hidden SVG in Markenfarbe", () => {
    const html = renderToStaticMarkup(<AzureDevOpsIcon />);
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("#0078D4");
  });

  it("ConfluenceIcon rendert ein aria-hidden SVG in Markenfarbe", () => {
    const html = renderToStaticMarkup(<ConfluenceIcon />);
    expect(html).toContain("<svg");
    expect(html).toContain("#2684FF");
  });

  it("ProviderIcon wählt anhand des Typs die passende Komponente bzw. das Emoji", () => {
    const devopsHtml = renderToStaticMarkup(<ProviderIcon provider={{ type: "azure-devops" }} />);
    expect(devopsHtml).toContain("<svg");
    const confluenceHtml = renderToStaticMarkup(<ProviderIcon provider={{ type: "confluence" }} />);
    expect(confluenceHtml).toContain("<svg");
    const customHtml = renderToStaticMarkup(<ProviderIcon provider={{ type: "custom", icon: "🏠" }} />);
    expect(customHtml).not.toContain("<svg");
    expect(customHtml).toContain("🏠");
    const customFallbackHtml = renderToStaticMarkup(<ProviderIcon provider={{ type: "custom", icon: "" }} />);
    expect(customFallbackHtml).toContain("🔗");
  });

  it("ProviderIcon liefert nichts für 'kein Provider'", () => {
    expect(renderToStaticMarkup(<ProviderIcon provider={null} />)).toBe("");
  });
});

/* ---------------- Sicherheit (Sicherheitsregel 1 aus dem Auftrag) ---------------- */

describe("Sicherheit: Provider-Zugangsdaten landen NIE in serializeState (App.jsx)", () => {
  afterEach(() => setLinkProviders([]));

  it("ein realitätsnah befüllter Zustand (Chat/Quicknotes/Collapsed) enthält den PAT-Wert eines konfigurierten Providers nicht", () => {
    // Platzhalter-Werte (KEINE echten Tokens, siehe Auftrags-Sicherheitsregel 3).
    const azurePat = "test-pat-9F8e7D6c5B4a";
    const confluenceToken = "test-token-Zz11Yy22Xx33";
    const configured = [
      { id: "lp-az", type: "azure-devops", name: "Azure DevOps", prefix: "https://dev.azure.com/", icon: "", pat: azurePat, email: "" },
      { id: "lp-cf", type: "confluence", name: "Confluence", prefix: "https://acme.atlassian.net/", icon: "", pat: confluenceToken, email: "user@example.com" },
    ];
    // Simuliert, was App.jsx beim Settings-Load/-Save tut – die Registry
    // ist real befüllt, GENAU wie im Betrieb.
    setLinkProviders(configured);
    expect(getLinkProviders()[0].pat).toBe(azurePat); // Gegenprobe: Registry ist wirklich befüllt

    const chat = [
      { role: "assistant", ts: 0, text: "Hallo!" },
      { role: "user", ts: 1, text: "Notiere das Azure-Ticket https://dev.azure.com/acme/Proj/_workitems/edit/1 bitte." },
      { role: "assistant", ts: 2, text: "Erledigt, im Dokument abgelegt." },
    ];
    const quicknotes = { wissensbasis: [{ id: "q1", text: "Erinnerung: Deploy Freitag", x: 10, y: 10, w: 200, h: 100 }] };
    const collapsedAll = { wissensbasis: { "s:Inbox": true } };

    const payload = serializeState(chat, "sonnet-5", collapsedAll, "wissensbasis", ["wissensbasis"], quicknotes);

    expect(payload).not.toContain(azurePat);
    expect(payload).not.toContain(confluenceToken);
    // Strukturelle Absicherung: serializeState nimmt "settings"/"linkProviders"
    // gar nicht als Parameter entgegen (siehe Kommentar in App.jsx) – der
    // Schlüssel taucht im Payload also grundsätzlich nicht auf.
    expect(payload).not.toContain("linkProviders");
    expect(JSON.parse(payload)).not.toHaveProperty("linkProviders");
  });
});
