# PC Deck - remote screen: capture (JPEG) + mouse/keyboard input.
# Commands on stdin, one per line:
#   mon                       -> J {"monitors":[...]}
#   cap <mon> <maxW> <q> [force] -> F <base64 jpeg>, or S if the screen did not change
#   move <mon> <nx> <ny>      (nx, ny = 0..1 inside the monitor)
#   btn <l|r|m> <down|up>
#   wheel <delta>
#   key <vk> <down|up>
#   text <base64 utf8>
# Pure ASCII file (read by Windows PowerShell 5.1).
param([int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type -ReferencedAssemblies System.Drawing, System.Windows.Forms -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace PcDeckScreen {

// Desktop Duplication (DXGI): the graphics card hands over each new screen image.
// COM methods are called through their vtable index (no extra library needed).
public class Dda : IDisposable {
    [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, out IntPtr factory);
    [DllImport("d3d11.dll")] static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr software, uint flags,
        IntPtr levels, uint numLevels, uint sdk, out IntPtr device, out int level, out IntPtr context);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int QIFn(IntPtr self, ref Guid iid, out IntPtr obj);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint ReleaseFn(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int EnumFn(IntPtr self, uint i, out IntPtr obj);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int DescFn(IntPtr self, IntPtr desc);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int DupFn(IntPtr self, IntPtr device, out IntPtr dup);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int AcquireFn(IntPtr self, uint timeout, IntPtr info, out IntPtr res);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int ReleaseFrameFn(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateTexFn(IntPtr self, ref TEXDESC d, IntPtr init, out IntPtr tex);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void TexDescFn(IntPtr self, out TEXDESC d);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void CopyFn(IntPtr ctx, IntPtr dst, IntPtr src);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int MapFn(IntPtr ctx, IntPtr res, uint sub, uint type, uint flags, out MAPPED m);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void UnmapFn(IntPtr ctx, IntPtr res, uint sub);

    [StructLayout(LayoutKind.Sequential)] public struct TEXDESC {
        public uint Width, Height, MipLevels, ArraySize, Format, SampleCount, SampleQuality, Usage, BindFlags, CPUAccessFlags, MiscFlags;
    }
    [StructLayout(LayoutKind.Sequential)] public struct MAPPED { public IntPtr pData; public uint RowPitch, DepthPitch; }

    static T Fn<T>(IntPtr obj, int index) where T : class {
        IntPtr vt = Marshal.ReadIntPtr(obj);
        return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(vt, index * IntPtr.Size), typeof(T));
    }
    static void Rel(ref IntPtr p) { if (p != IntPtr.Zero) { Fn<ReleaseFn>(p, 2)(p); p = IntPtr.Zero; } }

    const int WAIT_TIMEOUT = unchecked((int)0x887A0027);
    IntPtr device, ctx, dup, staging;
    public int W, H;
    public string Name;
    public bool HasFrame;

    public bool Init(string deviceName) {
        Name = deviceName;
        Guid iidFactory = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
        Guid iidOutput1 = new Guid("00cddea8-939b-4b83-a340-a685226666cc");
        IntPtr factory, adapter = IntPtr.Zero, output = IntPtr.Zero, output1 = IntPtr.Zero;
        if (CreateDXGIFactory1(ref iidFactory, out factory) < 0) return false;
        IntPtr desc = Marshal.AllocHGlobal(128);
        try {
            for (uint a = 0; adapter == IntPtr.Zero || output == IntPtr.Zero; a++) {
                IntPtr ad;
                if (Fn<EnumFn>(factory, 12)(factory, a, out ad) < 0) break; // EnumAdapters1
                for (uint o = 0; ; o++) {
                    IntPtr op;
                    if (Fn<EnumFn>(ad, 7)(ad, o, out op) < 0) break; // EnumOutputs
                    Fn<DescFn>(op, 7)(op, desc); // GetDesc
                    if (Marshal.PtrToStringUni(desc) == deviceName) { adapter = ad; output = op; break; }
                    Rel(ref op);
                }
                if (output == IntPtr.Zero) Rel(ref ad);
            }
            if (output == IntPtr.Zero) return false;
            int level;
            if (D3D11CreateDevice(adapter, 0, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out device, out level, out ctx) < 0) return false;
            if (Fn<QIFn>(output, 0)(output, ref iidOutput1, out output1) < 0) return false;
            return Fn<DupFn>(output1, 22)(output1, device, out dup) >= 0; // DuplicateOutput
        } finally {
            Marshal.FreeHGlobal(desc);
            Rel(ref output1); Rel(ref output); Rel(ref adapter); Rel(ref factory);
        }
    }

    // 0 = new image, 1 = nothing changed, -1 = lost (screen mode change, secure desktop...)
    public int Acquire(uint timeoutMs) {
        IntPtr info = Marshal.AllocHGlobal(64);
        IntPtr res = IntPtr.Zero, tex = IntPtr.Zero;
        try {
            int hr = Fn<AcquireFn>(dup, 8)(dup, timeoutMs, info, out res);
            if (hr == WAIT_TIMEOUT) return 1;
            if (hr < 0) return -1;
            Guid iidTex = new Guid("6f15aaf2-d208-4e89-9ab4-489535d34f9c");
            if (Fn<QIFn>(res, 0)(res, ref iidTex, out tex) >= 0) {
                if (staging == IntPtr.Zero) {
                    TEXDESC d;
                    Fn<TexDescFn>(tex, 10)(tex, out d);
                    W = (int)d.Width; H = (int)d.Height;
                    d.MipLevels = 1; d.ArraySize = 1; d.SampleCount = 1; d.SampleQuality = 0;
                    d.Usage = 3; d.BindFlags = 0; d.CPUAccessFlags = 0x20000; d.MiscFlags = 0; // STAGING, CPU read
                    if (Fn<CreateTexFn>(device, 5)(device, ref d, IntPtr.Zero, out staging) < 0) return -1;
                }
                Fn<CopyFn>(ctx, 47)(ctx, staging, tex); // CopyResource
                HasFrame = true;
            }
            return 0;
        } finally {
            Rel(ref tex);
            if (res != IntPtr.Zero) { Rel(ref res); Fn<ReleaseFrameFn>(dup, 14)(dup); }
            Marshal.FreeHGlobal(info);
        }
    }

    // Draws the last image, scaled to dw x dh, into g
    public bool Draw(Graphics g, int dw, int dh) {
        MAPPED m;
        if (Fn<MapFn>(ctx, 14)(ctx, staging, 0, 1, 0, out m) < 0) return false; // Map READ
        try {
            using (Bitmap src = new Bitmap(W, H, (int)m.RowPitch, PixelFormat.Format32bppRgb, m.pData)) {
                g.DrawImage(src, 0, 0, dw, dh);
            }
        } finally { Fn<UnmapFn>(ctx, 15)(ctx, staging, 0); }
        return true;
    }

    public void Dispose() { Rel(ref staging); Rel(ref dup); Rel(ref ctx); Rel(ref device); }
}

public static class Remote {
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint f, int dx, int dy, int data, IntPtr extra);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO ci);
    [DllImport("user32.dll")] static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr icon, int w, int h, int step, IntPtr brush, int flags);
    [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr icon, out ICONINFO info);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);

    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }
    [StructLayout(LayoutKind.Sequential)] struct ICONINFO { public bool fIcon; public int xHot, yHot; public IntPtr mask, color; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }

    static ImageCodecInfo jpeg;
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    public static void Init() {
        // Real pixels on every screen (per-monitor DPI), needed by Desktop Duplication
        try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } catch { SetProcessDPIAware(); }
        foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") jpeg = c;
    }

    static Screen Mon(int i) {
        Screen[] all = Screen.AllScreens;
        return (i >= 0 && i < all.Length) ? all[i] : Screen.PrimaryScreen;
    }

    public static string Monitors() {
        Screen[] all = Screen.AllScreens;
        string s = "[";
        for (int i = 0; i < all.Length; i++) {
            Rectangle b = all[i].Bounds;
            if (i > 0) s += ",";
            s += "{\"index\":" + i + ",\"primary\":" + (all[i].Primary ? "true" : "false") +
                 ",\"width\":" + b.Width + ",\"height\":" + b.Height + "}";
        }
        return s + "]";
    }

    // ---- Fast path: Desktop Duplication (graphics card) ----
    static Dda dda;
    static int ddaFailures;
    static DateTime ddaRetryAt;
    // 5 failures in a row (lock screen, UAC...): slow method for 2 s, then try the graphics card again
    static void DdaFailed() { ddaFailures++; if (ddaFailures >= 5) ddaRetryAt = DateTime.UtcNow.AddSeconds(2); }

    // null = screen unchanged (nothing to send)
    public static string Capture(int mon, int maxW, long quality, bool force) {
        Screen s = Mon(mon);
        Rectangle b = s.Bounds;
        if (ddaFailures < 5 || DateTime.UtcNow >= ddaRetryAt) {
            if (dda != null && dda.Name != s.DeviceName) { dda.Dispose(); dda = null; }
            if (dda == null) {
                dda = new Dda();
                bool ok = false;
                try { ok = dda.Init(s.DeviceName); } catch { }
                if (!ok) { dda.Dispose(); dda = null; DdaFailed(); }
            }
            if (dda != null) {
                int r = dda.Acquire(force && !dda.HasFrame ? 200u : 0u);
                if (r < 0) { dda.Dispose(); dda = null; DdaFailed(); }
                else if (r == 1 && !(force && dda.HasFrame)) return null;
                else if (dda.HasFrame) {
                    ddaFailures = 0;
                    int dw = dda.W, dh = dda.H;
                    if (maxW > 0 && dw > maxW) { dh = (int)((long)dh * maxW / dw); dw = maxW; }
                    using (Bitmap img = new Bitmap(dw, dh, PixelFormat.Format24bppRgb)) {
                        using (Graphics g = Graphics.FromImage(img)) {
                            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                            g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighSpeed;
                            g.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
                            g.CompositingQuality = System.Drawing.Drawing2D.CompositingQuality.HighSpeed;
                            if (!dda.Draw(g, dw, dh)) return null;
                            DrawCursor(g, b, (double)dw / dda.W);
                        }
                        return Encode(img, quality);
                    }
                }
                else return null;
            }
        }
        return CaptureGdi(b, maxW, quality);
    }

    static void DrawCursor(Graphics g, Rectangle b, double scale) {
        CURSORINFO ci = new CURSORINFO(); ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
        if (!GetCursorInfo(ref ci) || ci.flags != 1 || !b.Contains(ci.pt.X, ci.pt.Y)) return;
        ICONINFO ii; int hx = 0, hy = 0;
        if (GetIconInfo(ci.hCursor, out ii)) {
            hx = ii.xHot; hy = ii.yHot;
            if (ii.mask != IntPtr.Zero) DeleteObject(ii.mask);
            if (ii.color != IntPtr.Zero) DeleteObject(ii.color);
        }
        IntPtr hdc = g.GetHdc();
        DrawIconEx(hdc, (int)((ci.pt.X - b.Left) * scale) - hx, (int)((ci.pt.Y - b.Top) * scale) - hy, ci.hCursor, 0, 0, 0, IntPtr.Zero, 3);
        g.ReleaseHdc(hdc);
    }

    static string Encode(Bitmap img, long quality) {
        EncoderParameters ep = new EncoderParameters(1);
        ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
        using (MemoryStream ms = new MemoryStream()) {
            img.Save(ms, jpeg, ep);
            return Convert.ToBase64String(ms.ToArray());
        }
    }

    // ---- Fallback: classic Windows screen copy (slower) ----
    static string CaptureGdi(Rectangle b, int maxW, long quality) {
        using (Bitmap full = new Bitmap(b.Width, b.Height, PixelFormat.Format24bppRgb)) {
            using (Graphics g = Graphics.FromImage(full)) {
                g.CopyFromScreen(b.Left, b.Top, 0, 0, b.Size, CopyPixelOperation.SourceCopy);
                // Draw the mouse pointer (not included by CopyFromScreen)
                CURSORINFO ci = new CURSORINFO(); ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
                if (GetCursorInfo(ref ci) && ci.flags == 1 && b.Contains(ci.pt.X, ci.pt.Y)) {
                    ICONINFO ii; int hx = 0, hy = 0;
                    if (GetIconInfo(ci.hCursor, out ii)) {
                        hx = ii.xHot; hy = ii.yHot;
                        if (ii.mask != IntPtr.Zero) DeleteObject(ii.mask);
                        if (ii.color != IntPtr.Zero) DeleteObject(ii.color);
                    }
                    IntPtr hdc = g.GetHdc();
                    DrawIconEx(hdc, ci.pt.X - b.Left - hx, ci.pt.Y - b.Top - hy, ci.hCursor, 0, 0, 0, IntPtr.Zero, 3);
                    g.ReleaseHdc(hdc);
                }
            }
            Bitmap img = full;
            if (maxW > 0 && b.Width > maxW) {
                int h = (int)((long)b.Height * maxW / b.Width);
                img = new Bitmap(maxW, h, PixelFormat.Format24bppRgb);
                using (Graphics g2 = Graphics.FromImage(img)) {
                    g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                    g2.DrawImage(full, 0, 0, maxW, h);
                }
            }
            try {
                EncoderParameters ep = new EncoderParameters(1);
                ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
                using (MemoryStream ms = new MemoryStream()) {
                    img.Save(ms, jpeg, ep);
                    return Convert.ToBase64String(ms.ToArray());
                }
            } finally { if (img != full) img.Dispose(); }
        }
    }

    public static void Move(int mon, double nx, double ny) {
        Rectangle b = Mon(mon).Bounds;
        nx = Math.Max(0, Math.Min(1, nx)); ny = Math.Max(0, Math.Min(1, ny));
        SetCursorPos(b.Left + (int)Math.Round(nx * (b.Width - 1)), b.Top + (int)Math.Round(ny * (b.Height - 1)));
    }

    public static void Button(string which, bool down) {
        uint f = which == "r" ? (down ? 0x0008u : 0x0010u) : which == "m" ? (down ? 0x0020u : 0x0040u) : (down ? 0x0002u : 0x0004u);
        mouse_event(f, 0, 0, 0, IntPtr.Zero);
    }

    public static void Wheel(int delta) { mouse_event(0x0800, 0, 0, delta, IntPtr.Zero); }

    public static void Key(int vk, bool down) {
        uint flags = down ? 0u : 0x0002u;
        // Extended keys: arrows, Insert/Delete, Home/End, PageUp/PageDown, Windows key
        if ((vk >= 33 && vk <= 40) || vk == 45 || vk == 46 || vk == 91 || vk == 92 || vk == 93) flags |= 0x0001u;
        keybd_event((byte)vk, (byte)MapVirtualKey((uint)vk, 0), flags, IntPtr.Zero);
    }

    public static void Text(string s) {
        foreach (char ch in s) {
            INPUT[] inp = new INPUT[2];
            for (int k = 0; k < 2; k++) {
                inp[k].type = 1;
                inp[k].u.ki.scan = ch;
                inp[k].u.ki.flags = 0x0004u | (k == 1 ? 0x0002u : 0u); // UNICODE (+ KEYUP)
            }
            SendInput(2, inp, Marshal.SizeOf(typeof(INPUT)));
        }
    }
}
}
'@
[PcDeckScreen.Remote]::Init()
[Console]::InputEncoding = [Text.Encoding]::UTF8
$inv = [Globalization.CultureInfo]::InvariantCulture

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $p = $line.Trim().Split(' ')
  try {
    switch ($p[0]) {
      'mon'   { [Console]::Out.WriteLine('J {"monitors":' + [PcDeckScreen.Remote]::Monitors() + '}') }
      'cap'   {
        $img = [PcDeckScreen.Remote]::Capture([int]$p[1], [int]$p[2], [long]$p[3], $p[4] -eq 'force')
        if ($null -eq $img) { [Console]::Out.WriteLine('S') } else { [Console]::Out.WriteLine('F ' + $img) }
      }
      'move'  { [PcDeckScreen.Remote]::Move([int]$p[1], [double]::Parse($p[2], $inv), [double]::Parse($p[3], $inv)) }
      'btn'   { [PcDeckScreen.Remote]::Button($p[1], $p[2] -eq 'down') }
      'wheel' { [PcDeckScreen.Remote]::Wheel([int]$p[1]) }
      'key'   { [PcDeckScreen.Remote]::Key([int]$p[1], $p[2] -eq 'down') }
      'text'  { [PcDeckScreen.Remote]::Text([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1]))) }
    }
  } catch {
    if ($p[0] -eq 'cap') { [Console]::Out.WriteLine('E capture') }
  }
  [Console]::Out.Flush()
}
