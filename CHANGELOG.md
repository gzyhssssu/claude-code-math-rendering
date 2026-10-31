# Changelog

## 0.1.0

- Initial public release of the Windows cache patch CLI.
- Automatic profile discovery, read-only compatibility diagnostics, and explicit profile selection.
- Guard structure validation without executing cached source.
- Exact-length Zstandard replacement and targeted bytecode invalidation.
- Journaled local backups, integrity checks, rollback, and protection against reused cache offsets.
- English and Simplified Chinese documentation, optional Store app launcher, and synthetic tests.

Compatibility remains experimental. The original workaround was manually verified in existing and new Code conversations on Claude Desktop 4.4212.0.0; the generalized CLI has synthetic integration tests and read-only verification against that installation.
