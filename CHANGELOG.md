# Changelog

## 0.3.0

- Add optional native startup mode: keep the original Claude application entry and transform recognized formula scripts as they load after app restarts.
- Add `native-prepare` and a Windows installer/check/restore script with local backups, version/hash checks, exclusive target handles, journaling and recovery after write errors.
- Preserve Electron's ASAR integrity fuse while updating the archive-hash record; explicitly document that modifying the executable invalidates its original Authenticode signature.
- Keep cache mode available without administrator access or executable modifications; clarify why newly deployed hosted assets can defeat a cache-only fix on the next launch.
- Restrict in-process interception to known formula assets on the exact asset origin; preserve unrelated responses, remove stale encoding/length headers on replacements, and continue original responses after errors.
- Add native packaging/worker tests, CDP empty-session regression coverage, scoped startup checks, and synthetic Windows install/rollback/failure tests.
- Manually verify a full normal quit/restart through the original Windows Store app entry on Claude 4.4212.0.0. Both starts patched all three rendering-module types. Isolated probes passed quoted, long, single-character and numeric cases across restarts; a full copy restored its valid executable signature on rollback. No vendor files or private diagnostics are distributed.

## 0.2.0

- Renamed the project to **Claude Code 公式渲染 / Claude Code Math Rendering**.
- Fix quoted formulas, numeric and Greek single characters, digit-leading expressions, implicit products, and numbered functions.
- Remove redundant currency, spreadsheet-cell and trailing-letter checks in both recognized Markdown renderer paths.
- Extend the explicit-delimiter policy to backslash inline formulas and one-line display formulas; remove explicit math-fence prose guessing.
- Keep code fences, escaped delimiters, link destinations, unmatched/streaming boundaries, and KaTeX security settings intact.
- Upgrade existing 0.1 length patches; preserve legacy state-directory compatibility.
- Parse generated modules for syntax without executing cached JavaScript.
- Add formula/context regression cases. The local investigation also exercised 108 combinations against the installed parser, 18 expressions against its KaTeX renderer, and actual code/link/escape/backslash cases. Those vendor resources are not distributed.

## 0.1.0

- Initial public release of the Windows cache patch CLI.
- Automatic profile discovery, read-only compatibility diagnostics, and explicit profile selection.
- Guard structure validation without executing cached source.
- Exact-length Zstandard replacement and targeted bytecode invalidation.
- Journaled local backups, integrity checks, rollback, and protection against reused cache offsets.
- English and Simplified Chinese documentation, optional Store app launcher, and synthetic tests.

Compatibility remains experimental. The original workaround was manually verified in existing and new Code conversations on Claude Desktop 4.4212.0.0; the generalized CLI has synthetic integration tests and read-only verification against that installation.
