import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RAW_PRINTER_CS } from './winspool';

/** Where bytes go. The print service never knows which printer model or cable is behind it. */
export interface PrintTransport { readonly name: string; send(bytes: Buffer): Promise<void> }

/** Keeps what was sent (tests, and the "print preview" of a headless Hub). */
export class MemoryTransport implements PrintTransport { sent: Buffer[] = []; constructor(readonly name = 'memory', public failWith?: string) {} async send(b: Buffer): Promise<void> { if (this.failWith) throw new Error(this.failWith); this.sent.push(b); } }
/** Appends to a file (a printer port that is a file, or a capture for the printer kit). */
export class FileTransport implements PrintTransport { constructor(readonly name: string, private path: string) {} async send(b: Buffer): Promise<void> { await appendFile(this.path, b); } }
/** A network receipt or label printer: raw bytes to TCP port 9100. */
export class TcpTransport implements PrintTransport {
  constructor(readonly name: string, private host: string, private port = 9100, private timeoutMs = 5000) {}
  send(b: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = connect({ host: this.host, port: this.port }); const fail = (e: Error) => { s.destroy(); reject(e); };
      s.setTimeout(this.timeoutMs, () => fail(new Error(`printer ${this.host}:${this.port} did not answer in ${this.timeoutMs} ms`))); s.once('error', fail);
      s.once('connect', () => s.end(b, () => resolve()));
    });
  }
}
/** A printer installed in Windows (USB or other), by its exact name: the bytes go through the spooler as RAW data. Same C# helper as the printer test kit. Not proven on a real printer yet (the Friday kit does that). */
export class WindowsSpoolerTransport implements PrintTransport {
  constructor(readonly name: string, private printerName: string) {}
  async send(b: Buffer): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'opharm-')); const bin = join(dir, 'job.bin'); const ps = join(dir, 'send.ps1');
    try {
      writeFileSync(bin, b); writeFileSync(ps, `param([string]$Printer,[string]$File)\n$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @"\n${RAW_PRINTER_CS}\n"@\n$r=[RawPrinter]::Send($Printer,[System.IO.File]::ReadAllBytes($File),'O Pharmacy')\nif(-not $r.StartsWith('OK')){ Write-Error $r; exit 1 }\n`);
      await new Promise<void>((resolve, reject) => { const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, this.printerName, bin], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); let err = ''; p.stderr.on('data', d => { err += String(d); }); p.once('error', reject); p.once('close', c => c === 0 ? resolve() : reject(new Error(err.trim() || `spooler exit ${c}`))); });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}
