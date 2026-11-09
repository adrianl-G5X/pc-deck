# Petit programme Windows pour PC Deck. Il reste ouvert et recoit des ordres,
# un par ligne, envoyes par le serveur :
#   keys 17,16,27              -> appuie sur Ctrl+Maj+Echap (codes de touches)
#   appvol up 2 opera|xyz      -> monte le volume de ces programmes au multiple de 2 % suivant
#   appvol down 2 opera        -> baisse au multiple de 2 % precedent
#   appvol mute 0 opera        -> coupe / remet le son
#   sysvol up 2 / sysvol down 2 / sysvol mute 0  -> pareil pour le volume de Windows
# Il repond une ligne : "ok", "ok:<volume %>:<muet 0/1>", "notfound" ou "error ...".

$code = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace PcDeck {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorCo {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams,
      [MarshalAs(UnmanagedType.IUnknown)] out object result);
  }

  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl();
    int GetSimpleAudioVolume();
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
  }

  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
  }

  [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState();
    int GetDisplayName();
    int SetDisplayName();
    int GetIconPath();
    int SetIconPath();
    int GetGroupingParam();
    int SetGroupingParam();
    int RegisterAudioSessionNotification();
    int UnregisterAudioSessionNotification();
    int GetSessionIdentifier();
    int GetSessionInstanceIdentifier();
    [PreserveSig] int GetProcessId(out uint pid);
  }

  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify();
    int UnregisterControlChangeNotify();
    int GetChannelCount();
    int SetMasterVolumeLevel();
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
    int GetMasterVolumeLevel();
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel();
    int SetChannelVolumeLevelScalar();
    int GetChannelVolumeLevel();
    int GetChannelVolumeLevelScalar();
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float level, ref Guid context);
    [PreserveSig] int GetMasterVolume(out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  public static class Keyboard {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    static uint Extended(int vk) {
      bool ext = (vk >= 0x21 && vk <= 0x2E) || (vk >= 0xA6 && vk <= 0xB7) || vk == 0x5B || vk == 0x5C;
      return ext ? 1u : 0u;
    }

    [DllImport("user32.dll")]
    static extern uint MapVirtualKey(uint code, uint mapType);

    // Taper un texte (accents compris) : touches "Unicode" de SendInput
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit, Size = 40)] struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; }
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    public static void Type(string text) {
      foreach (char ch in text) {
        INPUT[] inp = new INPUT[2];
        for (int k = 0; k < 2; k++) { inp[k].type = 1; inp[k].ki.scan = ch; inp[k].ki.flags = 0x0004u | (k == 1 ? 0x0002u : 0u); }
        SendInput(2, inp, 40);
        System.Threading.Thread.Sleep(5);
      }
    }

    // Appui "realiste" : vrai code physique de la touche (scan code) et petites pauses,
    // sinon certains logiciels (ex. raccourcis globaux de Discord) ne voient rien.
    public static void Press(int[] codes) {
      foreach (int c in codes) {
        keybd_event((byte)c, (byte)MapVirtualKey((uint)c, 0), Extended(c), UIntPtr.Zero);
        System.Threading.Thread.Sleep(15);
      }
      System.Threading.Thread.Sleep(60);
      for (int i = codes.Length - 1; i >= 0; i--) {
        int c = codes[i];
        keybd_event((byte)c, (byte)MapVirtualKey((uint)c, 0), 2u | Extended(c), UIntPtr.Zero);
        System.Threading.Thread.Sleep(15);
      }
    }
  }

  // Fenetres : retrouver celle d'un programme, l'afficher en grand, la deplacer d'ecran.
  public static class Windows {
    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr data);
    delegate bool MonitorEnumProc(IntPtr monitor, IntPtr hdc, IntPtr rect, IntPtr data);

    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct WINDOWPLACEMENT {
      public int length, flags, showCmd; public POINT minPos, maxPos; public RECT normalPos;
    }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO {
      public int cbSize; public RECT monitor, work; public uint flags;
    }

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, System.Text.StringBuilder text, int max);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr hwnd, ref WINDOWPLACEMENT p);
    [DllImport("user32.dll")] static extern bool SetWindowPlacement(IntPtr hwnd, ref WINDOWPLACEMENT p);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr hwnd, bool altTab);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    // Coordonnees en vrais pixels, meme avec des ecrans a echelles differentes
    public static void UseRealPixels() {
      try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
    }

    // Fenetre principale la plus recente (au premier plan en premier) d'un des programmes.
    // title : si non vide, le titre de la fenetre doit contenir ce texte (majuscules ignorees).
    static IntPtr Find(string[] names, string title) {
      IntPtr found = IntPtr.Zero;
      EnumWindows(delegate (IntPtr h, IntPtr d) {
        if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero || GetWindowTextLength(h) == 0) return true;
        if ((GetWindowLong(h, -20) & 0x80) != 0) return true;              // fenetre outil
        int cloaked;
        if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true; // invisible (bureau virtuel...)
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        string name;
        try { name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { return true; }
        if (Array.IndexOf(names, "*") < 0 && Array.IndexOf(names, name) < 0) return true;
        if (!string.IsNullOrEmpty(title)) {
          System.Text.StringBuilder sb = new System.Text.StringBuilder(512);
          GetWindowText(h, sb, 512);
          if (sb.ToString().IndexOf(title, StringComparison.OrdinalIgnoreCase) < 0) return true;
        }
        found = h;
        return false;
      }, IntPtr.Zero);
      return found;
    }

    static IntPtr Secondary(out MONITORINFO info, out MONITORINFO primary) {
      IntPtr result = IntPtr.Zero;
      MONITORINFO sec = new MONITORINFO(), pri = new MONITORINFO();
      EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr m, IntPtr hdc, IntPtr r, IntPtr d) {
        MONITORINFO mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        GetMonitorInfo(m, ref mi);
        if ((mi.flags & 1) != 0) pri = mi;
        else if (result == IntPtr.Zero) { result = m; sec = mi; }
        return true;
      }, IntPtr.Zero);
      info = sec; primary = pri;
      return result;
    }

    // Nom du programme de la fenetre au premier plan (ex. "firefox")
    public static string ForegroundName() {
      uint pid;
      GetWindowThreadProcessId(GetForegroundWindow(), out pid);
      try { return Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { return ""; }
    }

    // Premier plan sans changer la taille : restauree seulement si elle est reduite
    public static void FocusHandle(IntPtr h) {
      if (IsIconic(h)) ShowWindow(h, 9);             // SW_RESTORE
      Foreground(h);
    }

    // Windows refuse parfois qu'un programme en arriere-plan passe une fenetre devant.
    // On verifie et on reessaie (3 fois) : une touche "neutre" (0x88, sans effet dans les
    // programmes) donne a PC Deck le droit de changer de fenetre, puis le mecanisme d'Alt+Tab.
    static void Foreground(IntPtr h) {
      for (int i = 0; i < 3 && GetForegroundWindow() != h; i++) {
        if (i > 0) {
          Keyboard.keybd_event(0x88, 0, 0, UIntPtr.Zero);
          Keyboard.keybd_event(0x88, 0, 2, UIntPtr.Zero);
          System.Threading.Thread.Sleep(50);
        }
        uint dummy;
        uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
        uint me = GetCurrentThreadId();
        bool attached = fg != me && AttachThreadInput(me, fg, true);
        BringWindowToTop(h);
        SetForegroundWindow(h);
        if (attached) AttachThreadInput(me, fg, false);
        if (GetForegroundWindow() != h) SwitchToThisWindow(h, true);
        System.Threading.Thread.Sleep(80);
      }
    }

    // where : "same" (dernier ecran utilise), "secondary", "primary"  -> fenetre agrandie
    //         "front" -> juste au premier plan (restauree si elle est reduite, taille inchangee)
    // names : noms de programmes, ou "*" pour n'importe quel programme (recherche par titre)
    // Repond "ok", "notfound" (programme sans fenetre ouverte)
    public static string Show(string[] names, string where, string title) {
      IntPtr h = Find(names, title);
      if (h == IntPtr.Zero) return "notfound";
      if (where == "front") { FocusHandle(h); return "ok"; }

      if (where == "secondary" || where == "primary") {
        MONITORINFO target, primary;
        IntPtr sec = Secondary(out target, out primary);
        IntPtr wanted = where == "primary" || sec == IntPtr.Zero ? MonitorFromWindow(IntPtr.Zero, 1) : sec;
        if (where == "primary" || sec == IntPtr.Zero) target = primary;
        if (MonitorFromWindow(h, 2) != wanted) {
          WINDOWPLACEMENT p = new WINDOWPLACEMENT();
          p.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
          GetWindowPlacement(h, ref p);
          // Position "normale" placee sur l'ecran voulu (coordonnees de l'espace de travail)
          int dx = primary.work.Left - primary.monitor.Left, dy = primary.work.Top - primary.monitor.Top;
          int w = (target.work.Right - target.work.Left) * 3 / 4, hgt = (target.work.Bottom - target.work.Top) * 3 / 4;
          p.normalPos.Left = target.work.Left + 40 - dx;
          p.normalPos.Top = target.work.Top + 40 - dy;
          p.normalPos.Right = p.normalPos.Left + w;
          p.normalPos.Bottom = p.normalPos.Top + hgt;
          if (!IsIconic(h)) { ShowWindow(h, 9); }   // SW_RESTORE : sort du mode agrandi pour pouvoir bouger
          p.flags = 0;
          p.showCmd = 1;                             // SW_SHOWNORMAL sur l'ecran voulu...
          SetWindowPlacement(h, ref p);
        }
      }
      ShowWindow(h, 3);                              // ...puis SW_MAXIMIZE (restaure aussi depuis la barre des taches)
      Foreground(h);
      return "ok";
    }
  }

  // Petit indicateur de volume dans le coin superieur droit de l'ecran principal :
  // juste une petite icone, la barre et le chiffre, sans cadre ni fond (fenetre transparente).
  // Il ne prend jamais le focus et laisse passer les clics.
  public class OsdForm : System.Windows.Forms.Form {
    [StructLayout(LayoutKind.Sequential)] struct PT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct SZ { public int CX, CY; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] struct BLEND { public byte Op, Flags, Alpha, Format; }
    [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref PT dst, ref SZ size, IntPtr hdcSrc, ref PT src, int key, ref BLEND blend, int flags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(System.Drawing.Point pt, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);

    System.Windows.Forms.Timer hideTimer = new System.Windows.Forms.Timer();

    public OsdForm() {
      FormBorderStyle = System.Windows.Forms.FormBorderStyle.None;
      ShowInTaskbar = false;
      TopMost = true;
      StartPosition = System.Windows.Forms.FormStartPosition.Manual;
      hideTimer.Interval = 1600;
      hideTimer.Tick += delegate { hideTimer.Stop(); ShowWindow(Handle, 0); };
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override System.Windows.Forms.CreateParams CreateParams {
      get {
        System.Windows.Forms.CreateParams cp = base.CreateParams;
        // transparente (calque), pas de focus, pas dans Alt+Tab, au-dessus, clics traversants
        cp.ExStyle |= 0x80000 | 0x08000000 | 0x80 | 0x8 | 0x20;
        return cp;
      }
    }

    // isSystem : icone haut-parleur (Windows) ou note de musique (application)
    public void ShowLevel(bool isSystem, int level, bool muted) {
      level = Math.Max(0, Math.Min(100, level));
      System.Drawing.Rectangle work = System.Windows.Forms.Screen.PrimaryScreen.WorkingArea;
      uint dx, dy;
      IntPtr mon = MonitorFromPoint(new System.Drawing.Point(work.Left + 1, work.Top + 1), 1);
      float s = GetDpiForMonitor(mon, 0, out dx, out dy) == 0 ? dx / 96f : 1f;
      int w = (int)(200 * s), h = (int)(30 * s);
      int x = work.Right - w - (int)(20 * s), y = work.Top + (int)(16 * s);

      using (System.Drawing.Bitmap bmp = new System.Drawing.Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
      using (System.Drawing.Graphics g = System.Drawing.Graphics.FromImage(bmp)) {
        g.Clear(System.Drawing.Color.Transparent);
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        System.Drawing.Color white = System.Drawing.Color.FromArgb(255, 245, 245, 245);
        System.Drawing.Color shadow = System.Drawing.Color.FromArgb(170, 0, 0, 0);
        float off = Math.Max(1f, s);

        // Petite icone : haut-parleur / note de musique / coupe
        int code = muted || level == 0 ? 0xE74F : isSystem ? (level < 34 ? 0xE993 : level < 67 ? 0xE994 : 0xE995) : 0xE8D6;
        string glyph = ((char)code).ToString();
        using (System.Drawing.Font icon = new System.Drawing.Font("Segoe Fluent Icons", 12 * s, System.Drawing.GraphicsUnit.Pixel))
        using (System.Drawing.SolidBrush sb = new System.Drawing.SolidBrush(shadow))
        using (System.Drawing.SolidBrush wb = new System.Drawing.SolidBrush(white)) {
          float iy = (h - 14 * s) / 2;
          g.DrawString(glyph, icon, sb, 2 * s + off, iy + off);
          g.DrawString(glyph, icon, wb, 2 * s, iy);
        }

        // Barre
        float bx = 24 * s, bw = 130 * s, bh = 4 * s, by = (h - bh) / 2;
        using (System.Drawing.SolidBrush sb = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(120, 0, 0, 0)))
          g.FillRectangle(sb, bx - off, by - off, bw + 2 * off, bh + 2 * off);
        using (System.Drawing.SolidBrush track = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(110, 255, 255, 255)))
          g.FillRectangle(track, bx, by, bw, bh);
        if (level > 0) {
          System.Drawing.Color fill = muted ? System.Drawing.Color.FromArgb(255, 137, 135, 129) : System.Drawing.Color.FromArgb(255, 57, 135, 229);
          using (System.Drawing.SolidBrush fb = new System.Drawing.SolidBrush(fill))
            g.FillRectangle(fb, bx, by, bw * level / 100f, bh);
        }

        // Chiffre
        string pct = level.ToString();
        using (System.Drawing.Font f = new System.Drawing.Font("Segoe UI Semibold", 15 * s, System.Drawing.GraphicsUnit.Pixel))
        using (System.Drawing.SolidBrush sb = new System.Drawing.SolidBrush(shadow))
        using (System.Drawing.SolidBrush wb = new System.Drawing.SolidBrush(white)) {
          System.Drawing.StringFormat tf = System.Drawing.StringFormat.GenericTypographic;
          System.Drawing.SizeF size = g.MeasureString(pct, f, 1000, tf);
          float tx = w - size.Width - 2 * s, ty = (h - size.Height) / 2;
          g.DrawString(pct, f, sb, tx + off, ty + off, tf);
          g.DrawString(pct, f, wb, tx, ty, tf);
        }

        // Envoi de l'image a la fenetre transparente (transparence pixel par pixel)
        IntPtr screen = GetDC(IntPtr.Zero);
        IntPtr mem = CreateCompatibleDC(screen);
        IntPtr hbmp = bmp.GetHbitmap(System.Drawing.Color.FromArgb(0));
        IntPtr old = SelectObject(mem, hbmp);
        PT dst = new PT { X = x, Y = y }, src = new PT();
        SZ sz = new SZ { CX = w, CY = h };
        BLEND blend = new BLEND { Op = 0, Flags = 0, Alpha = 255, Format = 1 };
        UpdateLayeredWindow(Handle, screen, ref dst, ref sz, mem, ref src, 0, ref blend, 2);
        SelectObject(mem, old);
        DeleteObject(hbmp);
        DeleteDC(mem);
        ReleaseDC(IntPtr.Zero, screen);
      }
      ShowWindow(Handle, 4); // SW_SHOWNOACTIVATE
      hideTimer.Stop();
      hideTimer.Start();
    }
  }

  public static class Osd {
    static OsdForm form;
    static System.Threading.ManualResetEvent ready = new System.Threading.ManualResetEvent(false);

    static void Start() {
      System.Threading.Thread t = new System.Threading.Thread(delegate () {
        form = new OsdForm();
        IntPtr h = form.Handle; // cree la fenetre (cachee)
        ready.Set();
        System.Windows.Forms.Application.Run();
      });
      t.SetApartmentState(System.Threading.ApartmentState.STA);
      t.IsBackground = true;
      t.Start();
      ready.WaitOne();
    }

    public static void Show(string label, int level, bool muted) {
      if (form == null) Start();
      bool isSystem = label.StartsWith("Syst");
      form.BeginInvoke((System.Windows.Forms.MethodInvoker)delegate { form.ShowLevel(isSystem, level, muted); });
    }
  }

  public static class AppVolume {
    // Prochaine valeur (en fraction 0-1) sur un multiple de "step" %.
    // Ex. step 2 : 37 % -> 38 % en montant, 36 % en descendant ; 38 % -> 40 % / 36 %.
    public static float Snap(float current, string op, int step) {
      if (step < 1) return current;
      double pct = Math.Round(current * 100, 2);
      double next = op == "up"
        ? (Math.Floor(pct / step + 1e-6) + 1) * step
        : (Math.Ceiling(pct / step - 1e-6) - 1) * step;
      return (float)(Math.Max(0, Math.Min(100, next)) / 100.0);
    }

    static object Activate(Guid iid) {
      IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCo());
      IMMDevice device;
      Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
      object obj;
      Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out obj));
      return obj;
    }

    // Volume general de Windows
    public static string ChangeSystem(string op, int step) {
      IAudioEndpointVolume volume = (IAudioEndpointVolume)Activate(typeof(IAudioEndpointVolume).GUID);
      Guid ctx = Guid.Empty;
      float current; bool muted;
      Marshal.ThrowExceptionForHR(volume.GetMasterVolumeLevelScalar(out current));
      Marshal.ThrowExceptionForHR(volume.GetMute(out muted));
      if (op == "get") {
        // lecture seule
      } else if (op == "mute") {
        muted = !muted;
        volume.SetMute(muted, ref ctx);
      } else {
        current = Snap(current, op, step);
        volume.SetMasterVolumeLevelScalar(current, ref ctx);
        if (op == "up" && muted) { volume.SetMute(false, ref ctx); muted = false; }
      }
      return "ok:" + Math.Round(current * 100) + ":" + (muted ? 1 : 0);
    }

    // Volume de certains programmes seulement (melangeur de volume de Windows)
    public static string Change(string[] names, string op, int step) {
      object obj = Activate(typeof(IAudioSessionManager2).GUID);
      IAudioSessionEnumerator sessions;
      Marshal.ThrowExceptionForHR(((IAudioSessionManager2)obj).GetSessionEnumerator(out sessions));

      int count;
      sessions.GetCount(out count);
      Guid ctx = Guid.Empty;
      bool found = false, muted = false;
      bool? newMute = null;
      float? newLevel = null;
      float level = 0;

      for (int i = 0; i < count; i++) {
        IAudioSessionControl2 session;
        if (sessions.GetSession(i, out session) != 0) continue;
        uint pid;
        // Code >= 0 = reussite (0x0889000D = session partagee entre plusieurs programmes)
        if (session.GetProcessId(out pid) < 0 || pid == 0) continue;
        string name;
        try { name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); }
        catch { continue; }
        if (Array.IndexOf(names, name) < 0) continue;

        ISimpleAudioVolume volume = session as ISimpleAudioVolume;
        if (volume == null) continue;
        float current; bool isMuted;
        volume.GetMasterVolume(out current);
        volume.GetMute(out isMuted);

        // Toutes les sessions du programme recoivent le meme volume (calcule sur la premiere)
        if (op == "up" || op == "down") {
          if (!newLevel.HasValue) newLevel = Snap(current, op, step);
          current = newLevel.Value;
          volume.SetMasterVolume(current, ref ctx);
          if (op == "up" && isMuted) { volume.SetMute(false, ref ctx); isMuted = false; }
        } else if (op == "mute") {
          if (!newMute.HasValue) newMute = !isMuted;
          volume.SetMute(newMute.Value, ref ctx);
          isMuted = newMute.Value;
        }
        found = true; level = current; muted = isMuted;
      }
      if (!found) return "notfound";
      return "ok:" + Math.Round(level * 100) + ":" + (muted ? 1 : 0);
    }
  }
}
'@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Windows.Forms, System.Drawing
[PcDeck.Windows]::UseRealPixels()
# Le serveur envoie du texte en UTF-8 (titres de fenetres avec accents)
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

[Console]::Out.WriteLine('ready')
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    try {
        $parts = $line.Split(' ')
        switch ($parts[0]) {
            'keys' {
                [PcDeck.Keyboard]::Press([int[]]($parts[1].Split(',')))
                $reply = 'ok'
            }
            'appvol' {
                $names = [string[]]($parts[3].Split('|'))
                $reply = [PcDeck.AppVolume]::Change($names, $parts[1], [int]$parts[2])
            }
            'window' {
                # window <ecran> <programme1|programme2> [texte du titre, espaces permis]
                $title = ''
                if ($parts.Count -gt 3) { $title = ($parts[3..($parts.Count - 1)] -join ' ') }
                $reply = [PcDeck.Windows]::Show([string[]]($parts[2].ToLower().Split('|')), $parts[1], $title)
            }
            'osd' {
                # osd <niveau> <muet 0/1> <nom affiche, espaces permis>
                $label = ''
                if ($parts.Count -gt 3) { $label = ($parts[3..($parts.Count - 1)] -join ' ') }
                [PcDeck.Osd]::Show($label, [int]$parts[1], $parts[2] -eq '1')
                $reply = 'ok'
            }
            'folder' {
                # folder <chemin, espaces permis> : fenetre de l'Explorateur deja ouverte sur ce dossier ?
                $target = ($parts[1..($parts.Count - 1)] -join ' ').TrimEnd('\')
                $reply = 'notfound'
                foreach ($w in (New-Object -ComObject Shell.Application).Windows()) {
                    $p = $null
                    try { $p = $w.Document.Folder.Self.Path } catch { }
                    if ($p -and ($target -eq '*' -or $p.TrimEnd('\') -ieq $target)) { [PcDeck.Windows]::FocusHandle([IntPtr]$w.HWND); $reply = 'ok'; break }
                }
                if ($reply -eq 'notfound' -and $target -eq '*') {
                    # Une fenetre sur "Accueil" n'est pas listee ci-dessus : on la cherche par son type
                    $h = [PcDeck.Windows]::FindWindow('CabinetWClass', $null)
                    if ($h -ne [IntPtr]::Zero) { [PcDeck.Windows]::FocusHandle($h); $reply = 'ok' }
                }
            }
            'text' {
                # text <texte en base64, UTF-8>
                [PcDeck.Keyboard]::Type([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1])))
                $reply = 'ok'
            }
            'fg' { $reply = 'ok:' + [PcDeck.Windows]::ForegroundName() }
            'sysvol' {
                $reply = [PcDeck.AppVolume]::ChangeSystem($parts[1], [int]$parts[2])
            }
            default { $reply = 'error ordre inconnu' }
        }
    } catch {
        $reply = 'error ' + ($_.Exception.Message -replace '\s+', ' ')
    }
    [Console]::Out.WriteLine($reply)
}
