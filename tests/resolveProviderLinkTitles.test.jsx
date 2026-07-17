// resolveProviderLinkTitles (v7.12 Teil B, Auftrag "automatische
// Titel-Ermittlung überall") – eigene Datei (statt eine weitere Erweiterung
// von tests/linkProviders.test.jsx), da der Testumfang für dieses eine
// Feature groß genug ist, um separat übersichtlich zu bleiben. Node-Umgebung
// reicht (vitest.config.js Default) – die Funktion selbst ist reines
// Modul-Level-JS ohne DOM-Abhängigkeit.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  resolveProviderLinkTitles, setLinkProviders, providerHasCredentials,
  BRACKETED_URL_SRC, NAKED_URL_SRC,
} from "../src/lib/linkProviders.jsx";
// Grammatik-Drift-Pin (Review-Fix 🟡, vor dem Commit gemeldet): dieses Modul
// importiert bewusst BEIDE Blätter (linkProviders.jsx UND markdown.jsx) –
// ein Testfile darf das, ohne selbst Teil eines Laufzeit-Zirkels zu werden;
// zirkelgefährdet wäre nur ein Import IN eine der beiden Richtungen
// zwischen linkProviders.jsx und markdown.jsx selbst (siehe Kopfkommentare
// dort). Die eigentlichen URL-Grammatiken sind dupliziert (Zirkelbezug
// verhindert einen direkten Import), dieser Test pinnt sie GEGENEINANDER,
// damit eine künftige Änderung an der EINEN Stelle nicht unbemerkt von der
// anderen abweicht.
import { LINK_URL_RE, BARE_URL_INLINE_SRC } from "../src/lib/markdown.jsx";

afterEach(() => setLinkProviders([]));

const AZURE_PROVIDER = {
  id: "az1", type: "azure-devops", name: "DevOps", prefix: "https://dev.azure.com/", pat: "test-pat",
};
const CUSTOM_PROVIDER_NO_CREDS = {
  id: "c1", type: "custom", name: "Intranet", prefix: "https://intranet.example/", icon: "🏠",
};

const workItemUrl = (id) => "https://dev.azure.com/acme/Proj/_workitems/edit/" + id;

const jsonResponse = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

// Antwortet für jede Azure-DevOps-Work-Item-URL mit einem Titel, der die
// angefragte ID enthält (leicht prüfbar, welche URL tatsächlich gefetcht
// wurde) – zählt zugleich die Aufrufe je URL (Dedupe-Nachweis).
function makeCountingFetchImpl() {
  const calls = new Map(); // url -> Anzahl
  const fetchImpl = vi.fn(async (url) => {
    calls.set(url, (calls.get(url) || 0) + 1);
    const m = /_apis\/wit\/workitems\/(\d+)/.exec(url);
    return jsonResponse({ fields: { "System.Title": "Titel " + m[1], "System.WorkItemType": "Bug" } });
  });
  return { fetchImpl, calls };
}

describe("Grammatik-Drift-Pin: linkProviders.jsx-Duplikate == markdown.jsx-Original (Review-Fix)", () => {
  it("BRACKETED_URL_SRC ist byte-identisch zu LINK_URL_RE.source (markdown.jsx)", () => {
    expect(BRACKETED_URL_SRC).toBe(LINK_URL_RE.source);
  });

  it("NAKED_URL_SRC ist byte-identisch zu BARE_URL_INLINE_SRC (markdown.jsx, Bare-URL-Alternative aus INLINE_TOKEN_RE)", () => {
    expect(NAKED_URL_SRC).toBe(BARE_URL_INLINE_SRC);
  });
});

describe("resolveProviderLinkTitles: schneller No-op ohne Provider/Zugangsdaten", () => {
  it("ohne jeden konfigurierten Provider bleibt die Eingabe byte-identisch UND fetchImpl wird nie gerufen", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ fields: {} }));
    const md = "Siehe https://dev.azure.com/acme/Proj/_workitems/edit/1 dazu.";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe(md);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ein konfigurierter Provider OHNE Zugangsdaten (custom) verhält sich ebenfalls als No-op", async () => {
    setLinkProviders([CUSTOM_PROVIDER_NO_CREDS]);
    expect(providerHasCredentials(CUSTOM_PROVIDER_NO_CREDS)).toBe(false);
    const fetchImpl = vi.fn(async () => jsonResponse({ fields: {} }));
    const md = "Link: https://intranet.example/x und https://dev.azure.com/acme/Proj/_workitems/edit/1";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe(md);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("leerer/undefinierter Input liefert unverändert zurück, ohne zu werfen", async () => {
    expect(await resolveProviderLinkTitles("")).toBe("");
    expect(await resolveProviderLinkTitles(undefined)).toBe("");
    expect(await resolveProviderLinkTitles(null)).toBe("");
  });

  // WICHTIG: moderne Node-Versionen (>=18) haben ein GLOBALES fetch – ohne
  // vi.stubGlobal würde dieser Test bei fehlendem fetchImpl also einen
  // ECHTEN Netzwerk-Request an dev.azure.com auslösen (gefunden beim
  // Schreiben dieses Tests: die erste Fassung überließ fetch dem globalen
  // Node-fetch und "bestand" nur zufällig, weil der Request in der
  // Sandbox fehlschlug – kein deterministischer Test). vi.stubGlobal
  // deaktiviert das globale fetch gezielt für diesen einen Test.
  it("kein fetchImpl verfügbar UND kein globales fetch -> No-op trotz konfiguriertem Provider, ohne echten Netzzugriff", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    vi.stubGlobal("fetch", undefined);
    try {
      const md = "https://dev.azure.com/acme/Proj/_workitems/edit/1";
      const out = await resolveProviderLinkTitles(md, {});
      expect(out).toBe(md);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("resolveProviderLinkTitles: die drei Ersetzungsformen", () => {
  it("(a) eine nackte http(s)-URL wird zu [Titel](url)", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const { fetchImpl } = makeCountingFetchImpl();
    const md = "Siehe " + workItemUrl(1) + " dazu.";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe("Siehe [Bug 1: Titel 1](" + workItemUrl(1) + ") dazu.");
  });

  it("(b) ein <url>-Autolink wird zu [Titel](url)", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const { fetchImpl } = makeCountingFetchImpl();
    const md = "Ticket: <" + workItemUrl(2) + ">";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe("Ticket: [Bug 2: Titel 2](" + workItemUrl(2) + ")");
  });

  it("(c) [Titel](url) MIT Titel===URL wird zu [Titel](url) mit dem ermittelten Titel", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const { fetchImpl } = makeCountingFetchImpl();
    const md = "[" + workItemUrl(3) + "](" + workItemUrl(3) + ")";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe("[Bug 3: Titel 3](" + workItemUrl(3) + ")");
  });
});

describe("resolveProviderLinkTitles: NIE anfassen", () => {
  it("eine Quellen-Fußnote [n](url) mit rein numerischem Titel bleibt unangetastet", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const fetchImpl = vi.fn(async () => jsonResponse({ fields: {} }));
    const md = "Fakt[3](" + workItemUrl(1) + ") hier.";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe(md);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("[Titel](url) mit einem ECHTEN (nicht der URL entsprechenden) Titel bleibt unangetastet", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const fetchImpl = vi.fn(async () => jsonResponse({ fields: {} }));
    const md = "[Mein Ticket](" + workItemUrl(1) + ")";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe(md);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Inhalt innerhalb eines Fenced-Codeblocks bleibt byte-genau erhalten", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const fetchImpl = vi.fn(async () => jsonResponse({ fields: {} }));
    const md = "Text davor.\n\n```\n" + workItemUrl(1) + "\n```\n\nText danach.";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe(md);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Inhalt innerhalb eines Codespans (`...`) bleibt byte-genau erhalten", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const fetchImpl = vi.fn(async () => jsonResponse({ fields: {} }));
    const md = "Siehe `" + workItemUrl(1) + "` im Code.";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe(md);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("eine nackte URL AUSSERHALB eines Codeblocks wird aufgelöst, obwohl dieselbe URL auch im Codeblock steht", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const { fetchImpl } = makeCountingFetchImpl();
    const md = "Vorher " + workItemUrl(9) + ".\n\n```\n" + workItemUrl(9) + "\n```";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe("Vorher [Bug 9: Titel 9](" + workItemUrl(9) + ").\n\n```\n" + workItemUrl(9) + "\n```");
  });

  it("![Alt](url)-Bildsyntax bleibt unangetastet, selbst mit einer sonst auflösbaren URL", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const fetchImpl = vi.fn(async () => jsonResponse({ fields: {} }));
    const md = "![Screenshot](" + workItemUrl(1) + ")";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe(md);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("eine img:-Bildreferenz (lokal, kein http-Ziel) bleibt unangetastet", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const fetchImpl = vi.fn(async () => jsonResponse({ fields: {} }));
    const md = "![Notiz](img:abc123)";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe(md);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("resolveProviderLinkTitles: Fetch-Fehler lassen das Original unangetastet", () => {
  it("ein 404 lässt die Fundstelle byte-genau unverändert (still, kein Fehlertext im Dokument)", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 404));
    const md = "Ungültig: " + workItemUrl(404) + " hier.";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe(md);
  });

  it("ein Netzwerk-/CORS-Fehler (TypeError) lässt die Fundstelle ebenfalls unverändert", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const fetchImpl = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const md = workItemUrl(1);
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe(md);
  });
});

describe("resolveProviderLinkTitles: URL-Dedupe", () => {
  it("dieselbe URL zweimal im Dokument löst nur EINEN fetchLinkTitle-Aufruf aus, ersetzt aber BEIDE Fundstellen", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const { fetchImpl, calls } = makeCountingFetchImpl();
    const url = workItemUrl(7);
    const md = "Erste: " + url + "\nZweite: " + url;
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe("Erste: [Bug 7: Titel 7](" + url + ")\nZweite: [Bug 7: Titel 7](" + url + ")");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Genau EINE distinkte API-URL wurde genau einmal angefragt (Cache
    // pro Aufruf) – calls ist von makeCountingFetchImpl nach der
    // tatsächlich gefetchten API-URL (nicht der Link-URL im Dokument) geführt.
    expect(calls.size).toBe(1);
    expect([...calls.values()]).toEqual([1]);
  });
});

describe("resolveProviderLinkTitles: maxLinks-Deckel", () => {
  it("nur die ersten maxLinks (Default 5) Fundstellen werden aufgelöst, der Rest bleibt URL", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const { fetchImpl } = makeCountingFetchImpl();
    const urls = [1, 2, 3, 4, 5, 6].map(workItemUrl);
    const md = urls.join("\n");
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    const lines = out.split("\n");
    expect(lines).toHaveLength(6);
    for (let i = 0; i < 5; i++) expect(lines[i]).toBe("[Bug " + (i + 1) + ": Titel " + (i + 1) + "](" + urls[i] + ")");
    expect(lines[5]).toBe(urls[5]); // 6. Link bleibt unangetastet
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("ein expliziter maxLinks-Wert überschreibt den Default", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const { fetchImpl } = makeCountingFetchImpl();
    const urls = [1, 2, 3].map(workItemUrl);
    const md = urls.join("\n");
    const out = await resolveProviderLinkTitles(md, { fetchImpl, maxLinks: 1 });
    const lines = out.split("\n");
    expect(lines[0]).toBe("[Bug 1: Titel 1](" + urls[0] + ")");
    expect(lines[1]).toBe(urls[1]);
    expect(lines[2]).toBe(urls[2]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // REGRESSIONSTEST (Review-Fix 🟡 "maxLinks-Aushungerung", vor dem Commit
  // gemeldet): empirisch belegtes Szenario aus dem Review – mehrere
  // provider-fremde URLs (hier example.org, kein konfigurierter Provider)
  // VOR einem echten, auflösbaren Provider-Link durften den maxLinks-Deckel
  // NICHT mehr erschöpfen, bevor der DevOps-Link überhaupt geprüft wurde.
  // Seit dem Fix zählt nur eine Fundstelle MIT Provider-Match+Zugangsdaten
  // gegen den Deckel (siehe scanChunkForProviderLinks).
  it("5 provider-fremde URLs VOR einem echten DevOps-Link erschöpfen den Deckel NICHT mehr – der DevOps-Link wird aufgelöst", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const { fetchImpl } = makeCountingFetchImpl();
    const foreignUrls = [1, 2, 3, 4, 5].map((i) => "https://example.org/artikel-" + i);
    const url = workItemUrl(42);
    const md = foreignUrls.join("\n") + "\n" + url;
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    const lines = out.split("\n");
    // Alle fünf Fremd-URLs bleiben unangetastet (kein Provider-Match).
    for (let i = 0; i < 5; i++) expect(lines[i]).toBe(foreignUrls[i]);
    // Der DevOps-Link (6. Zeile) WIRD aufgelöst – vor dem Fix wäre er wegen
    // des Deckels unangetastet geblieben.
    expect(lines[5]).toBe("[Bug 42: Titel 42](" + url + ")");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // Kehrseite desselben Fixes: der Deckel muss weiterhin greifen, wenn es
  // MEHR echte, auflösbare Provider-Links als maxLinks gibt (sonst wäre der
  // Fix selbst eine Regression – "maxLinks" darf kein Backstop mehr sein,
  // der de facto wirkungslos wird).
  it("mehr als maxLinks ECHTE Provider-Links: der Deckel greift weiterhin", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const { fetchImpl } = makeCountingFetchImpl();
    const urls = [1, 2, 3].map(workItemUrl);
    const md = urls.join("\n");
    const out = await resolveProviderLinkTitles(md, { fetchImpl, maxLinks: 2 });
    const lines = out.split("\n");
    expect(lines[0]).toBe("[Bug 1: Titel 1](" + urls[0] + ")");
    expect(lines[1]).toBe("[Bug 2: Titel 2](" + urls[1] + ")");
    expect(lines[2]).toBe(urls[2]); // 3. echter Link bleibt trotz Provider-Match unangetastet
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("resolveProviderLinkTitles: Idempotenz", () => {
  it("ein zweiter Lauf über das bereits aufgelöste Ergebnis ändert nichts mehr", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const { fetchImpl } = makeCountingFetchImpl();
    const md = "Siehe " + workItemUrl(1) + " und <" + workItemUrl(2) + "> dazu.";
    const once = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    fetchImpl.mockClear();
    const twice = await resolveProviderLinkTitles(once, { fetchImpl });
    expect(twice).toBe(once);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("resolveProviderLinkTitles: gemischtes Dokument, mehrere Provider", () => {
  it("nur Fundstellen mit passendem Provider+Zugangsdaten werden ersetzt, der Rest bleibt unangetastet", async () => {
    setLinkProviders([AZURE_PROVIDER, CUSTOM_PROVIDER_NO_CREDS]);
    const { fetchImpl } = makeCountingFetchImpl();
    const md =
      "DevOps: " + workItemUrl(1) + "\n" +
      "Custom (keine Creds): https://intranet.example/seite\n" +
      "Unbekannt: https://example.org/irgendwas";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    const lines = out.split("\n");
    expect(lines[0]).toBe("DevOps: [Bug 1: Titel 1](" + workItemUrl(1) + ")");
    expect(lines[1]).toBe("Custom (keine Creds): https://intranet.example/seite");
    expect(lines[2]).toBe("Unbekannt: https://example.org/irgendwas");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("resolveProviderLinkTitles: trailing Satzzeichen bei nackten URLs", () => {
  it("ein Satzpunkt direkt nach der URL wird NICHT Teil der aufgelösten URL/des Fetches", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const { fetchImpl } = makeCountingFetchImpl();
    const md = "Siehe " + workItemUrl(5) + ".";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe("Siehe [Bug 5: Titel 5](" + workItemUrl(5) + ").");
  });

  // Die "nackte URL"-Grammatik (NAKED_URL_SRC, wie INLINE_TOKEN_RE in
  // markdown.jsx) ist bewusst LOOSE (erlaubt auch unbalancierte Klammern
  // innerhalb des Matches) – die eigentliche Grenzziehung übernimmt
  // trimBareUrl NACH dem Match. Eine URL, die in umschließenden
  // Prosa-Klammern steht, darf dadurch nur die ÄUSSERE (unbalancierte)
  // schließende Klammer verlieren, nicht mehr.
  it("eine nackte URL in umschließenden Prosa-Klammern verliert nur die äußere schließende Klammer", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const { fetchImpl } = makeCountingFetchImpl();
    const md = "(siehe " + workItemUrl(6) + ")";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe("(siehe [Bug 6: Titel 6](" + workItemUrl(6) + "))");
  });

  // Wikipedia-Fall (dieselbe Konstellation wie im trimBareUrl-Kommentar,
  // markdown.jsx): eine zur URL GEHÖRENDE balancierte Klammer (hier im
  // Projektnamen, technisch von WORK_ITEM_URL_RE erlaubt) bleibt erhalten,
  // nur die äußere, NICHT zur URL gehörende Prosa-Klammer wird abgetrennt.
  // Bewusst über eine ECHTE, erfolgreiche Auflösung geprüft (nicht nur
  // "Original bleibt unverändert" bei fehlendem Provider): würde trimBareUrl
  // die äußere Klammer NICHT korrekt abtrennen, würde die URL fälschlich
  // eine schließende Klammer mitnehmen, parseWorkItemUrl (WORK_ITEM_URL_RE
  // erlaubt nach der ID nur "/", "?#…" oder Stringende) würde die URL dann
  // ABLEHNEN und der Fetch bliebe ohne Ergebnis (Original stünde unverändert
  // da) – der Test würde also bei einem kaputten trimBareUrl fehlschlagen.
  it("eine balancierte Klammer INNERHALB der URL bleibt Teil der URL, nur die äußere Prosa-Klammer wird abgetrennt", async () => {
    setLinkProviders([AZURE_PROVIDER]);
    const { fetchImpl } = makeCountingFetchImpl();
    const url = "https://dev.azure.com/acme/Pro(ject)/_workitems/edit/9";
    const md = "(siehe " + url + ")";
    const out = await resolveProviderLinkTitles(md, { fetchImpl });
    expect(out).toBe("(siehe [Bug 9: Titel 9](" + url + "))");
  });
});
