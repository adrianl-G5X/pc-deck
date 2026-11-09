// PC Deck.exe : l'icône près de l'horloge (version compilée de tools\tray.ps1).
// - lance le serveur (Node fourni) sans fenêtre, le relance s'il s'arrête ;
// - menu : connecter un appareil, réseau « Public », mise à jour, paramètres, ouvrir, journal,
//   redémarrer, quitter ;
// - démarrage avec Windows selon le réglage "autostart" de config.json.
// C# 5 (compilateur fourni avec Windows). Construit par installer\build.ps1.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PcDeckTray {
static class Program {
    [STAThread]
    static void Main() {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new TrayApp());
    }
}

class TrayApp : ApplicationContext {
    readonly string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    readonly string exePath = Application.ExecutablePath;
    readonly string dataDir, logOut, logErr, serverJs, node;
    readonly NotifyIcon tray = new NotifyIcon();
    readonly Control ui = new Control(); // pour revenir sur le fil de l'interface
    readonly ToolStripMenuItem itemNet, itemUpdate;
    readonly System.Windows.Forms.Timer watch = new System.Windows.Forms.Timer();
    readonly System.Windows.Forms.Timer updTimer = new System.Windows.Forms.Timer();
    Process server;
    StreamWriter outWriter, errWriter;
    bool quitting;
    string notified = "";
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    public TrayApp() {
        ui.CreateControl();
        string custom = Environment.GetEnvironmentVariable("PCDECK_DATA");
        dataDir = !string.IsNullOrEmpty(custom) ? custom
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PC Deck");
        Directory.CreateDirectory(dataDir);
        logOut = Path.Combine(dataDir, "server.log");
        logErr = Path.Combine(dataDir, "server-erreurs.log");
        serverJs = Path.Combine(root, "server", "server.js");
        string bundled = Path.Combine(root, "runtime", "node.exe");
        node = File.Exists(bundled) ? bundled : "node.exe";

        StopOthers();

        // ---------- Icône et menu ----------
        try {
            using (Bitmap png = new Bitmap(Path.Combine(root, "client", "icons", "icon-192.png")))
            using (Bitmap small = new Bitmap(png, 32, 32))
                tray.Icon = Icon.FromHandle(small.GetHicon());
        } catch { tray.Icon = SystemIcons.Application; }
        tray.Text = "PC Deck - en marche";
        ContextMenuStrip menu = new ContextMenuStrip();
        ToolStripMenuItem version = new ToolStripMenuItem("PC Deck " + ReadVersion()) { Enabled = false };
        ToolStripMenuItem connect = new ToolStripMenuItem("Connecter une tablette ou un téléphone...");
        connect.Font = new Font(connect.Font, FontStyle.Bold);
        connect.Click += delegate { OpenPage("/connect"); };
        itemNet = new ToolStripMenuItem("Réseau « Public » : autoriser la tablette...") { Visible = false };
        itemNet.Click += delegate { FixPublicNetwork(); };
        itemUpdate = new ToolStripMenuItem("Installer la mise à jour") { Visible = false };
        itemUpdate.Click += delegate { InstallUpdate(); };
        ToolStripMenuItem settings = new ToolStripMenuItem("Paramètres...");
        settings.Click += delegate { OpenPage("/settings"); };
        ToolStripMenuItem open = new ToolStripMenuItem("Ouvrir PC Deck");
        open.Click += delegate { OpenPage("/"); };
        ToolStripMenuItem log = new ToolStripMenuItem("Voir le journal");
        log.Click += delegate { Process.Start("notepad.exe", "\"" + logOut + "\""); };
        ToolStripMenuItem restart = new ToolStripMenuItem("Redémarrer le serveur");
        restart.Click += delegate { StopServer(); Thread.Sleep(500); StartServer(); tray.ShowBalloonTip(2000, "PC Deck", "Serveur redémarré.", ToolTipIcon.Info); };
        ToolStripMenuItem quit = new ToolStripMenuItem("Quitter PC Deck");
        quit.Click += delegate { Quit(); };
        menu.Items.AddRange(new ToolStripItem[] { version, connect, itemNet, itemUpdate, new ToolStripSeparator(), settings, open, log, restart, new ToolStripSeparator(), quit });
        menu.Opening += delegate { itemNet.Visible = PublicNetworks().Count > 0; };
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { OpenPage("/"); };
        tray.Visible = true;

        // ---------- Démarrage ----------
        SyncAutostart();
        StartServer();
        watch.Interval = 3000;
        watch.Tick += delegate { if (!quitting && (server == null || server.HasExited)) { tray.Text = "PC Deck - redémarrage..."; StartServer(); tray.Text = "PC Deck - en marche"; } };
        watch.Start();
        updTimer.Interval = 2 * 60 * 1000;
        updTimer.Tick += delegate { updTimer.Interval = 60 * 60 * 1000; CheckUpdate(); };
        updTimer.Start();

        // Aucun appareil encore connecté (juste après l'installation) : page de connexion
        if (CountDevices() == 0) {
            System.Windows.Forms.Timer first = new System.Windows.Forms.Timer { Interval = 5000 };
            first.Tick += delegate { first.Stop(); OpenPage("/connect"); };
            first.Start();
        }
        if (PublicNetworks().Count > 0)
            tray.ShowBalloonTip(8000, "PC Deck", "Réseau de type « Public » : la tablette ne peut pas se connecter. Clic droit sur l'icône PC Deck pour corriger.", ToolTipIcon.Warning);
        else if (Process.GetProcessesByName("LibreHardwareMonitor").Length == 0)
            tray.ShowBalloonTip(5000, "PC Deck", "LibreHardwareMonitor n'est pas lancé : températures et consommation indisponibles.", ToolTipIcon.Warning);
        else
            tray.ShowBalloonTip(2500, "PC Deck", "PC Deck tourne en arrière-plan (icône près de l'horloge).", ToolTipIcon.Info);
    }

    // ---------- Serveur ----------
    // Une seule icône par installation : ferme l'ancienne icône et l'ancien serveur de CE dossier
    void StopOthers() {
        int me = Process.GetCurrentProcess().Id;
        foreach (Process p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(exePath))) {
            try { if (p.Id != me && string.Equals(p.MainModule.FileName, exePath, StringComparison.OrdinalIgnoreCase)) p.Kill(); } catch { }
        }
        StopServer();
    }

    void StopServer() {
        try {
            using (ManagementObjectSearcher s = new ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='node.exe'"))
                foreach (ManagementObject o in s.Get()) {
                    string cmd = o["CommandLine"] as string;
                    if (cmd != null && cmd.IndexOf(serverJs, StringComparison.OrdinalIgnoreCase) >= 0)
                        try { Process.GetProcessById(Convert.ToInt32(o["ProcessId"])).Kill(); } catch { }
                }
        } catch { }
    }

    void StartServer() {
        if (outWriter != null) { outWriter.Dispose(); errWriter.Dispose(); }
        outWriter = new StreamWriter(logOut, false, new UTF8Encoding(false)) { AutoFlush = true };
        errWriter = new StreamWriter(logErr, false, new UTF8Encoding(false)) { AutoFlush = true };
        ProcessStartInfo psi = new ProcessStartInfo(node, "\"" + serverJs + "\"") {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        server = new Process { StartInfo = psi };
        StreamWriter o = outWriter, e = errWriter;
        server.OutputDataReceived += (s, a) => { if (a.Data != null) lock (o) { try { o.WriteLine(a.Data); } catch { } } };
        server.ErrorDataReceived += (s, a) => { if (a.Data != null) lock (e) { try { e.WriteLine(a.Data); } catch { } } };
        try {
            server.Start();
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
        } catch (Exception ex) {
            server = null;
            tray.ShowBalloonTip(8000, "PC Deck", "Le serveur ne démarre pas : " + ex.Message, ToolTipIcon.Error);
        }
    }

    void Quit() {
        quitting = true;
        watch.Stop();
        StopServer();
        tray.Visible = false;
        tray.Dispose();
        ExitThread();
    }

    // ---------- Réglages ----------
    Dictionary<string, object> ReadJson(string file) {
        try { return Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8).TrimStart('﻿')); }
        catch { return null; }
    }

    string ReadVersion() {
        Dictionary<string, object> pkg = ReadJson(Path.Combine(root, "package.json"));
        return pkg != null && pkg.ContainsKey("version") ? Convert.ToString(pkg["version"]) : "?";
    }

    Dictionary<string, object> Config() {
        return ReadJson(Path.Combine(dataDir, "config.json")) ?? ReadJson(Path.Combine(root, "config.default.json"));
    }

    int Port() {
        try {
            Dictionary<string, object> srv = Config()["server"] as Dictionary<string, object>;
            if (srv != null && srv.ContainsKey("port")) return Convert.ToInt32(srv["port"]);
        } catch { }
        return 8787;
    }

    // "autostart" : true = lancé à l'ouverture de session, false = plus lancé, absent = inchangé
    void SyncAutostart() {
        try {
            Dictionary<string, object> cfg = Config();
            if (cfg == null || !cfg.ContainsKey("autostart") || !(cfg["autostart"] is bool)) return;
            using (RegistryKey run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true)) {
                if ((bool)cfg["autostart"]) run.SetValue("PCDeck", "\"" + exePath + "\"");
                else run.DeleteValue("PCDeck", false);
            }
        } catch { }
    }

    int CountDevices() {
        try {
            object[] list = Json.DeserializeObject(File.ReadAllText(Path.Combine(dataDir, "devices.json"), Encoding.UTF8).TrimStart('﻿')) as object[];
            return list == null ? 0 : list.Length;
        } catch { return 0; }
    }

    void OpenPage(string page) {
        try { Process.Start("http://localhost:" + Port() + page); } catch { }
    }

    // ---------- Réseau « Public » (Windows y bloque PC Deck) ----------
    List<string> PublicNetworks() {
        List<string> list = new List<string>();
        try {
            using (ManagementObjectSearcher s = new ManagementObjectSearcher(@"root\StandardCimv2", "SELECT InterfaceAlias, NetworkCategory FROM MSFT_NetConnectionProfile"))
                foreach (ManagementObject o in s.Get()) {
                    string alias = Convert.ToString(o["InterfaceAlias"]);
                    if (Convert.ToInt32(o["NetworkCategory"]) == 0 && alias.IndexOf("Tailscale", StringComparison.OrdinalIgnoreCase) < 0) list.Add(alias);
                }
        } catch { }
        return list;
    }

    void FixPublicNetwork() {
        List<string> names = PublicNetworks();
        if (names.Count == 0) return;
        DialogResult answer = MessageBox.Show(
            "Votre réseau est de type « Public » : " + string.Join(", ", names) + ".\n\nWindows y bloque PC Deck, la tablette ne peut pas se connecter.\n\n" +
            "S'il s'agit du réseau de votre maison, le passer en « Privé » ?\nRépondez Non sur un Wi-Fi public (café, gare, hôtel...).",
            "PC Deck", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (answer != DialogResult.Yes) return;
        List<string> quoted = new List<string>();
        foreach (string n in names) quoted.Add("'" + n.Replace("'", "''") + "'");
        try {
            Process p = Process.Start(new ProcessStartInfo("powershell.exe",
                "-NoProfile -WindowStyle Hidden -Command \"Set-NetConnectionProfile -InterfaceAlias " + string.Join(",", quoted) + " -NetworkCategory Private\"") {
                Verb = "runas", UseShellExecute = true, WindowStyle = ProcessWindowStyle.Hidden,
            });
            p.WaitForExit(30000);
        } catch (Win32Exception) { return; } // autorisation refusée
        if (PublicNetworks().Count == 0) tray.ShowBalloonTip(3000, "PC Deck", "Réseau passé en Privé : la tablette peut se connecter.", ToolTipIcon.Info);
    }

    // ---------- Mises à jour (vérifiées par le serveur, signées) ----------
    void CheckUpdate() {
        ThreadPool.QueueUserWorkItem(delegate {
            try {
                string text;
                using (WebClient w = new WebClient { Encoding = Encoding.UTF8 }) text = w.DownloadString("http://localhost:" + Port() + "/api/update");
                Dictionary<string, object> u = Json.Deserialize<Dictionary<string, object>>(text);
                bool available = u.ContainsKey("available") && u["available"] is bool && (bool)u["available"];
                string latest = u.ContainsKey("latest") ? Convert.ToString(u["latest"]) : "";
                ui.BeginInvoke((MethodInvoker)delegate {
                    itemUpdate.Visible = available;
                    if (!available) return;
                    itemUpdate.Text = "Installer la mise à jour " + latest;
                    if (notified != latest) {
                        notified = latest;
                        tray.ShowBalloonTip(10000, "PC Deck", "Nouvelle version " + latest + " disponible. Clic droit sur l'icône PC Deck pour l'installer.", ToolTipIcon.Info);
                    }
                });
            } catch { }
        });
    }

    void InstallUpdate() {
        DialogResult answer = MessageBox.Show(
            "Installer la nouvelle version de PC Deck ?\n\nTes réglages et tes appareils sont gardés. Windows va demander l'autorisation, puis PC Deck redémarrera tout seul.",
            "PC Deck", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (answer != DialogResult.Yes) return;
        tray.ShowBalloonTip(5000, "PC Deck", "Téléchargement de la mise à jour...", ToolTipIcon.Info);
        ThreadPool.QueueUserWorkItem(delegate {
            try {
                using (WebClient w = new WebClient { Encoding = Encoding.UTF8 }) w.UploadString("http://localhost:" + Port() + "/api/update/install", "POST", "");
            } catch (WebException ex) {
                string detail = ex.Message;
                try { using (StreamReader r = new StreamReader(ex.Response.GetResponseStream())) detail = r.ReadToEnd(); } catch { }
                ui.BeginInvoke((MethodInvoker)delegate { MessageBox.Show("La mise à jour n'a pas pu être installée :\n" + detail, "PC Deck"); });
            }
        });
    }
}
}
