# Native startup mode (Windows, experimental)

[简体中文](native-runtime.zh-CN.md) · [README](../README.md)

This optional mode keeps the original Claude application entry point and applies formula fixes as supported hosted scripts load, including after an ordinary app restart. It does not depend on an already patched HTTP cache.

**It modifies `resources/app.asar` and the matching archive-hash record inside `claude.exe`. This invalidates the executable's original Authenticode signature.** Electron's ASAR integrity fuse remains enabled. Installation and restore need administrator access on a protected Windows Store installation. Use the cache mode if you want to preserve the signed executable.

Validated on one Windows Store installation of Claude **4.4212.0.0**: start through the original application entry, exit normally, then start through that same entry again. All three rendering-module types were patched on both starts. A separate isolated probe checked quoted, long, single-character and numeric formulas across restarts. A full client copy also passed install/restore tests; restore returned its executable signature to Valid. This does not establish compatibility with every build or installation type.

## Requirements

- Windows, Node.js 24+, Python 3.11+, and a locally installed compatible Claude Desktop.
- Keep Node at the path used to prepare the package. The startup hook uses that Node executable to transform and syntax-check the formula modules.
- Fully exit Claude through **File → Quit** or its tray menu before installing or restoring. No command terminates Claude processes.
- Keep the generated package and backups on this computer, outside the checkout. They contain third-party application files and local installation paths and can occupy several hundred megabytes. Never upload them to an issue or release.

## Prepare locally (no administrator access needed)

From the repository in PowerShell:

```powershell
$claudePackage = Get-AppxPackage -Name Claude | Sort-Object Version -Descending | Select-Object -First 1
if (-not $claudePackage) { throw 'Claude Store installation not found; specify your installation app directory explicitly.' }
$claudeApp = Join-Path $claudePackage.InstallLocation 'app'
$nativeState = Join-Path $env:LOCALAPPDATA ('claude-code-math-rendering\native\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
node bin/cli.js native-prepare --app-dir "$claudeApp" --output "$nativeState"
```

For a different installation, set `$claudeApp` to the directory containing `claude.exe` and `resources/app.asar`. That layout and archive/bootstrap format must match; unsupported structures are refused. Preparing only writes backups and candidates to the new output directory. It never writes the installed app. Check that the command succeeded before continuing.

The output must be new or empty. Keep the resulting `manifest.json`, `*.before`, and `*.after` files together. An already patched startup archive is refused; use the existing manifest for check/restore rather than preparing a second package over it.

## Install and check

After fully quitting Claude:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Manage-Native.ps1 -Action install -Manifest "$nativeState\manifest.json"
```

Windows may show a UAC prompt; confirm it yourself. Use the same Python installation when elevating. You can pass `-Python 'C:\path\to\python.exe'` if Python discovery is ambiguous.

Open Claude using its original icon, then view an existing formula conversation. Fully quit and reopen it to check restart behavior. File installation alone is not proof that the active renderer was patched.

Check the two installed file hashes without elevation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Manage-Native.ps1 -Action check -Manifest "$nativeState\manifest.json"
```

The runtime log is `ccmr-runtime.jsonl` in Claude's active user-data directory (the Store layout is normally `%LOCALAPPDATA%\Claude-Data\claude_PACKAGEFAMILY`). Look for fresh `attached` and `patched` events after launching. Logs contain patch types, public script filenames, timestamps and status; they do not intentionally record messages, cookies or credentials. Treat diagnostics as local and redact paths before sharing.

## Restore

Fully quit Claude, then use the manifest from this specific installation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Manage-Native.ps1 -Action restore -Manifest "$nativeState\manifest.json"
```

This restores the bytes before native installation, including the executable's original signature when those original bytes were correctly signed. Other modifications made before this installation are preserved. Backups and candidates are hash-checked; unknown current file contents are refused. Both targets are held exclusively while writing. A normal write failure attempts to restore the starting state of both files and records its result in the local journal. Power loss and disk failure can still need manual recovery.

## Updates and limitations

- Ordinary app/computer restarts load the hook again. No extra launcher, service, scheduled task, proxy, TLS certificate, external debugging port or security-fuse change is used.
- A hosted script filename can change and still be patched if its module prefix and source structure are recognized. New structures are passed through unchanged and may require a tool update. Formula length limits are removed; KaTeX syntax and resource limits remain.
- A desktop update, repair or reinstall can replace the hook. Prepare a **new output directory for the new installed version** and install again. Never restore an old package over an updated client; the hash check is intended to prevent that.
- To upgrade this tool's hook on an unchanged desktop version, restore using the old manifest, then prepare and install a new package with the newer tool. Do not discard the old backup before restoration.
- The hook uses Electron's in-process debugger only on Claude documents. It does not take over an already attached debugger. Opening DevTools can detach it; restart Claude to restore the hook. It can conflict with other tools using the same debugger.
- Only the four recognized hosted formula-asset prefixes on the exact Anthropic asset origin are intercepted. GET/200 script responses are transformed in a bounded worker; unrelated traffic, redirects and unsupported code pass through. Generated code is parsed without execution by the patcher, then the app's normal renderer executes the delivered module.

Implementation: [`runtime.cjs`](../src/runtime.cjs), [`native-package.js`](../src/native-package.js), [`install-native.py`](../scripts/install-native.py). References: [Electron Debugger API](https://www.electronjs.org/docs/latest/api/debugger), [Electron navigation events](https://www.electronjs.org/docs/latest/api/web-contents#event-did-start-navigation), [ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity).
