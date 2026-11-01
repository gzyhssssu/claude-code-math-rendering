# Contributing

Use Node.js 24+ and run `npm test`. There are no dependencies to install.

Use synthetic fixtures for changes to cache handling. Do not commit vendor JavaScript, real cache files, profile paths, chat screenshots, local backup manifests, credentials, or other personal data. Keep compatibility changes narrow and explain the exact guard structure being recognized.

Any change that writes cache data should preserve byte lengths, validate allocation and entry identity, keep a verifiable backup before the first write, and refuse unrelated or changed entries. Add meaningful tests for rollback and failure paths. Do not execute cached code to validate a patch. Do not introduce network requests, debugging switches, certificate changes, or forced process termination into the patch path.

Native mode deliberately changes the startup archive and its embedded EXE hash record, invalidating the original signature. Keep it optional, document this effect, preserve integrity fuses, and refuse mismatched versions/backups. Never commit generated native packages, application binaries, backup bodies or local manifests. Run `python -m unittest discover -s test -p test_native_install.py -v` on Windows for the synthetic file-transaction tests. In-process debugger interception must remain limited to recognized formula assets; unrelated requests and failed transforms must continue unchanged.

An automated test passing does not demonstrate that a particular live Claude build is compatible. Report app version, installation type, asset-format compatibility, and whether the actual conversation view was tested. Redact local account names from diagnostics.
