// ====================================================================
// NotizbuchOpenLauncher.cs  (Notizbuch-App v7.37/v7.38)
// ====================================================================
// WARUM DIESE .EXE UEBERHAUPT EXISTIERT (Live-Befund, siehe DECISIONS.md
// #79 fuer die vollstaendige Fassung): Der urspruengliche Registry-Befehl
// fuer "notizbuch-open:" zeigte DIREKT auf powershell.exe (siehe
// notizbuch-open-setup.ps1, v7.35/v7.36). Windows selbst loeste das
// Protokoll dabei nachweislich korrekt auf (AssocQueryString lieferte
// rc=0, Start-Process mit der URL oeffnete die Datei zuverlaessig und
// schrieb einen Handler-Log-Eintrag) - trotzdem tat ein Klick im echten
// Chrome NICHTS: kein Handler-Log-Eintrag, kein Dialog, keine
// Konsolenmeldung, obwohl "beforeunload" feuerte (Chrome begann die
// Navigation also durchaus). Drei Kontrollmessungen (alle im echten
// Chrome) belegen die Ursache:
//   (a) Ein Link auf "ms-word:" zeigt SOFORT einen modalen
//       Bestaetigungsdialog.
//   (b) Ein eigens registriertes Wegwerf-Protokoll "notizbuch-probe" mit
//       IDENTISCHEM Registry-Aufbau, aber command =
//       "C:\WINDOWS\System32\notepad.exe" "%1" zeigt EBENFALLS sofort den
//       Dialog - selbst wenn es ERST NACH dem Chrome-Start registriert
//       wurde (widerlegt die Cache-/Neustart-Hypothese: Chrome erkennt
//       frisch registrierte Protokolle sofort).
//   (c) Der EINZIGE Unterschied zwischen (b) und dem echten
//       "notizbuch-open"-Protokoll ist das Ziel-Executable: notepad.exe
//       (ein "normales" Programm) vs. powershell.exe (ein
//       Skript-INTERPRETER).
// Schlussfolgerung: Chrome blockiert (mindestens auf diesem Stand)
// External-Protocol-Handler, deren Ziel-Executable ein bekannter
// Skript-Interpreter ist (powershell.exe, cmd.exe, wscript.exe, ...) -
// vermutlich eine Sicherheitsmassnahme gegen genau das Muster, das dieses
// Feature selbst nutzt (ein Link startet einen Interpreter mit einem vom
// Web kontrollierten Argument). Der Fix: ein SCHLANKER, eigener
// Launcher als .exe dazwischenschalten - Chrome sieht dann ein
// "normales" Programm als Protokoll-Ziel (wie notepad.exe in Kontrolle b)
// und zeigt den Erlaubnis-Dialog wie erwartet. Der Launcher selbst tut
// NICHTS ausser den bestehenden PowerShell-Handler zu starten - er
// enthaelt bewusst KEINE eigene Sicherheitspruefung (siehe unten), damit
// es weiterhin GENAU EINE Quelle der Wahrheit fuer die Validierung gibt
// (notizbuch-open-handler.ps1).
//
// SICHERHEIT: Dieser Launcher validiert die uebergebene URL NICHT selbst
// - er reicht sie unveraendert an den PowerShell-Handler durch, der
// bereits die VOLLSTAENDIGE Pruefung vornimmt (Praefix, Positivliste,
// Traversal, ADS, Shell-Namespace, ...). Eine zweite, eigene Pruefung HIER
// wuerde nur Code duplizieren und potenziell abweichende/veraltete Regeln
// einfuehren - der Handler bleibt die alleinige Autoritaet.
//
// KOMPILIERUNG: Wird von notizbuch-open-setup.ps1 zur Einrichtungszeit MIT
// dem im System bereits vorhandenen csc.exe (.NET Framework, kein
// zusaetzliches SDK noetig) kompiliert - siehe dort fuer die genaue
// Befehlszeile. /target:winexe verhindert ein Konsolenfenster.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class NotizbuchOpenLauncher
{
    [STAThread]
    private static void Main(string[] args)
    {
        // args[0] = die KOMPLETTE geklickte "notizbuch-open:..."-URL (von
        // Windows als "%1" uebergeben, siehe Registry-Befehl in
        // notizbuch-open-setup.ps1 - dort steht "%1" bereits in eigene
        // Anfuehrungszeichen gefasst, kommt hier also als EIN Argument an).
        if (args.Length < 1 || string.IsNullOrEmpty(args[0]))
        {
            ShowError("Kein Argument uebergeben (erwartet: die komplette " +
                "notizbuch-open:-URL als einziges Argument, von Windows " +
                "ueber \"%1\" eingesetzt).");
            return;
        }
        string url = args[0];

        // Handler-Skript NEBEN der eigenen .exe suchen (NICHT hartkodiert
        // geraten) - beide werden von notizbuch-open-setup.ps1 gemeinsam
        // nach "%LOCALAPPDATA%\NotizbuchOpen\" kopiert/kompiliert, bleiben
        // also immer im selben Ordner beieinander, unabhaengig vom
        // konkreten Installationspfad.
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string handlerPath = Path.Combine(baseDir, "notizbuch-open-handler.ps1");
        if (!File.Exists(handlerPath))
        {
            ShowError("Handler-Skript nicht gefunden:\n" + handlerPath +
                "\n\nDie Einrichtung (notizbuch-open-setup.ps1) scheint " +
                "unvollstaendig oder beschaedigt zu sein - bitte das Setup " +
                "erneut ausfuehren.");
            return;
        }

        // Windows PowerShell 5.1 EXPLIZIT ueber %SystemRoot% aufloesen -
        // derselbe Grund/dieselbe Stelle wie in notizbuch-open-setup.ps1
        // (der Handler ist bewusst gegen diese Engine geschrieben, u. a.
        // wegen des STA-Standard-Apartments fuer die eigene WinForms-
        // MessageBox dort).
        string systemRoot = Environment.GetEnvironmentVariable("SystemRoot");
        if (string.IsNullOrEmpty(systemRoot))
        {
            systemRoot = @"C:\Windows";
        }
        string powershellExe = Path.Combine(systemRoot, @"System32\WindowsPowerShell\v1.0\powershell.exe");
        if (!File.Exists(powershellExe))
        {
            ShowError("Windows PowerShell 5.1 wurde nicht gefunden unter:\n" +
                powershellExe + "\n\nOhne diese Engine kann der Handler " +
                "nicht gestartet werden.");
            return;
        }

        // Exakt derselbe Befehl, den notizbuch-open-setup.ps1 bisher DIREKT
        // in die Registry geschrieben hat (siehe DECISIONS.md #79) - nur
        // jetzt von DIESER .exe statt von Windows/Chrome direkt aufgerufen.
        string arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " +
            QuoteArgument(handlerPath) + " " + QuoteArgument(url);

        var psi = new ProcessStartInfo
        {
            FileName = powershellExe,
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };

        try
        {
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            ShowError("Der PowerShell-Handler konnte nicht gestartet werden:\n" + ex.Message);
        }
    }

    private static void ShowError(string message)
    {
        MessageBox.Show(message, "Notizbuch - Link oeffnen",
            MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    // Windows-konforme Kommandozeilen-Quotierung eines EINZELNEN Arguments
    // (dasselbe Verfahren wie CommandLineToArgvW/die .NET-interne
    // Argument-Zusammensetzung erwartet): Pfad UND URL koennen Leerzeichen
    // enthalten (siehe QUOTED_WIN_PATH_RE-Feature, v7.37 - genau DAFUER
    // muss das hier robust sein), die URL enthaelt nach unserem eigenen
    // Kontrakt zwar NIE ein rohes Anfuehrungszeichen (encodeURIComponent
    // kodiert es zu "%22"), wird hier aber TROTZDEM defensiv escaped, statt
    // sich auf diese Annahme zu verlassen (der Launcher bekommt die URL von
    // aussen/vom Betriebssystem, nicht garantiert nur von unserer eigenen
    // App).
    private static string QuoteArgument(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
        {
            return arg; // kein Sonderzeichen enthalten - Quoting nicht noetig
        }

        var sb = new StringBuilder();
        sb.Append('"');
        for (int i = 0; i < arg.Length; i++)
        {
            int backslashCount = 0;
            while (i < arg.Length && arg[i] == '\\')
            {
                backslashCount++;
                i++;
            }
            if (i == arg.Length)
            {
                // Backslashes unmittelbar VOR dem schliessenden Anfuehrungs-
                // zeichen muessen verdoppelt werden, sonst wuerden sie DAS
                // Anfuehrungszeichen selbst maskieren statt es abzuschliessen.
                sb.Append('\\', backslashCount * 2);
                break;
            }
            if (arg[i] == '"')
            {
                // Backslashes VOR einem echten Anfuehrungszeichen im Inhalt:
                // verdoppeln PLUS ein zusaetzlicher Backslash, um DAS
                // Anfuehrungszeichen selbst zu maskieren.
                sb.Append('\\', backslashCount * 2 + 1);
                sb.Append('"');
            }
            else
            {
                // Backslashes ohne folgendes Anfuehrungszeichen sind ganz
                // normale, unveraenderte Pfadtrenner.
                sb.Append('\\', backslashCount);
                sb.Append(arg[i]);
            }
        }
        sb.Append('"');
        return sb.ToString();
    }
}
