package io.github.tschachim.notizbuch;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognitionService;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * JS-Brücke zur Android-Spracherkennung (android.speech.SpeechRecognizer),
 * DECISIONS #140. Bewusst MINIMAL und STABIL: Die Brücke reicht nur den
 * ROHEN Ereignisstrom des Erkenners an die Web-App weiter (listening, ready,
 * beginning, endofspeech, partial, segment, results, error mit Zahlencode,
 * end). Die Übersetzung in die Semantik der Web Speech API passiert in der
 * Web-App (src/lib/androidSpeech.js) – dort ist sie testbar und ohne
 * APK-Update änderbar.
 *
 * Vertrag:
 * - JS ruft speechStart(sid, optionsJson) / speechStop(sid) /
 *   speechAbort(sid); sid = [A-Za-z0-9_-]{1,64}.
 * - Java antwortet per evaluateJavascript (nur Hauptframe) mit
 *   window.__notizbuchAndroidSpeech(jsonString), Nachricht
 *   {v:1, sid, type, ...}. Pro angenommener sid kommt GENAU EIN "end".
 * - Fehlercodes: positiv = SpeechRecognizer.ERROR_*, negativ = ERR_* unten.
 *
 * Threads: Die @JavascriptInterface-Methoden laufen auf dem JavaBridge-
 * Thread der WebView. Sie prüfen nur die Argumente und posten alles Weitere
 * auf den Main-Thread (SpeechRecognizer und WebView dürfen nur dort benutzt
 * werden); sie blockieren nie. getInfo/getLog lesen nur thread-sichere
 * Quellen (PackageManager, Berechtigungsstand, synchronisiertes Protokoll).
 *
 * Sicherheit: Auslösende Aufrufe (Start, Einstellungen öffnen) wirken nur,
 * wenn die Hauptseite der WebView https://tschachim.github.io ist (Prüfung
 * auf dem Main-Thread per WebView.getUrl()). Ereignisse gehen nur in den
 * Hauptframe. getInfo/getLog enthalten weder Transkripte noch Zugangsdaten.
 */
public final class SpeechBridge {

    static final String JS_NAME = "NotizbuchAndroid";
    static final String JS_CALLBACK = "__notizbuchAndroidSpeech";
    static final int BRIDGE_VERSION = 1;

    // Brücken-eigene Fehlercodes (negativ). Spiegel in androidSpeech.js.
    static final int ERR_MIC_DENIED = -1;      // Berechtigungsdialog: abgelehnt
    static final int ERR_MIC_BLOCKED = -2;     // abgelehnt und kein Dialog mehr (oder weggewischt)
    static final int ERR_START_FAILED = -3;    // Erkenner ließ sich nicht anlegen/starten
    static final int ERR_APP_HIDDEN = -4;      // App unsichtbar geworden (onStop)
    static final int ERR_ABORTED = -5;         // speechAbort, ersetzt, Seite neu geladen, Dialog abgebrochen
    static final int ERR_NOT_APP_PAGE = -6;    // Hauptseite ist nicht die App
    static final int ERR_NO_RECOGNIZER = -7;   // kein (passender) Erkennungsdienst installiert
    static final int ERR_NATIVE_TIMEOUT = -8;  // Sicherheitsdeckel: Sitzung lief zu lange

    private static final String TAG = "NotizbuchSpeech";

    // Provider-Wahl und Extras wie Chrome (Chromium SpeechRecognitionImpl.java).
    private static final String SSBG_PACKAGE = "com.google.android.tts";
    private static final String AGSA_PACKAGE = "com.google.android.googlequicksearchbox";
    private static final long AGSA_MIN_VERSION = 300207030L;
    private static final String EXTRA_DICTATION_MODE = "android.speech.extra.DICTATION_MODE";
    private static final String EXTRA_UNSTABLE_TEXT = "android.speech.extra.UNSTABLE_TEXT";
    private static final String EXTRA_FINAL_RESULT = "final_result";

    private static final int MAX_SEGMENTED_MS = 300_000;    // Höchstwert des Google-Dienstes (Chromium)
    private static final long MAX_SESSION_MS = 330_000L;    // Deckel gegen ein "vergessenes" Mikrofon
    private static final int MAX_TEXTS = 5;
    private static final int LOG_SIZE = 80;
    // U+2028/U+2029 als Zeichenkonstanten: so steht kein unsichtbares
    // Sonderzeichen im Quelltext. Auch der Ersatztext wird aus dem Zeichen
    // 0x5C (umgekehrter Schrägstrich) zusammengesetzt statt als Literal
    // geschrieben: javac wertet Unicode-Escapes schon VOR dem Parsen aus
    // (sogar in Kommentaren), und Editier-Werkzeuge wandeln solche Folgen
    // gern unbemerkt in das echte Zeichen um – das Escapen wäre dann
    // stillschweigend wirkungslos.
    private static final String LINE_SEP = String.valueOf((char) 0x2028);
    private static final String PARA_SEP = String.valueOf((char) 0x2029);
    private static final String LINE_SEP_ESC = (char) 0x5C + "u2028";
    private static final String PARA_SEP_ESC = (char) 0x5C + "u2029";

    private static final Pattern SID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final Pattern LANG = Pattern.compile("[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}");
    private static final Pattern PKG = Pattern.compile("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+");

    private static final int WAITING_FOR_MIC = 0;
    private static final int LISTENING = 1;

    private final MainActivity activity;
    private final Context app;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayDeque<String> logBuf = new ArrayDeque<>();
    private final long t0 = SystemClock.elapsedRealtime();

    // pageGen/destroyed werden auf dem Main-Thread geschrieben und auf dem
    // JavaBridge-Thread gelesen. current wird NUR auf dem Main-Thread benutzt.
    private volatile int pageGen;
    private volatile boolean destroyed;
    private Session current;

    SpeechBridge(MainActivity activity, WebView web) {
        this.activity = activity;
        this.app = activity.getApplicationContext();
        this.web = web;
    }

    /* ======================= JS-Schnittstelle ======================= */

    /** Fähigkeiten und Gerätestand als JSON (Diagnose). Kein Transkript, keine Zugangsdaten. */
    @JavascriptInterface
    public String getInfo() {
        JSONObject o = new JSONObject();
        try {
            o.put("bridge", BRIDGE_VERSION);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("release", Build.VERSION.RELEASE);
            o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            PackageInfo self = app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
            o.put("appVersionName", self.versionName);
            o.put("appVersionCode", versionCodeOf(self));
            o.put("mic", app.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED ? "granted" : "not-granted");
            PackageInfo wv = WebView.getCurrentWebViewPackage();
            if (wv != null) o.put("webView", wv.packageName + " " + wv.versionName);
            o.put("recognitionAvailable", SpeechRecognizer.isRecognitionAvailable(app));
            o.put("onDeviceAvailable", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    && SpeechRecognizer.isOnDeviceRecognitionAvailable(app));
            JSONArray services = new JSONArray();
            for (ResolveInfo ri : queryRecognitionServices()) {
                ServiceInfo si = ri.serviceInfo;
                if (si != null) services.put(si.packageName + "/" + si.name);
            }
            o.put("services", services);
            ComponentName auto = googleProvider();
            o.put("autoProvider", auto != null ? auto.flattenToShortString() : "default");
            o.put("formatting", Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU);
            o.put("segmented", Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU);
            o.put("features", new JSONArray().put("speech").put("webSpeech").put("settings").put("log"));
        } catch (JSONException | PackageManager.NameNotFoundException | RuntimeException e) {
            log("getInfo: " + e.getClass().getSimpleName());
        }
        return o.toString();
    }

    /** Die letzten Brücken-Ereignisse (ohne Transkripte) als JSON-Array von Strings. */
    @JavascriptInterface
    public String getLog() {
        synchronized (logBuf) {
            return new JSONArray(logBuf).toString();
        }
    }

    @JavascriptInterface
    public void speechStart(final String sid, final String optionsJson) {
        if (!validSid(sid)) {
            log("start: ungültige sid");
            return;
        }
        final Options opt = Options.parse(optionsJson);
        final int gen = pageGen;
        main.post(() -> startOnMain(sid, opt, gen));
    }

    @JavascriptInterface
    public void speechStop(final String sid) {
        if (!validSid(sid)) return;
        main.post(() -> stopOnMain(sid));
    }

    @JavascriptInterface
    public void speechAbort(final String sid) {
        if (!validSid(sid)) return;
        main.post(() -> abortOnMain(sid));
    }

    /** target: "app" = eigene App-Info, sonst Paketname eines installierten Erkennungsdienstes. */
    @JavascriptInterface
    public void openSettings(final String target) {
        final String t = target == null ? "app" : target;
        final int gen = pageGen;
        main.post(() -> {
            if (destroyed || gen != pageGen || !isAppPage()) return;
            if ("app".equals(t)) {
                activity.openAppDetails(app.getPackageName());
            } else if (PKG.matcher(t).matches() && isRecognitionServicePackage(t)) {
                activity.openAppDetails(t);
            }
        });
    }

    /* ======================= Lebenszyklus (Main-Thread) ======================= */

    /** Neue Hauptseite (Laden/Neuladen): Sitzung der alten Seite beenden. */
    void onPageStarted() {
        pageGen++;
        Session s = current;
        if (s != null) {
            log("Seite neu geladen");
            cancelRecognizer(s);
            finish(s, ERR_ABORTED);
        }
    }

    /** Activity unsichtbar (onStop): laufende Erkennung abbrechen wie Chrome bei verborgener Seite. */
    void onAppHidden() {
        Session s = current;
        if (s != null && s.state == LISTENING) {
            cancelRecognizer(s);
            finish(s, ERR_APP_HIDDEN);
        }
        // WAITING_FOR_MIC bleibt: kommt das Dialog-Ergebnis, prüft der
        // Rückruf, ob die App sichtbar ist (MainActivity.canUseMic()).
    }

    void destroy() {
        destroyed = true;
        main.removeCallbacksAndMessages(null);
        Session s = current;
        current = null;
        if (s != null) {
            cancelRecognizer(s);
            destroyRecognizer(s);
        }
    }

    /* ======================= Sitzung (Main-Thread) ======================= */

    private final class Session {
        final String sid;
        final Options opt;
        int state = WAITING_FOR_MIC;
        SpeechRecognizer rec;
        boolean stopRequested;
        final Runnable watchdog;

        Session(String sid, Options opt) {
            this.sid = sid;
            this.opt = opt;
            // Im Konstruktor (nicht als Feld-Initialisierer): javac lehnt
            // Lambdas ab, die finale, erst im Konstruktor gesetzte Felder lesen.
            this.watchdog = this::expire;
        }

        private void expire() {
            if (current != this) return;
            log("Deckel erreicht " + sid);
            cancelRecognizer(this);
            finish(this, ERR_NATIVE_TIMEOUT);
        }
    }

    private void startOnMain(String sid, Options opt, int gen) {
        if (destroyed) return;
        if (gen != pageGen) {
            log("start verworfen (Seite neu geladen) " + sid);
            return;
        }
        if (!isAppPage()) {
            log("start abgelehnt: keine App-Seite");
            emitError(sid, ERR_NOT_APP_PAGE);
            emit(sid, "end", null);
            return;
        }
        Session old = current;
        if (old != null) {
            log("ersetzt " + old.sid);
            cancelRecognizer(old);
            finish(old, ERR_ABORTED);
        }
        final Session s = new Session(sid, opt);
        current = s;
        log("start " + sid + " lang=" + opt.lang + " provider=" + opt.provider
                + (opt.formatting != null ? " formatting=" + opt.formatting : "")
                + (opt.segmentedMs > 0 ? " segmented=" + opt.segmentedMs : ""));
        if (!activity.canUseMic()) {
            finish(s, ERR_APP_HIDDEN);
            return;
        }
        activity.withMic(result -> {
            if (current != s) return; // inzwischen abgebrochen/ersetzt
            if (result != 0) {
                finish(s, result);
                return;
            }
            if (!activity.canUseMic()) {
                finish(s, ERR_APP_HIDDEN);
                return;
            }
            begin(s);
        });
    }

    private void begin(Session s) {
        SpeechRecognizer rec;
        try {
            rec = createRecognizer(s.opt);
        } catch (RuntimeException e) {
            log("create: " + e.getClass().getSimpleName());
            finish(s, ERR_START_FAILED);
            return;
        }
        if (rec == null) {
            finish(s, ERR_NO_RECOGNIZER);
            return;
        }
        s.rec = rec;
        try {
            rec.setRecognitionListener(new Listener(s));
            rec.startListening(buildIntent(s.opt));
        } catch (RuntimeException e) {
            // z. B. SecurityException (Chrome zeigt hier nur einen Toast und meldet nichts)
            log("startListening: " + e.getClass().getSimpleName());
            finish(s, ERR_START_FAILED);
            return;
        }
        s.state = LISTENING;
        main.postDelayed(s.watchdog, MAX_SESSION_MS);
        emit(s.sid, "listening", null);
    }

    private void stopOnMain(String sid) {
        Session s = current;
        if (destroyed || s == null || !s.sid.equals(sid)) return;
        if (s.state != LISTENING) {
            // Berechtigungsdialog offen: noch nichts zu finalisieren.
            finish(s, ERR_ABORTED);
            return;
        }
        if (s.stopRequested) return;
        s.stopRequested = true;
        log("stop " + sid);
        try {
            s.rec.stopListening(); // Ende kommt über onResults/onError
        } catch (RuntimeException e) {
            log("stopListening: " + e.getClass().getSimpleName());
            cancelRecognizer(s);
            finish(s, ERR_ABORTED);
        }
    }

    private void abortOnMain(String sid) {
        Session s = current;
        if (destroyed || s == null || !s.sid.equals(sid)) return;
        log("abort " + sid);
        cancelRecognizer(s);
        finish(s, ERR_ABORTED);
    }

    /** Einziger Weg, eine Sitzung zu beenden: Erkenner weg, ggf. error, dann GENAU EIN end. */
    private void finish(Session s, int code) {
        if (current != s) return;
        current = null;
        main.removeCallbacks(s.watchdog);
        destroyRecognizer(s);
        if (code != 0) emitError(s.sid, code);
        emit(s.sid, "end", null);
    }

    private void cancelRecognizer(Session s) {
        if (s.rec == null) return;
        try {
            s.rec.cancel();
        } catch (RuntimeException e) {
            log("cancel: " + e.getClass().getSimpleName());
        }
    }

    private void destroyRecognizer(Session s) {
        SpeechRecognizer r = s.rec;
        s.rec = null;
        if (r == null) return;
        try {
            r.destroy();
        } catch (RuntimeException e) {
            // Chrome fängt hier IllegalArgumentException (Samsung-Geräte).
            log("destroy: " + e.getClass().getSimpleName());
        }
    }

    /** Rückrufe kommen auf dem Main-Looper; Rückrufe einer beendeten Sitzung werden verworfen. */
    private final class Listener implements RecognitionListener {
        private final Session s;

        Listener(Session s) {
            this.s = s;
        }

        private boolean live() {
            return current == s && !destroyed;
        }

        @Override
        public void onReadyForSpeech(Bundle params) {
            if (live()) emit(s.sid, "ready", null);
        }

        @Override
        public void onBeginningOfSpeech() {
            if (live()) emit(s.sid, "beginning", null);
        }

        @Override
        public void onRmsChanged(float rmsdB) {
            // bewusst nicht weitergereicht (ca. 10 Ereignisse pro Sekunde)
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
        }

        @Override
        public void onEndOfSpeech() {
            if (live()) emit(s.sid, "endofspeech", null);
        }

        @Override
        public void onError(int error) {
            if (!live()) return;
            // JEDER Fehler beendet die Sitzung (Chrome lässt unbekannte Codes
            // hängen: "default: assert false; return;").
            finish(s, error != 0 ? error : ERR_START_FAILED);
        }

        @Override
        public void onResults(Bundle results) {
            if (!live()) return;
            emit(s.sid, "results", resultPayload(results, false));
            finish(s, 0); // onResults kommt genau einmal, am Sitzungsende
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            if (live()) emit(s.sid, "partial", resultPayload(partialResults, true));
        }

        @Override
        public void onEvent(int eventType, Bundle params) {
        }

        // Ab Android 13 (Default-Methoden des Interfaces; auf älteren Geräten nie aufgerufen).
        @Override
        public void onSegmentResults(Bundle segmentResults) {
            if (live()) emit(s.sid, "segment", resultPayload(segmentResults, false));
        }

        @Override
        public void onEndOfSegmentedSession() {
            if (live()) finish(s, 0);
        }
    }

    /* ======================= Erkenner und Intent ======================= */

    private SpeechRecognizer createRecognizer(Options o) {
        if ("ondevice".equals(o.provider)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    && SpeechRecognizer.isOnDeviceRecognitionAvailable(app)) {
                return SpeechRecognizer.createOnDeviceSpeechRecognizer(app);
            }
            return null;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(app)) return null;
        ComponentName cn = null;
        if ("auto".equals(o.provider)) {
            cn = googleProvider(); // null -> System-Standard (wie Chrome)
        } else if (!"default".equals(o.provider)) {
            cn = componentOfPackage(o.provider);
            if (cn == null) return null;
        }
        return cn != null
                ? SpeechRecognizer.createSpeechRecognizer(app, cn)
                : SpeechRecognizer.createSpeechRecognizer(app);
    }

    /** Standard exakt wie Chrome im Einzelmodus; alles Weitere nur auf Wunsch der Web-App. */
    private static Intent buildIntent(Options o) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(EXTRA_DICTATION_MODE, false);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, o.lang);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, o.partial);
        if (o.languageModel != null) i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, o.languageModel);
        if (o.preferOffline) i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (o.formatting != null) {
                i.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, o.formatting);
                if (o.hidePartialTrailingPunctuation) {
                    i.putExtra(RecognizerIntent.EXTRA_HIDE_PARTIAL_TRAILING_PUNCTUATION, true);
                }
            }
            if (o.maskOffensive != null) {
                i.putExtra(RecognizerIntent.EXTRA_MASK_OFFENSIVE_WORDS, o.maskOffensive.booleanValue());
            }
            if (o.segmentedMs > 0) {
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, o.segmentedMs);
                i.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION,
                        RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS);
            }
        }
        return i;
    }

    private List<ResolveInfo> queryRecognitionServices() {
        List<ResolveInfo> l = app.getPackageManager()
                .queryIntentServices(new Intent(RecognitionService.SERVICE_INTERFACE), 0);
        return l != null ? l : new ArrayList<ResolveInfo>();
    }

    /** Google-Dienst wie Chrome: ab Android 12 "Speech Services by Google", davor die Google-App. */
    private ComponentName googleProvider() {
        boolean s = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
        String pkg = s ? SSBG_PACKAGE : AGSA_PACKAGE;
        for (ResolveInfo ri : queryRecognitionServices()) {
            ServiceInfo si = ri.serviceInfo;
            if (si == null || !pkg.equals(si.packageName)) continue;
            if (!s && packageVersion(pkg) < AGSA_MIN_VERSION) continue;
            return new ComponentName(si.packageName, si.name);
        }
        return null;
    }

    private ComponentName componentOfPackage(String pkg) {
        for (ResolveInfo ri : queryRecognitionServices()) {
            ServiceInfo si = ri.serviceInfo;
            if (si != null && pkg.equals(si.packageName)) return new ComponentName(si.packageName, si.name);
        }
        return null;
    }

    private boolean isRecognitionServicePackage(String pkg) {
        return componentOfPackage(pkg) != null;
    }

    private long packageVersion(String pkg) {
        try {
            return versionCodeOf(app.getPackageManager().getPackageInfo(pkg, 0));
        } catch (PackageManager.NameNotFoundException | RuntimeException e) {
            return -1;
        }
    }

    @SuppressWarnings("deprecation")
    private static long versionCodeOf(PackageInfo pi) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
    }

    /* ======================= Rückkanal ======================= */

    private static JSONObject resultPayload(Bundle b, boolean partial) {
        JSONObject o = new JSONObject();
        JSONArray texts = new JSONArray();
        try {
            if (b != null) {
                ArrayList<String> list = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (list != null) {
                    for (int i = 0; i < list.size() && i < MAX_TEXTS; i++) {
                        String t = list.get(i);
                        texts.put(t != null ? t : "");
                    }
                }
                float[] scores = b.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
                if (scores != null) {
                    JSONArray sc = new JSONArray();
                    for (int i = 0; i < scores.length && i < MAX_TEXTS; i++) {
                        float f = scores[i];
                        sc.put(Float.isNaN(f) || Float.isInfinite(f) ? 0.0 : (double) f);
                    }
                    o.put("scores", sc);
                }
                if (partial) {
                    ArrayList<String> unstable = b.getStringArrayList(EXTRA_UNSTABLE_TEXT);
                    if (unstable != null && !unstable.isEmpty() && unstable.get(0) != null) {
                        o.put("unstable", unstable.get(0));
                    }
                    if (b.getBoolean(EXTRA_FINAL_RESULT, false)) o.put("fin", true);
                }
            }
        } catch (JSONException | RuntimeException e) {
            // z. B. BadParcelableException beim Auspacken eines fremden Bundles
            Log.w(TAG, "resultPayload: " + e.getClass().getSimpleName());
        }
        try {
            o.put("texts", texts);
        } catch (JSONException ignored) {
            // kann bei festem Schlüssel nicht passieren
        }
        return o;
    }

    private void emitError(String sid, int code) {
        JSONObject p = new JSONObject();
        try {
            p.put("code", code);
        } catch (JSONException ignored) {
            // fester Schlüssel
        }
        emit(sid, "error", p);
    }

    /** Nur auf dem Main-Thread. Transkripte erscheinen NIE im Protokoll (nur Längen). */
    private void emit(String sid, String type, JSONObject payload) {
        JSONObject m = payload != null ? payload : new JSONObject();
        try {
            m.put("v", BRIDGE_VERSION);
            m.put("sid", sid);
            m.put("type", type);
        } catch (JSONException e) {
            return;
        }
        log(type + " " + sid + summary(m));
        if (destroyed) return;
        // Die Nachricht wird als JS-STRING übergeben und in JS per JSON.parse
        // gelesen – sie wird nie selbst zu Code. U+2028/U+2029 escapt
        // JSONObject.quote nicht; seit ES2019 sind sie in String-Literalen
        // erlaubt, sicherheitshalber trotzdem escapen.
        String arg = JSONObject.quote(m.toString())
                .replace(LINE_SEP, LINE_SEP_ESC)
                .replace(PARA_SEP, PARA_SEP_ESC);
        try {
            web.evaluateJavascript("(function(m){var h=window." + JS_CALLBACK
                    + ";if(typeof h==='function')h(m);})(" + arg + ");", null);
        } catch (RuntimeException e) {
            log("evaluateJavascript: " + e.getClass().getSimpleName());
        }
    }

    private static String summary(JSONObject m) {
        if (m.has("code")) return " code=" + m.optInt("code");
        JSONArray t = m.optJSONArray("texts");
        if (t == null) return "";
        String first = t.optString(0, "");
        return " n=" + t.length() + " len=" + first.length()
                + (m.has("unstable") ? " +" + m.optString("unstable", "").length() : "")
                + (m.optBoolean("fin", false) ? " fin" : "");
    }

    /* ======================= Hilfen ======================= */

    /** Main-Thread: ist die Hauptseite die App (https://tschachim.github.io)? */
    private boolean isAppPage() {
        String url = web.getUrl();
        if (url == null) return false;
        Uri u = Uri.parse(url);
        int port = u.getPort();
        return "https".equals(u.getScheme()) && MainActivity.APP_HOST.equals(u.getHost())
                && (port == -1 || port == 443);
    }

    private static boolean validSid(String sid) {
        return sid != null && SID.matcher(sid).matches();
    }

    void log(String line) {
        String entry = String.format(Locale.ROOT, "+%.3fs %s",
                (SystemClock.elapsedRealtime() - t0) / 1000.0, line);
        Log.i(TAG, entry);
        synchronized (logBuf) {
            if (logBuf.size() >= LOG_SIZE) logBuf.removeFirst();
            logBuf.addLast(entry);
        }
    }

    /** Startoptionen aus der Web-App; jeder Wert wird geprüft bzw. geklemmt (Vertrauensgrenze). */
    static final class Options {
        String lang = "de-DE";
        boolean partial = true;
        String provider = "auto"; // auto | default | ondevice | Paketname
        String formatting;        // null | quality | latency
        boolean hidePartialTrailingPunctuation;
        boolean preferOffline;
        Boolean maskOffensive;    // null = Dienst-Standard
        int segmentedMs;          // 0 = aus
        String languageModel;     // null = wie Chrome (keins)

        static Options parse(String json) {
            Options o = new Options();
            if (json == null || json.length() > 4000) return o;
            try {
                JSONObject j = new JSONObject(json);
                String lang = j.optString("lang", "");
                if (LANG.matcher(lang).matches()) o.lang = lang;
                o.partial = j.optBoolean("partial", true);
                String p = j.optString("provider", "auto");
                if ("auto".equals(p) || "default".equals(p) || "ondevice".equals(p)
                        || (p.length() <= 120 && PKG.matcher(p).matches())) {
                    o.provider = p;
                }
                String f = j.optString("formatting", "");
                if ("quality".equals(f) || "latency".equals(f)) o.formatting = f;
                o.hidePartialTrailingPunctuation = j.optBoolean("hidePartialTrailingPunctuation", false);
                o.preferOffline = j.optBoolean("preferOffline", false);
                if (j.has("maskOffensive")) o.maskOffensive = j.optBoolean("maskOffensive", true);
                int seg = j.optInt("segmentedMs", 0);
                if (seg > 0) o.segmentedMs = Math.max(1000, Math.min(MAX_SEGMENTED_MS, seg));
                String lm = j.optString("languageModel", "");
                if ("free_form".equals(lm)) o.languageModel = RecognizerIntent.LANGUAGE_MODEL_FREE_FORM;
                else if ("web_search".equals(lm)) o.languageModel = RecognizerIntent.LANGUAGE_MODEL_WEB_SEARCH;
            } catch (JSONException e) {
                // kaputtes JSON -> Standardwerte
            }
            return o;
        }
    }
}
