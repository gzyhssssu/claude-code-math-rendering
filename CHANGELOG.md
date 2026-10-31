# Changelog

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
