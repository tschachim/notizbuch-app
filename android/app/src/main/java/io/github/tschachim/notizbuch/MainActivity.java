package io.github.tschachim.notizbuch;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;

/**
 * Rahmenloser Mini-Browser für die Notizbuch-Web-App. Die App enthält
 * keinerlei eigene Logik – sie lädt immer die Live-Website, Updates der
 * Website kommen also ohne App-Update an. Zugangsdaten bleiben im
 * localStorage der WebView (App-privat auf dem Gerät).
 *
 * Seit versionCode 2 (DECISIONS #140): Spracheingabe über eine kleine
 * JS-Brücke zur Android-Spracherkennung (SpeechBridge), die
 * Mikrofon-Laufzeitberechtigung und – als Rückfall ohne APK-Update – die
 * Mikrofon-Freigabe für die Web Speech API der WebView (onPermissionRequest).
 */
public class MainActivity extends Activity {

    static final String START_URL = "https://tschachim.github.io/notizbuch-app/";
    static final String APP_HOST = "tschachim.github.io";
    private static final int FILE_CHOOSER_REQUEST = 1;
    private static final int MIC_PERMISSION_REQUEST = 2;

    /** Ergebnis einer Mikrofon-Anfrage: 0 = erteilt, sonst SpeechBridge.ERR_*. */
    interface MicResult {
        void done(int result);
    }

    private WebView web;
    private SpeechBridge speech;
    private ValueCallback<Uri[]> pendingFileChooser;
    private PermissionRequest pendingWebMic;
    private final ArrayList<MicResult> micWaiters = new ArrayList<>();
    private boolean micRequestRunning;
    private boolean started;
    private boolean destroyed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Nur Debug-Builds (CI-Prüfbuild, Emulator-Smoke-Test): WebView per
        // chrome://inspect bzw. adb untersuchbar. Das veröffentlichte
        // Release-APK ist nie debuggable.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // localStorage: PAT/API-Key der App
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        // Reine Remote-Hülle: kein Zugriff auf lokale Dateien/Content-Provider
        // (Defense-in-Depth; bis API 29 wäre file access sonst default an).
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // App-Gefühl: kein Pinch-/Doppeltipp-Zoom – gezoomter Inhalt ließ
        // sich sonst seitlich verschieben, die App soll nur vertikal
        // scrollen und auf Gerätebreite bleiben.
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        // Spracheingabe-Brücke VOR loadUrl/restoreState: ein per
        // addJavascriptInterface angemeldetes Objekt erscheint erst beim
        // nächsten Laden einer Seite.
        speech = new SpeechBridge(this, web);
        web.addJavascriptInterface(speech, SpeechBridge.JS_NAME);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                // Nur die App selbst in der WebView halten; alles andere
                // (Quellen-Fußnoten, externe Links) öffnet der System-Browser.
                if (APP_HOST.equals(uri.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) { /* kein Handler installiert */ }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                // Neue Hauptseite: eine Sitzung der alten Seite beenden.
                speech.onPageStarted();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                // Datei-/Bild-Anhänge der Web-App
                if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
                pendingFileChooser = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    pendingFileChooser = null;
                    return false;
                }
                return true;
            }

            // Rückfall-Weg "WebView-Erkenner" (Web Speech API der WebView):
            // Chromium fragt hier nach der Mikrofon-Freigabe. Ohne diese
            // Methode lehnt die WebView immer ab.
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                handleWebPermission(request);
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingWebMic == request) pendingWebMic = null;
            }
        });

        setContentView(web);

        // restoreState liefert null, wenn nichts wiederherstellbar ist –
        // dann frisch laden statt leerer Seite.
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(START_URL);
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        started = true;
    }

    @Override
    protected void onStop() {
        // Bewusst onStop, NICHT onPause: Der Android-Berechtigungsdialog
        // pausiert die Activity (sie bleibt dahinter sichtbar); ein Abbruch
        // in onPause würde das erste Diktat jedes Mal beenden. Unsichtbar
        // (App-Wechsel, Bildschirm aus) wird abgebrochen wie in Chrome bei
        // verborgener Seite; ab Android 9 bekäme eine Hintergrund-App vom
        // Mikrofon ohnehin nur Stille.
        started = false;
        speech.onAppHidden();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        speech.destroy();
        micWaiters.clear();
        if (pendingWebMic != null) {
            try {
                pendingWebMic.deny();
            } catch (RuntimeException ignored) { /* WebView schon weg */ }
            pendingWebMic = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && pendingFileChooser != null) {
            pendingFileChooser.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            pendingFileChooser = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /* ---------------- Mikrofon (nur Main-Thread) ---------------- */

    /** Darf jetzt aufgenommen werden (App sichtbar, nicht zerstört)? */
    boolean canUseMic() {
        return started && !destroyed;
    }

    /**
     * Ruft cb mit 0 auf, sobald RECORD_AUDIO erteilt ist (ggf. nach dem
     * Android-Dialog), sonst mit SpeechBridge.ERR_MIC_DENIED/_BLOCKED bzw.
     * ERR_ABORTED (Dialog abgebrochen). Activity.requestPermissions erlaubt
     * nur EINE Anfrage gleichzeitig (eine zweite bekäme sofort leere
     * Ergebnisse) – weitere Wartende hängen sich an die laufende an.
     */
    void withMic(MicResult cb) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            cb.done(0);
            return;
        }
        micWaiters.add(cb);
        if (micRequestRunning) return;
        micRequestRunning = true;
        speech.log("Berechtigungsdialog");
        try {
            requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, MIC_PERMISSION_REQUEST);
        } catch (RuntimeException e) {
            micRequestRunning = false;
            speech.log("requestPermissions: " + e.getClass().getSimpleName());
            flushMicWaiters(SpeechBridge.ERR_START_FAILED);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != MIC_PERMISSION_REQUEST) {
            super.onRequestPermissionsResult(requestCode, permissions, grantResults);
            return;
        }
        micRequestRunning = false;
        int result;
        if (grantResults == null || grantResults.length == 0) {
            // Laut Doku: Interaktion unterbrochen -> wie Abbruch behandeln.
            result = SpeechBridge.ERR_ABORTED;
        } else if (grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            result = 0;
        } else if (shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO)) {
            result = SpeechBridge.ERR_MIC_DENIED; // Dialog darf erneut erscheinen
        } else {
            // "Nicht mehr fragen"/zweite Ablehnung – oder (ab Android 11)
            // Dialog weggewischt. Die Web-App bietet in beiden Fällen den
            // Weg über die App-Einstellungen an.
            result = SpeechBridge.ERR_MIC_BLOCKED;
        }
        speech.log("Berechtigung: " + result);
        flushMicWaiters(result);
    }

    private void flushMicWaiters(int result) {
        ArrayList<MicResult> list = new ArrayList<>(micWaiters);
        micWaiters.clear();
        for (MicResult cb : list) {
            try {
                cb.done(result);
            } catch (RuntimeException e) {
                speech.log("Mikrofon-Rückruf: " + e.getClass().getSimpleName());
            }
        }
    }

    /**
     * Web Speech API der WebView: Freigabe NUR für die App-Origin und NUR
     * für Audio, und erst nach erteilter Android-Laufzeitberechtigung
     * (der Erkennungsdienst prüft RECORD_AUDIO der App). Nie
     * grant(getResources()).
     */
    private void handleWebPermission(final PermissionRequest request) {
        Uri origin = request.getOrigin();
        String[] res = request.getResources();
        boolean appOrigin = origin != null && "https".equals(origin.getScheme())
                && APP_HOST.equals(origin.getHost());
        boolean audioOnly = res != null && res.length == 1
                && PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res[0]);
        if (!appOrigin || !audioOnly || destroyed) {
            request.deny();
            return;
        }
        if (pendingWebMic != null && pendingWebMic != request) {
            try {
                pendingWebMic.deny();
            } catch (RuntimeException ignored) { /* schon erledigt */ }
        }
        pendingWebMic = request;
        speech.log("WebView-Mikrofonanfrage");
        withMic(result -> {
            if (pendingWebMic != request) return; // zwischenzeitlich abgebrochen
            pendingWebMic = null;
            if (result == 0) {
                request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                request.deny();
            }
        });
    }

    /** App-Info-Seite in den Android-Einstellungen (eigene App oder Erkennungsdienst). */
    void openAppDetails(String packageName) {
        try {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", packageName, null)));
        } catch (RuntimeException e) {
            speech.log("Einstellungen: " + e.getClass().getSimpleName());
        }
    }
}
