# Mesure du processeur et de la memoire par application, pour PC Deck.
# Utilise la meme source que le Gestionnaire des taches (NtQuerySystemInformation),
# qui voit tous les programmes, y compris ceux lances en administrateur.
# Ecrit toutes les 2 secondes une ligne JSON :
#   {"cpu":[{"name":"opera","percent":3.2},...],"mem":[{"name":"opera","bytes":123456},...]}
# - percent : part de TOUT le processeur (tous les coeurs), comme le Gestionnaire des taches
# - bytes   : memoire privee (colonne "Memoire" du Gestionnaire des taches)
# Les processus d'un meme programme (ex. les nombreux "opera") sont additionnes.
param([int]$ParentPid = 0)

$code = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace PcDeckProc {
  public static class Monitor {
    [DllImport("ntdll.dll")]
    static extern int NtQuerySystemInformation(int infoClass, IntPtr buffer, int length, out int needed);

    struct Sample { public string Name; public long Cpu; public long Mem; }

    // pid -> (nom, temps processeur cumule en 100 ns, memoire privee)
    static Dictionary<long, Sample> Read() {
      int size = 1 << 20;
      IntPtr buf = IntPtr.Zero;
      int needed;
      while (true) {
        buf = Marshal.AllocHGlobal(size);
        int status = NtQuerySystemInformation(5, buf, size, out needed); // SystemProcessInformation
        if (status == unchecked((int)0xC0000004)) { Marshal.FreeHGlobal(buf); size = Math.Max(size * 2, needed + 65536); continue; }
        if (status != 0) { Marshal.FreeHGlobal(buf); throw new Exception("NtQuerySystemInformation " + status); }
        break;
      }
      Dictionary<long, Sample> result = new Dictionary<long, Sample>();
      try {
        int offset = 0;
        while (true) {
          IntPtr p = new IntPtr(buf.ToInt64() + offset);
          int next = Marshal.ReadInt32(p, 0);
          long privateWs = Marshal.ReadInt64(p, 8);
          long user = Marshal.ReadInt64(p, 40);
          long kernel = Marshal.ReadInt64(p, 48);
          int nameLength = Marshal.ReadInt16(p, 56);
          IntPtr nameBuf = Marshal.ReadIntPtr(p, 64);
          long pid = Marshal.ReadIntPtr(p, 80).ToInt64();
          if (pid != 0 && nameBuf != IntPtr.Zero && nameLength > 0) {
            string name = Marshal.PtrToStringUni(nameBuf, nameLength / 2);
            if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name.Substring(0, name.Length - 4);
            Sample s; s.Name = name; s.Cpu = user + kernel; s.Mem = privateWs;
            result[pid] = s;
          }
          if (next == 0) break;
          offset += next;
        }
      } finally {
        Marshal.FreeHGlobal(buf);
      }
      return result;
    }

    static string Json(string s) {
      return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    public static void Run(int parentPid) {
      int cores = Environment.ProcessorCount;
      Dictionary<long, Sample> previous = Read();
      Stopwatch clock = Stopwatch.StartNew();
      while (true) {
        Thread.Sleep(2000);
        if (parentPid > 0) {
          try { if (Process.GetProcessById(parentPid).HasExited) break; } catch { break; }
        }
        Dictionary<long, Sample> now = Read();
        double elapsed = clock.Elapsed.TotalMilliseconds * 10000.0; // en unites de 100 ns
        clock.Restart();

        Dictionary<string, double> cpu = new Dictionary<string, double>();
        Dictionary<string, long> mem = new Dictionary<string, long>();
        foreach (KeyValuePair<long, Sample> kv in now) {
          Sample s = kv.Value;
          Sample before;
          if (previous.TryGetValue(kv.Key, out before) && before.Name == s.Name && s.Cpu >= before.Cpu) {
            double pct = (s.Cpu - before.Cpu) / (elapsed * cores) * 100.0;
            double c; cpu.TryGetValue(s.Name, out c); cpu[s.Name] = c + pct;
          }
          long m; mem.TryGetValue(s.Name, out m); mem[s.Name] = m + s.Mem;
        }
        previous = now;

        List<KeyValuePair<string, double>> topCpu = new List<KeyValuePair<string, double>>(cpu);
        topCpu.Sort(delegate (KeyValuePair<string, double> a, KeyValuePair<string, double> b) { return b.Value.CompareTo(a.Value); });
        List<KeyValuePair<string, long>> topMem = new List<KeyValuePair<string, long>>(mem);
        topMem.Sort(delegate (KeyValuePair<string, long> a, KeyValuePair<string, long> b) { return b.Value.CompareTo(a.Value); });

        StringBuilder sb = new StringBuilder("{\"cpu\":[");
        for (int i = 0; i < topCpu.Count && i < 8; i++) {
          if (i > 0) sb.Append(',');
          sb.Append("{\"name\":").Append(Json(topCpu[i].Key)).Append(",\"percent\":")
            .Append(Math.Round(topCpu[i].Value, 1).ToString(System.Globalization.CultureInfo.InvariantCulture)).Append('}');
        }
        sb.Append("],\"mem\":[");
        for (int i = 0; i < topMem.Count && i < 8; i++) {
          if (i > 0) sb.Append(',');
          sb.Append("{\"name\":").Append(Json(topMem[i].Key)).Append(",\"bytes\":").Append(topMem[i].Value).Append('}');
        }
        sb.Append("]}");
        Console.WriteLine(sb.ToString());
      }
    }
  }
}
'@
Add-Type -TypeDefinition $code
[PcDeckProc.Monitor]::Run($ParentPid)
