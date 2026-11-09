// Points d'entrée des programmes compilés (pcdeck-keys.exe, pcdeck-screen.exe, pcdeck-netmon.exe,
// pcdeck-procmon.exe). Le code qui fait le travail est celui des scripts server\*.ps1 (extrait à la
// construction) : mêmes ordres reçus sur l'entrée standard, mêmes réponses. Langage : C# 5.
// Compilé avec /define:KEYS, SCREEN, NETMON ou PROCMON pour garder un seul fichier.
using System;
using System.Globalization;
using System.Text;

namespace PcDeckHelpers {
static class Program {
    [STAThread]
    static int Main(string[] args) {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
#if KEYS
        PcDeck.Windows.UseRealPixels();
        Console.Out.WriteLine("ready");
        string line;
        while ((line = Console.In.ReadLine()) != null) {
            string reply;
            try {
                string[] p = line.Split(' ');
                switch (p[0]) {
                    case "keys": {
                        string[] codes = p[1].Split(',');
                        int[] keys = new int[codes.Length];
                        for (int i = 0; i < codes.Length; i++) keys[i] = int.Parse(codes[i]);
                        PcDeck.Keyboard.Press(keys);
                        reply = "ok";
                        break;
                    }
                    case "appvol":
                        reply = PcDeck.AppVolume.Change(p[3].Split('|'), p[1], int.Parse(p[2]));
                        break;
                    case "window":
                        reply = PcDeck.Windows.Show(p[2].ToLowerInvariant().Split('|'), p[1], p.Length > 3 ? string.Join(" ", p, 3, p.Length - 3) : "");
                        break;
                    case "osd":
                        PcDeck.Osd.Show(p.Length > 3 ? string.Join(" ", p, 3, p.Length - 3) : "", int.Parse(p[1]), p[2] == "1");
                        reply = "ok";
                        break;
                    case "sysvol":
                        reply = PcDeck.AppVolume.ChangeSystem(p[1], int.Parse(p[2]));
                        break;
                    default:
                        reply = "error ordre inconnu";
                        break;
                }
            } catch (Exception e) {
                reply = "error " + System.Text.RegularExpressions.Regex.Replace(e.Message, @"\s+", " ");
            }
            Console.Out.WriteLine(reply);
        }
#elif SCREEN
        PcDeckScreen.Remote.Init();
        CultureInfo inv = CultureInfo.InvariantCulture;
        string line;
        while ((line = Console.In.ReadLine()) != null) {
            string[] p = line.Trim().Split(' ');
            try {
                switch (p[0]) {
                    case "mon": Console.Out.WriteLine("J {\"monitors\":" + PcDeckScreen.Remote.Monitors() + "}"); break;
                    case "cap": {
                        string img = PcDeckScreen.Remote.Capture(int.Parse(p[1]), int.Parse(p[2]), long.Parse(p[3]), p.Length > 4 && p[4] == "force");
                        Console.Out.WriteLine(img == null ? "S" : "F " + img);
                        break;
                    }
                    case "move": PcDeckScreen.Remote.Move(int.Parse(p[1]), double.Parse(p[2], inv), double.Parse(p[3], inv)); break;
                    case "btn": PcDeckScreen.Remote.Button(p[1], p[2] == "down"); break;
                    case "wheel": PcDeckScreen.Remote.Wheel(int.Parse(p[1])); break;
                    case "key": PcDeckScreen.Remote.Key(int.Parse(p[1]), p[2] == "down"); break;
                    case "text": PcDeckScreen.Remote.Text(Encoding.UTF8.GetString(Convert.FromBase64String(p[1]))); break;
                }
            } catch {
                if (p[0] == "cap") Console.Out.WriteLine("E capture");
            }
            Console.Out.Flush();
        }
#elif NETMON
        PcDeckNet.Monitor.Run(args.Length > 0 ? int.Parse(args[0]) : 0);
#elif PROCMON
        PcDeckProc.Monitor.Run(args.Length > 0 ? int.Parse(args[0]) : 0);
#endif
        return 0;
    }
}
}
