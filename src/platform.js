import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export function discoverProfiles(env = process.env) {
  const roots = [];
  const local = env.LOCALAPPDATA;
  if (local) {
    const store = path.join(local, 'Claude-Data');
    if (fs.existsSync(store)) for (const name of fs.readdirSync(store)) {
      if (/^claude_[A-Za-z0-9]+$/.test(name)) roots.push({ path: path.join(store, name), priority: 0 });
    }
    roots.push({ path: path.join(local, 'Claude-3p'), priority: 1 }, { path: path.join(local, 'Claude'), priority: 1 });
  }
  if (env.APPDATA) roots.push({ path: path.join(env.APPDATA, 'Claude'), priority: 1 });
  const seen = new Set();
  return roots.filter(item => fs.existsSync(path.join(item.path, 'Cache', 'Cache_Data', 'data_1')))
    .filter(item => { const key = fs.realpathSync(item.path).toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}
export function resolveProfile(explicit) {
  if (explicit) return fs.realpathSync(explicit);
  const candidates = discoverProfiles();
  if (!candidates.length) throw new Error('Claude cache not found. Open a Code conversation containing formulas, quit Claude, and retry; or specify --profile PATH.');
  const priority = Math.min(...candidates.map(item => item.priority));
  const best = candidates.filter(item => item.priority === priority);
  if (best.length !== 1) throw new Error('Multiple profiles found. Choose with --profile PATH:\n' + best.map(item => item.path).join('\n'));
  return fs.realpathSync(best[0].path);
}
export function defaultStateDir() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'state'), 'claude-inline-math-unlimited');
}
export function assertStopped() {
  if (process.platform !== 'win32') throw new Error('Installation and restore currently support Windows only.');
  const script = "$ErrorActionPreference = 'Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | Select-Object @{n='pid';e={$_.ProcessId}},@{n='path';e={$_.ExecutablePath}}) | ConvertTo-Json -Compress";
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim();
  const parsed = output ? JSON.parse(output) : [];
  const processes = Array.isArray(parsed) ? parsed : [parsed];
  const desktop = processes.filter(item => !item.path || fs.existsSync(path.join(path.dirname(item.path), 'resources', 'app.asar')));
  if (desktop.length) throw new Error('Claude Desktop is still running (or a Claude process cannot be identified). Quit it from the tray and retry. No process was terminated.');
}
