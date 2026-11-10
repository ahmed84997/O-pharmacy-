<#
 O-Pharmacy printer test kit (Phase 0, spike S3). Prints test jobs to YOUR printers and sends nothing anywhere.
 Windows PowerShell 5.1 or newer. Run from this folder:
   powershell -ExecutionPolicy Bypass -File .\print-test.ps1 -List
   powershell -ExecutionPolicy Bypass -File .\print-test.ps1 -Printer "XP-80C" -Test receipt80
 Tests: receipt80 receipt58 drawer driver  (receipt printers)   tspl tspl-invert zpl driver-label (label printers)
 Network printers: add -Ip 192.168.1.50 instead of -Printer (port 9100).
#>
param(
  [switch]$List,
  [string]$Printer,
  [string]$Ip,
  [ValidateSet('receipt80','receipt58','drawer','driver','tspl','tspl-invert','zpl','all-receipt')]
  [string]$Test = 'receipt80'
)
$ErrorActionPreference = 'Stop'
$kit = $PSScriptRoot

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

function Send-Bytes([byte[]]$bytes, [string]$label) {
  if ($Ip) {
    $c = New-Object System.Net.Sockets.TcpClient; $c.Connect($Ip, 9100)
    $s = $c.GetStream(); $s.Write($bytes, 0, $bytes.Length); $s.Flush(); Start-Sleep -Milliseconds 500; $c.Close(); return "OK $($bytes.Length) bytes to ${Ip}:9100"
  }
  return [RawPrinter]::Send($Printer, $bytes, "O-Pharmacy test $label")
}

if ($List) {
  Get-CimInstance Win32_Printer | Select-Object Name, DriverName, PortName, @{n='Default';e={$_.Default}}, PrinterStatus | Format-Table -AutoSize
  Write-Host "Use the exact Name column value with -Printer."; return
}
if (-not $Printer -and -not $Ip) { throw 'Give -Printer "<name from -List>" or -Ip <address>.' }

function Run([string]$name, [string]$file) {
  $r = Send-Bytes ([System.IO.File]::ReadAllBytes((Join-Path $kit $file))) $name
  Write-Host ("{0,-12} {1}" -f $name, $r)
}
switch ($Test) {
  'receipt80'   { Run 'receipt80' 'receipt80.bin' }
  'receipt58'   { Run 'receipt58' 'receipt58.bin' }
  'drawer'      { Run 'drawer' 'drawer.bin' }
  'tspl'        { Run 'tspl' 'label-tspl.bin' }
  'tspl-invert' { Run 'tspl-invert' 'label-tspl-invert.bin' }
  'zpl'         { Run 'zpl' 'label-zpl.bin' }
  'all-receipt' { Run 'receipt80' 'receipt80.bin'; Start-Sleep 2; Run 'drawer' 'drawer.bin' }
  'driver' {
    Add-Type -AssemblyName System.Drawing
    $img = [System.Drawing.Image]::FromFile((Join-Path $kit 'receipt80-preview.png'))
    $pd = New-Object System.Drawing.Printing.PrintDocument; $pd.PrinterSettings.PrinterName = $Printer
    $pd.add_PrintPage({ param($s, $e) $w = $e.PageBounds.Width; $h = [int]($img.Height * $w / $img.Width); $e.Graphics.DrawImage($img, 0, 0, $w, $h); $e.HasMorePages = $false })
    $pd.Print(); Write-Host 'driver       sent through the Windows driver (graphics mode)'
  }
}
Write-Host 'Now fill in RESULTS.md (what came out, what did not).'
