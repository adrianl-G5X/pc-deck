# Son du PC pour l'appareil qui regarde l'ecran (controle a distance), pour PC Deck.
# Capture "loopback" de Windows (WASAPI) : tout ce que joue la sortie son par defaut.
# Sortie standard en binaire : paquets [longueur sur 4 octets][donnees] ;
#   1er paquet : "R" + frequence (texte, ex. "R48000") ; ensuite : PCM 16 bits stereo entrelace.
# S'arrete quand PC Deck s'arrete (-ParentPid) ou si la sortie son change (relance par audio.js).
param([int]$ParentPid = 0)
$code = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
namespace PcDeckAudio {
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator { int NotImpl1(); [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device); }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo { }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
  [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioClient {
    [PreserveSig] int Initialize(int shareMode, int flags, long bufferDuration, long periodicity, IntPtr format, IntPtr session);
    [PreserveSig] int GetBufferSize(out uint frames);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint padding);
    [PreserveSig] int IsFormatSupported(int mode, IntPtr format, out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr format);
    [PreserveSig] int GetDevicePeriod(out long def, out long min);
    [PreserveSig] int Start();
    [PreserveSig] int Stop();
    [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr handle);
    [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  }
  [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioCaptureClient {
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out long devicePosition, out long qpc);
    [PreserveSig] int ReleaseBuffer(uint frames);
    [PreserveSig] int GetNextPacketSize(out uint frames);
  }

  public static class Loopback {
    static Stream output;
    static void Packet(byte[] data, int length) {
      byte[] len = BitConverter.GetBytes(length);
      output.Write(len, 0, 4);
      output.Write(data, 0, length);
      output.Flush();
    }

    public static void Run(int parentPid) {
      output = Console.OpenStandardOutput();
      IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCo());
      IMMDevice dev;
      Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev)); // haut-parleurs, multimedia
      Guid iid = typeof(IAudioClient).GUID;
      object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
      IAudioClient client = (IAudioClient)o;
      IntPtr fmt;
      Marshal.ThrowExceptionForHR(client.GetMixFormat(out fmt));
      // WAVEFORMATEX : format (0), canaux (2), frequence (4), bits (14) ; 0xFFFE = extensible (sous-format a 24)
      int tag = Marshal.ReadInt16(fmt, 0) & 0xFFFF, channels = Marshal.ReadInt16(fmt, 2), rate = Marshal.ReadInt32(fmt, 4), bits = Marshal.ReadInt16(fmt, 14);
      bool isFloat = tag == 3 || (tag == 0xFFFE && Marshal.ReadInt16(fmt, 24) == 3);
      Marshal.ThrowExceptionForHR(client.Initialize(0, 0x00020000, 10000000, 0, fmt, IntPtr.Zero)); // partage, LOOPBACK, 1 s de tampon
      Guid cid = typeof(IAudioCaptureClient).GUID;
      Marshal.ThrowExceptionForHR(client.GetService(ref cid, out o));
      IAudioCaptureClient capture = (IAudioCaptureClient)o;
      byte[] head = System.Text.Encoding.ASCII.GetBytes("R" + rate);
      Packet(head, head.Length);
      Marshal.ThrowExceptionForHR(client.Start());

      byte[] pcm = new byte[rate / 5 * 4]; // 200 ms de stereo 16 bits au plus par envoi
      float[] f = new float[0];
      Stopwatch check = Stopwatch.StartNew();
      while (true) {
        Thread.Sleep(10);
        if (parentPid > 0 && check.ElapsedMilliseconds > 2000) {
          check.Restart();
          try { if (Process.GetProcessById(parentPid).HasExited) return; } catch { return; }
        }
        int used = 0;
        uint next;
        Marshal.ThrowExceptionForHR(capture.GetNextPacketSize(out next));
        while (next > 0) {
          IntPtr data; uint frames, flags; long pos, qpc;
          Marshal.ThrowExceptionForHR(capture.GetBuffer(out data, out frames, out flags, out pos, out qpc));
          bool silent = (flags & 2) != 0;
          for (int i = 0; i < frames && used + 4 <= pcm.Length; i++) {
            for (int c = 0; c < 2; c++) {
              int ch = Math.Min(c, channels - 1); // mono -> les deux cotes ; 5.1 -> avant gauche / droite
              short s = 0;
              if (!silent) {
                if (isFloat && bits == 32) {
                  float v = BitConverter.ToSingle(BitConverter.GetBytes(Marshal.ReadInt32(data, (i * channels + ch) * 4)), 0);
                  s = (short)Math.Max(-32768, Math.Min(32767, (int)(v * 32767f)));
                } else if (bits == 16) s = Marshal.ReadInt16(data, (i * channels + ch) * 2);
                else if (bits == 32) s = (short)(Marshal.ReadInt32(data, (i * channels + ch) * 4) >> 16);
              }
              pcm[used++] = (byte)(s & 0xFF);
              pcm[used++] = (byte)((s >> 8) & 0xFF);
            }
          }
          capture.ReleaseBuffer(frames);
          Marshal.ThrowExceptionForHR(capture.GetNextPacketSize(out next));
        }
        if (used > 0) Packet(pcm, used);
      }
    }
  }
}
'@
Add-Type -TypeDefinition $code
[PcDeckAudio.Loopback]::Run($ParentPid)
