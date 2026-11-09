# Mesure du trafic reseau par application, pour PC Deck.
# Ecoute les evenements reseau de Windows (ETW, fournisseur "Microsoft-Windows-Kernel-Network",
# le meme que le Moniteur de ressources) et ecrit chaque seconde une ligne JSON :
#   {"apps":[{"name":"opera","down":12345,"up":678}, ...]}   (octets par seconde)
# ou {"error":"access"} si Windows refuse (il faut etre administrateur ou membre
# du groupe "Utilisateurs du journal de performances").
param([int]$ParentPid = 0)

$code = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace PcDeckNet {
  public static class Monitor {
    const string SessionName = "PCDeckNetwork";
    static readonly Guid KernelNetwork = new Guid("7DD42A49-5329-4832-8DFD-43D979153A88");

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int StartTrace(out ulong handle, string name, IntPtr properties);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int ControlTrace(ulong handle, string name, IntPtr properties, uint code);
    [DllImport("advapi32.dll")]
    static extern int EnableTraceEx2(ulong handle, ref Guid provider, uint control, byte level,
      ulong matchAny, ulong matchAll, uint timeout, IntPtr parameters);
    [DllImport("advapi32.dll")]
    static extern ulong OpenTrace(IntPtr logfile);
    [DllImport("advapi32.dll")]
    static extern int ProcessTrace(ulong[] handles, uint count, IntPtr start, IntPtr end);
    [DllImport("advapi32.dll")]
    static extern int CloseTrace(ulong handle);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate void EventRecordCallback(IntPtr record);
    static EventRecordCallback callback; // garde la reference (sinon le ramasse-miettes la supprime)

    static readonly object sync = new object();
    static Dictionary<int, long[]> bytes = new Dictionary<int, long[]>();
    static readonly Dictionary<int, string> names = new Dictionary<int, string>();

    // EVENT_TRACE_PROPERTIES (120 octets en 64 bits) suivi du nom de la session
    static IntPtr NewProperties() {
      int size = 120 + 1024;
      IntPtr p = Marshal.AllocHGlobal(size);
      for (int i = 0; i < size; i++) Marshal.WriteByte(p, i, 0);
      Marshal.WriteInt32(p, 0, size);          // Wnode.BufferSize
      Marshal.WriteInt32(p, 40, 1);            // Wnode.ClientContext = horloge QPC
      Marshal.WriteInt32(p, 44, 0x00020000);   // Wnode.Flags = WNODE_FLAG_TRACED_GUID
      Marshal.WriteInt32(p, 48, 64);           // BufferSize (Ko)
      Marshal.WriteInt32(p, 64, 0x00000100);   // LogFileMode = EVENT_TRACE_REAL_TIME_MODE
      Marshal.WriteInt32(p, 68, 1);            // FlushTimer = 1 s
      Marshal.WriteInt32(p, 116, 120);         // LoggerNameOffset
      return p;
    }

    static void Stop() {
      IntPtr p = NewProperties();
      ControlTrace(0, SessionName, p, 1); // EVENT_TRACE_CONTROL_STOP
      Marshal.FreeHGlobal(p);
    }

    static void OnEvent(IntPtr record) {
      // EVENT_RECORD : Id a l'octet 40, UserDataLength a 86, UserData a 96
      int id = Marshal.ReadInt16(record, 40);
      int dir; // 0 = recu, 1 = envoye
      switch (id) {
        case 10: case 26: case 42: case 58: dir = 1; break; // TCP/UDP, IPv4/IPv6, envoi
        case 11: case 27: case 43: case 59: dir = 0; break; // reception
        default: return;
      }
      int length = Marshal.ReadInt16(record, 86);
      IntPtr data = Marshal.ReadIntPtr(record, 96);
      if (data == IntPtr.Zero || length < 16) return;
      int pid = Marshal.ReadInt32(data, 0);
      int size = Marshal.ReadInt32(data, 4);
      // IPv4 : on ignore le trafic interne au PC (127.x.x.x)
      if (id == 10 || id == 11 || id == 42 || id == 43) {
        if ((Marshal.ReadInt32(data, 8) & 0xFF) == 127) return;
      }
      lock (sync) {
        long[] v;
        if (!bytes.TryGetValue(pid, out v)) { v = new long[2]; bytes[pid] = v; }
        v[dir] += size;
      }
    }

    static string NameOf(int pid) {
      string n;
      if (names.TryGetValue(pid, out n)) return n;
      if (pid == 0) n = "Systeme (inactif)";
      else if (pid == 4) n = "System";
      else {
        try { n = Process.GetProcessById(pid).ProcessName; } catch { n = "Processus " + pid; }
      }
      names[pid] = n;
      return n;
    }

    static string Json(string s) {
      return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    public static void Run(int parentPid) {
      Stop(); // session laissee ouverte par un arret brutal precedent
      IntPtr props = NewProperties();
      ulong session;
      int err = StartTrace(out session, SessionName, props);
      if (err != 0) {
        Console.WriteLine(err == 5 ? "{\"error\":\"access\"}" : "{\"error\":\"start " + err + "\"}");
        return;
      }
      Guid provider = KernelNetwork;
      // mots-cles 0x10 (IPv4) et 0x20 (IPv6), niveau 5 (detaille)
      err = EnableTraceEx2(session, ref provider, 1, 5, 0x30, 0, 0, IntPtr.Zero);
      if (err != 0) {
        Console.WriteLine(err == 5 ? "{\"error\":\"access\"}" : "{\"error\":\"enable " + err + "\"}");
        Stop();
        return;
      }

      // EVENT_TRACE_LOGFILE (448 octets en 64 bits)
      IntPtr logfile = Marshal.AllocHGlobal(448);
      for (int i = 0; i < 448; i++) Marshal.WriteByte(logfile, i, 0);
      Marshal.WriteIntPtr(logfile, 8, Marshal.StringToHGlobalUni(SessionName));       // LoggerName
      Marshal.WriteInt32(logfile, 28, 0x00000100 | 0x10000000);                        // temps reel + EVENT_RECORD
      callback = new EventRecordCallback(OnEvent);
      Marshal.WriteIntPtr(logfile, 424, Marshal.GetFunctionPointerForDelegate(callback)); // EventRecordCallback
      ulong trace = OpenTrace(logfile);
      if (trace == ulong.MaxValue) {
        Console.WriteLine("{\"error\":\"open " + Marshal.GetLastWin32Error() + "\"}");
        Stop();
        return;
      }
      Thread reader = new Thread(delegate () { ProcessTrace(new ulong[] { trace }, 1, IntPtr.Zero, IntPtr.Zero); });
      reader.IsBackground = true;
      reader.Start();

      try {
        while (true) {
          Thread.Sleep(1000);
          if (parentPid > 0) {
            try { if (Process.GetProcessById(parentPid).HasExited) break; } catch { break; }
          }
          Dictionary<int, long[]> snapshot;
          lock (sync) { snapshot = bytes; bytes = new Dictionary<int, long[]>(); }

          // Regroupe par nom de programme (ex. tous les processus "opera")
          Dictionary<string, long[]> byName = new Dictionary<string, long[]>();
          foreach (KeyValuePair<int, long[]> kv in snapshot) {
            string n = NameOf(kv.Key);
            long[] t;
            if (!byName.TryGetValue(n, out t)) { t = new long[2]; byName[n] = t; }
            t[0] += kv.Value[0]; t[1] += kv.Value[1];
          }
          List<KeyValuePair<string, long[]>> list = new List<KeyValuePair<string, long[]>>(byName);
          list.Sort(delegate (KeyValuePair<string, long[]> a, KeyValuePair<string, long[]> b) {
            return (b.Value[0] + b.Value[1]).CompareTo(a.Value[0] + a.Value[1]);
          });
          StringBuilder sb = new StringBuilder("{\"apps\":[");
          for (int i = 0; i < list.Count && i < 8; i++) {
            if (i > 0) sb.Append(',');
            sb.Append("{\"name\":").Append(Json(list[i].Key))
              .Append(",\"down\":").Append(list[i].Value[0])
              .Append(",\"up\":").Append(list[i].Value[1]).Append('}');
          }
          sb.Append("]}");
          Console.WriteLine(sb.ToString());
          if (names.Count > 2000) names.Clear(); // les PID sont reutilises
        }
      } finally {
        Stop();
        CloseTrace(trace);
      }
    }
  }
}
'@
Add-Type -TypeDefinition $code
[PcDeckNet.Monitor]::Run($ParentPid)
