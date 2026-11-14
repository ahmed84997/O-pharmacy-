# O Pharmacy desktop: hands raw bytes to a Windows printer (same helper as packages/print/src/winspool.ts; a Hub test keeps them equal).
param([string]$Printer,[string]$File)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true)] static extern bool StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true)] static extern bool WritePrinter(IntPtr h, IntPtr b, int n, out int written);
  public static string Send(string printer, byte[] data, string doc) {
    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "OpenPrinter failed, error " + Marshal.GetLastWin32Error();
    try {
      var di = new DOCINFO { pDocName = doc, pDataType = "RAW" };
      if (!StartDocPrinter(h, 1, di)) return "StartDocPrinter failed, error " + Marshal.GetLastWin32Error();
      StartPagePrinter(h);
      IntPtr p = Marshal.AllocCoTaskMem(data.Length); Marshal.Copy(data, 0, p, data.Length);
      int w; bool ok = WritePrinter(h, p, data.Length, out w); Marshal.FreeCoTaskMem(p);
      EndPagePrinter(h); EndDocPrinter(h);
      return ok && w == data.Length ? "OK " + w + " bytes" : "WritePrinter failed, wrote " + w + " of " + data.Length;
    } finally { ClosePrinter(h); }
  }
}
"@
$r=[RawPrinter]::Send($Printer,[System.IO.File]::ReadAllBytes($File),'O Pharmacy')
if(-not $r.StartsWith('OK')){ Write-Error $r; exit 1 }
