# Claude Code 公式渲染 · Claude Code Math Rendering

[简体中文](README.zh-CN.md) · [MIT license](LICENSE)

Reversible Windows fixes for **quoted, numeric, Unicode and long formulas** in Claude Desktop's Code view.

Version **0.3** adds an optional [native startup mode](docs/native-runtime.md) that keeps the original app entry and reapplies supported formula fixes at load time, including after ordinary restarts. It modifies the startup archive and EXE integrity record, invalidating the original executable signature. The cache mode below preserves the executable and remains available without administrator access.

The original workaround was verified in both existing and new conversations on one Windows Store installation of Claude `4.4212.0.0`. This repository turns that workaround into a portable CLI with profile discovery, backups, integrity checks, and tests. The generalized CLI is tested with synthetic cache fixtures; it has not been verified across all Claude releases or installation types.

**Experimental and unofficial.** Compatibility depends on the actual hosted front-end build. Version 0.2 treats complete explicit math delimiters as math intent, removing recognized context/content guesses as well as length limits. KaTeX syntax, macro limits, memory, and rendering performance still apply. Very large formulas can slow the app down.

## Why this exists

Some valid `$…$` expressions rendered at 60 characters and appeared as raw text at 61. The Code view rendered locally, but loaded its JavaScript from Anthropic's hosted assets. Editing the bundled `ion-dist.asar` therefore did not affect the active page.

The issue also affects quoted `"$\hat\phi$"`, `$2x$`, `$10$`, `$α$`, and some single-character contexts. Independent checks existed in the shared guard, the primary Markdown scanner, and the alternate renderer. Version 0.2 patches all recognized layers and upgrades 0.1 length-only patches. It also fixes the 200-character backslash-inline guard and explicit display/fence content guesses. See the [rendering policy audit](docs/rendering-policy.md) for changed and retained rules.

The tool validates recognized module structures, generates replacements without executing vendor code, and syntax-checks the result using Node's non-executing module parser. It recompresses each response to exactly its original encoded byte length, using a Zstandard skippable frame when needed. Only matching response-body ranges are written; metadata and HTTP headers remain unchanged. Source length is preserved when the replacement is shorter; the encoded response length is always preserved. Matching compiled cache entries are moved to a backup so Chromium recompiles the changed modules.

Complete paired dollar signs now take priority over content guesses. For literal currency, shell variables, or ordinary text containing dollar signs, use `\$` or code spans. Common monetary examples remain literal in regression tests, but currency and math cannot always be distinguished automatically.

The cache mode does not execute cached JavaScript or patch executables. Native mode's file and signature changes are documented separately. Neither mode edits conversations, changes ACLs/ownership, installs certificates, opens external debugging ports, or connects to a proxy. The patch commands perform no network requests or telemetry. This is not an authentication, subscription, or model-access bypass.

## Cache mode requirements

- Windows; the Windows Store profile layout was verified. Other Windows layouts can be selected explicitly if they use the same Chromium blockfile cache format.
- [Node.js 24 or newer](https://nodejs.org/en/download), with native Zstandard support.
- An existing cached compatible formula module. Open a Code conversation containing math once before using the tool.
- Fully exit Claude Desktop from its system tray before installing or restoring. The tool never terminates processes.

No npm dependencies or administrator privileges are required. `npm install` is unnecessary.

## Quick start

Clone or download this repository, then use PowerShell in its directory:

```powershell
git clone https://github.com/gzyhssssu/claude-code-math-rendering.git
cd claude-code-math-rendering
node bin/cli.js doctor
```

`doctor` only inspects the cached formula resources. It reports compatible, already patched, and skipped resources; it cannot prove which of several historical assets the active page will use. Its local output includes the profile path. Redact that path before sharing diagnostics.

Exit Claude from the tray, then install:

```powershell
node bin/cli.js install
```

Reopen Claude and check a formula longer than 60 characters in both an existing conversation and a new conversation. `success: true` means the selected cached resources were processed; **the UI check is still necessary**.

If profile discovery is ambiguous, specify the directory containing `Cache` and `Code Cache`:

```powershell
node bin/cli.js doctor --profile "$env:LOCALAPPDATA\Claude-Data\claude_PACKAGEFAMILY"
node bin/cli.js install --profile "$env:LOCALAPPDATA\Claude-Data\claude_PACKAGEFAMILY"
```

Replace `claude_PACKAGEFAMILY` with the actual folder on your machine. Use `node bin/cli.js --help` for options.

## Backups and restore

State and backups default to:

```text
%LOCALAPPDATA%\claude-inline-math-unlimited\
```

The repository stays separate from local state. Backups contain the target vendor scripts and their compiled cache entries; keep them private and do not commit them. No chat records, cookies, or account tokens are intentionally exported.

The legacy state-directory name is retained after the project rename so existing 0.1 backups remain discoverable. Each restore returns to the bytes before that installation; restoring a 0.2 upgrade can therefore return to an earlier length-only patch.

With Claude fully closed:

```powershell
node bin/cli.js restore
```

To restore a particular transaction:

```powershell
node bin/cli.js restore --backup BACKUP_ID
```

Use the same `--state-dir PATH` for install and restore if overriding the default. Restore validates backup hashes and finds the current resource by URL and body hash, rather than trusting an old disk offset. Evicted, refetched, or otherwise changed resources are skipped instead of overwritten.

An interrupted process may leave `operation.lock` in the state directory. Ensure no patcher is running before renaming that lock. Backups are journaled before writes. A normal write error triggers automatic recovery, but power loss or a failed disk can still require manual intervention; this is not a crash-atomic database transaction.

## Updates and durability

The cache patch only affects resources already present. A newly loaded hosted front end can use a new JavaScript URL on the next launch **without a desktop app update**. Cache cleanup, repair, reinstall, or a refetched response can also remove its effect. It cannot guarantee persistence across restarts.

For automatic load-time application through the original entry point, see [native startup mode](docs/native-runtime.md). It was verified across normal exits/restarts on Claude 4.4212.0.0; desktop updates can still replace its hook, and unfamiliar hosted code still requires a compatibility update.

When it stops working, close Claude and run `doctor` and `install` again. The tool can adapt to renamed variables and new resource hashes **only while the supported code structure and cache encoding still match**. It refuses unfamiliar structures or replacements that cannot preserve the compressed response length. Updating the tool may then be necessary. It does not run a background monitor or guarantee automatic maintenance.

An optional launcher applies the same checks before starting the Store app:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Launch-Claude.ps1
```

This launcher also requires Claude to be fully closed. If a newly released resource is not cached yet, first open Claude normally, load a formula conversation, exit, and retry. The launcher does not make an incompatible build compatible.

## Tests and implementation

```powershell
npm test
```

Tests create synthetic fixtures in the OS temporary directory. They cover cache and native packaging, response interception, the isolated transformation worker, formula/context policy, both scanner paths, generated-module syntax, decompression bounds, exact-length recompression, allocation checks, compiled-cache keys, idempotence, rollback, relocated entries, failed writes, and tampered backups. They do not open a real profile or contact Claude or GitHub. Native Windows file transactions are also tested in CI with `python -m unittest discover -s test -p test_native_install.py -v` (skipped on other platforms). A separate private investigation tested real parser/KaTeX behavior and the live client; extracted vendor code is not shipped as test data.

No Claude application source, extracted scripts, binaries, real cache fixtures, or conversation screenshots are distributed here. The MIT license covers this tool's code, not third-party application resources modified locally at runtime.

Format references:

- [Chromium blockfile entries](https://github.com/chromium/chromium/blob/main/net/disk_cache/blockfile/disk_format.h)
- [Chromium block addresses](https://github.com/chromium/chromium/blob/main/net/disk_cache/blockfile/addr.h)
- [Chromium blockfile headers](https://github.com/chromium/chromium/blob/main/net/disk_cache/blockfile/disk_format_base.h)
- [Chromium simple-cache headers](https://github.com/chromium/chromium/blob/main/net/disk_cache/simple/simple_entry_format.h)
- [Zstandard skippable frames, RFC 8878](https://www.rfc-editor.org/rfc/rfc8878.html#section-3.1.2)
- [Node.js Zstandard API](https://nodejs.org/api/zlib.html)

Claude is a product of Anthropic. This project is not affiliated with or endorsed by Anthropic.
