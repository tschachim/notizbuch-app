/* ------------------------------------------------------------------ */
/* Versionszähler pro Notizbuch (Stand & Anzahl der Git-Commits)        */
/* v7.52.2 (Review-Finding 1, E2E-Lauf v7.52 – siehe DECISIONS #110):   */
/* Der exakte Auslöser aus dem Tester-Repro (Notizbuch A mit 34         */
/* Versionen → B → zurück zu A → Kopfzeile zeigt sofort "2 Versionen",  */
/* die Historien-LISTE ist korrekt, F5 korrigiert) ließ sich NICHT      */
/* reproduzieren (ein einfacher A→B→A-Wechsel lieferte im Test korrekt  */
/* 46→1→46). Im Code (App.jsx) gab es aber DREI Wege, auf denen "meta"  */
/* (der React-State für die Anzeige) einem ANDEREN als dem AKTIVEN      */
/* Notizbuch gehören konnte – diese Klasse schließt dieses Modul        */
/* vollständig, unabhängig davon, welcher der drei Wege den Live-Befund */
/* tatsächlich ausgelöst hat:                                           */
/*  (a) Race beim schnellen Wechseln: refreshMeta() (App.jsx) setzte    */
/*      das Ergebnis eines async ghCommitMeta-Aufrufs bedingungslos per */
/*      setMeta() – eine VERSPÄTETE Antwort für das vorher aktive       */
/*      Notizbuch überschrieb die Anzeige des inzwischen aktiven.       */
/*  (b) commitDocNb (App.jsx) rief im SHA-Konflikt-Pfad refreshMeta()   */
/*      für das COMMITTETE Notizbuch auf, auch wenn es NICHT das aktive */
/*      war (Cross-Notizbuch-Op, z. B. über das "notebook"-Feld einer   */
/*      Op) – die Kopfzeile zeigte danach den Zähler des Zielbuchs.     */
/*  (c) refreshMeta() verschluckte Fehler still – schlug der Abruf nach */
/*      einem Wechsel fehl (Netz, Rate-Limit), blieb der Zähler des     */
/*      VORHERIGEN Notizbuchs stehen, ohne dass irgendwas darauf         */
/*      hindeutete.                                                      */
/* Diese Datei zieht die dafür nötige ENTSCHEIDUNGSLOGIK (nicht den     */
/* GitHub-Zugriff selbst – ghCommitMeta bleibt unverändert in           */
/* lib/github.js, dort verifiziert korrekt) in reine, exportierte       */
/* Helfer, damit sie unit-testbar ist: App.jsx hält einen               */
/* notizbuch-übergreifenden Cache (metaCache, ein Ref<Map<nbId,meta>>)  */
/* UND den aktuell angezeigten State ("meta", NUR für das aktive Buch); */
/* diese Datei entscheidet rein lesend (bzw. schreibt NUR in den        */
/* übergebenen Cache, nie in React-State), WELCHER Wert angezeigt       */
/* werden darf.                                                         */
/*                                                                       */
/* v7.52.2 Review-Nachbesserung (DECISIONS #110, "Review-Nachbesserung"-*/
/* Absatz): zwei WEITERE Wege kamen beim Review-Durchgang hinzu, die    */
/* KEIN Wechsel zwischen bereits bekannten Notizbüchern brauchen:       */
/*  (d) Reconnect auf ein ANDERES Daten-Repo (Settings-Dialog, gleiche  */
/*      oder andere nbId, z. B. ROOT_NB_ID "wissensbasis" existiert in  */
/*      JEDEM Repo): connect() ersetzte docCache/docShas/versionCache,  */
/*      NICHT aber metaCache – der Zähler-Cache gehört zur VERBINDUNG,  */
/*      nicht zum bloßen Notizbuch-Namen, sonst zeigt die Kopfzeile den */
/*      Stand des ALTEN Repos an (auch wenn dessen Abruf noch unterwegs */
/*      war und erst NACH dem Reconnect beantwortet wird). App.jsx löst */
/*      das über einen zusätzlichen "connectEpoch"-Zähler (useRef, NICHT*/
/*      Teil dieser Datei – reiner Zähler ohne Entscheidungslogik) plus */
/*      den hier neuen, unit-testbaren isStaleResponse()-Helfer.        */
/*  (e) bumpMetaCount() nach einem Commit auf ein Notizbuch OHNE         */
/*      bekannten Cache-Stand erfand bisher eine "1" statt "unbekannt + */
/*      1" zu sagen (Cross-Notizbuch-Commit auf ein in dieser Session   */
/*      nie besuchtes Buch) – UND ein zu diesem Zeitpunkt bereits        */
/*      LAUFENDER refreshMeta()-Abruf konnte das frische Inkrement mit  */
/*      einem älteren Stand überschreiben. bumpMetaCount() rät jetzt    */
/*      NIE mehr (count bleibt null, wenn die Basis unbekannt ist) und  */
/*      markiert den Cache-Eintrag mit "bumpedAt"; applyMetaResult()    */
/*      verwirft ein Ergebnis, dessen Abruf VOR diesem Zeitstempel       */
/*      gestartet wurde.                                                */
/* ------------------------------------------------------------------ */

// Platzhalter-Wert für "noch kein bekannter Stand" (frisch verbunden, gerade
// gewechselt, oder nach einem Fehler ohne vorherigen Cache-Eintrag) – NIE
// eine geratene Zahl (z. B. 0), die App.jsx-Anzeige rendert dafür "…" statt
// einer potenziell falschen Zahl (siehe App.jsx). Object.freeze (Review-
// Finding 3, 🔵): wird per Referenz in den React-State gereicht
// (resolveMetaForDisplay/metaAfterError liefern dieselbe Konstante an
// mehrere Aufrufer) – ein versehentliches Mutieren an einer Stelle dürfte
// NIE alle anderen Aufrufer mit-verfälschen.
export const UNKNOWN_META = Object.freeze({ count: null, lastTs: null });

// Wert für die Anzeige (Kopfzeile/Historie-Dialog) zu einem Notizbuch: der
// gecachte Stand, falls vorhanden, sonst der "unbekannt"-Platzhalter – NIE
// der (ggf. noch im State stehende) Wert eines ANDEREN Notizbuchs. Wird von
// switchNotebook() in App.jsx VOR dem eigentlichen ghCommitMeta-Abruf
// aufgerufen, damit der Zähler des verlassenen Notizbuchs nie kurz
// "hängen bleibt".
export function resolveMetaForDisplay(cache, nbId) {
  return (cache && cache.get(nbId)) || UNKNOWN_META;
}

// Epoch-Guard (Review-Nachbesserung, Finding 1(d)): reiner Vergleich, ob eine
// asynchrone Antwort noch zu der Verbindung gehört, unter der sie GESTARTET
// wurde. App.jsx zählt "connectEpoch" (useRef) bei JEDEM erfolgreichen
// connect() hoch (auch bei gleicher nbId – anderes Repo = andere
// Commit-Historie) und übergibt den zum Startzeitpunkt gültigen Wert an
// refreshMeta(); liefert isStaleResponse() true, gehört die Antwort zu einer
// bereits verlassenen Verbindung und MUSS verworfen werden (weder Cache noch
// Anzeige aktualisieren) – sonst könnte eine spät eintreffende Antwort aus
// dem ALTEN Repo den frisch geleerten Cache des NEUEN Repos wieder befüllen.
export function isStaleResponse(epochAtStart, currentEpoch) {
  return epochAtStart !== currentEpoch;
}

// Race-Guard (Finding 1a) + Bump-Schutz (Review-Nachbesserung, Finding 2):
// verarbeitet das Ergebnis eines (ggf. verspäteten) ghCommitMeta-Aufrufs für
// "nbId". "startedAt" ist der Zeitpunkt, zu dem DIESER Abruf gestartet wurde
// (Date.now() beim Aufruf von refreshMeta, siehe App.jsx) – war zu diesem
// Zeitpunkt bereits ein LOKALES Inkrement (bumpMetaCount, z. B. durch einen
// sofortigen zweiten Commit während der Abruf noch unterwegs war) im Cache
// vermerkt, ist das Abruf-Ergebnis VERALTET und wird verworfen (weder Cache
// noch Anzeige aktualisiert) – sonst überschriebe eine "alte" Serverantwort
// ein bereits bekanntes, frischeres N+1 wieder mit dem alten N. Ist das
// Ergebnis nicht veraltet, schreibt die Funktion IMMER in den Cache – auch
// wenn nbId inzwischen NICHT mehr das aktive Notizbuch ist (der Abruf war ja
// trotzdem korrekt und soll beim nächsten Wechsel dorthin sofort zur
// Verfügung stehen) – gibt aber nur dann ein "displayMeta" zurück, wenn
// nbId GENAU dem zum Zeitpunkt der ANTWORT aktiven Notizbuch (activeId)
// entspricht. Der Aufrufer (refreshMeta in App.jsx) ruft setMeta() NUR auf,
// wenn displayMeta nicht null ist – eine verspätete Antwort für ein
// inzwischen verlassenes Notizbuch überschreibt die Anzeige dadurch nie.
export function applyMetaResult(cache, nbId, activeId, result, startedAt) {
  const prev = cache.get(nbId);
  if (prev && prev.bumpedAt && startedAt !== undefined && prev.bumpedAt > startedAt) {
    return { displayMeta: null }; // Abruf begann VOR einem lokalen Commit → veraltet, Cache behalten
  }
  cache.set(nbId, result);
  return { displayMeta: nbId === activeId ? result : null };
}

// Fehlerfall (Finding 1c): ghCommitMeta ist fehlgeschlagen (Netz,
// Rate-Limit). Der Cache bleibt UNANGETASTET – ein Netzfehler darf einen
// bereits bekannten (ggf. etwas älteren) Stand nie löschen. NUR wenn das
// betroffene Notizbuch noch AKTIV ist UND für es noch KEIN Cache-Wert
// existiert (z. B. der allererste Abruf direkt nach dem Verbinden schlägt
// fehl), zeigt die Anzeige den "unbekannt"-Platzhalter statt für immer im
// Stand des vorherigen Notizbuchs hängen zu bleiben – der Aufrufer setzt in
// jedem anderen Fall NICHTS (behält den zuletzt bekannten/angezeigten
// Stand).
export function metaAfterError(cache, nbId, activeId) {
  if (nbId !== activeId) return null;
  if (cache && cache.has(nbId)) return null;
  return UNKNOWN_META;
}

// Inkrement nach einem erfolgreichen Commit (commitDocNb, Finding 1b/1d):
// erhöht den gecachten Zähler für nbId um 1 – NUR, wenn die Basis bekannt
// ist (Review-Nachbesserung, Finding 2: ein Cross-Notizbuch-Commit auf ein
// in dieser Session nie besuchtes Buch hat KEINEN Cache-Eintrag; "0+1=1"
// wäre eine GERATENE Zahl, die z. B. bei einem Notizbuch mit bereits 34
// Versionen als "1" in der Kopfzeile hängen bliebe, bis der nachgeholte
// Abruf greift – siehe App.jsx: dort löst count===null einen sofortigen
// refreshMeta()-Nachholabruf aus). Ist die Basis unbekannt, bleibt count
// bewusst null (nie raten) – lastTs/bumpedAt werden trotzdem gesetzt, damit
// die Anzeige "…" statt eines veralteten/falschen Werts zeigt. "bumpedAt"
// markiert den Zeitpunkt des Inkrements für den Bump-Schutz in
// applyMetaResult() oben (ein zu diesem Zeitpunkt bereits LAUFENDER Abruf
// mit einem älteren Stand darf dieses Inkrement nicht überschreiben).
// Schreibt IMMER in den Cache, UNABHÄNGIG davon, ob nbId das aktive
// Notizbuch ist (der SHA-Konflikt-Pfad von commitDocNb committet z. B. ein
// NICHT-aktives Notizbuch über das "notebook"-Feld einer Op) – der Aufrufer
// entscheidet separat (nbId === activeId), ob der zurückgegebene Wert
// zusätzlich per setMeta() angezeigt wird.
export function bumpMetaCount(cache, nbId, ts) {
  const prev = cache.get(nbId);
  const known = prev && typeof prev.count === "number";
  const next = { count: known ? prev.count + 1 : null, lastTs: ts, bumpedAt: ts }; // nie raten
  cache.set(nbId, next);
  return next;
}
