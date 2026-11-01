"""Install or restore a locally prepared, version-locked Claude startup hook.

Requires administrator on Windows. No ACL, ownership, fuse or certificate changes.
"""
import argparse
import contextlib
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import os
import msvcrt
import ctypes
from ctypes import wintypes as w

from windows_restore_io import open_for_restore, k32

k32.FlushFileBuffers.argtypes = [w.HANDLE]
k32.FlushFileBuffers.restype = w.BOOL


def open_target(file):
    handle = k32.CreateFileW(str(file), 0x80000000 | 0x40000000, 0, None, 3, 0, None)
    if handle == w.HANDLE(-1).value:
        return open_for_restore(file)
    try:
        descriptor = msvcrt.open_osfhandle(handle, os.O_BINARY | os.O_RDWR)
    except BaseException:
        k32.CloseHandle(handle)
        raise
    return os.fdopen(descriptor, 'r+b', buffering=0)


def digest_file(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def digest_stream(stream):
    stream.seek(0)
    return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(file, value):
    temp = file.with_suffix('.tmp')
    with temp.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, file)


def stopped(executable):
    script = "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | Select-Object @{n='path';e={$_.ExecutablePath}}) | ConvertTo-Json -Compress"
    output = subprocess.run(['powershell.exe', '-NoProfile', '-Command', script], capture_output=True,
                            text=True, check=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW).stdout.strip()
    rows = json.loads(output) if output else []
    if isinstance(rows, dict):
        rows = [rows]
    for item in rows:
        if not item.get('path') or Path(item['path']).resolve() == executable:
            raise RuntimeError('Claude Desktop is still running or cannot be identified. Quit from its tray and retry. No process was terminated.')


def write_file(stream, source):
    stream.seek(0)
    with source.open('rb') as incoming:
        while block := incoming.read(1024 * 1024):
            if stream.write(block) != len(block):
                raise OSError('Short write')
    stream.truncate()
    stream.flush()
    if not k32.FlushFileBuffers(msvcrt.get_osfhandle(stream.fileno())):
        import ctypes
        raise ctypes.WinError(ctypes.get_last_error())


def run(action, manifest_file):
    directory = manifest_file.parent.resolve()
    manifest = json.loads(manifest_file.read_text(encoding='utf-8-sig'))
    if manifest.get('format') != 1 or manifest.get('mode') != 'native-runtime':
        raise ValueError('Unsupported manifest')
    app_dir = Path(manifest['appDir']).resolve(strict=True)
    executable = app_dir / 'claude.exe'
    records = manifest.get('files', [])
    if [item.get('relative') for item in records] != ['resources/app.asar', 'claude.exe']:
        raise ValueError('Unexpected target list')
    prepared = []
    for item in records:
        for key in ['before', 'after']:
            file = (directory / item[key]).resolve(strict=True)
            if file.parent != directory or digest_file(file) != item[key + 'Hash']:
                raise ValueError('Backup/prepared file integrity mismatch')
        target = (app_dir / item['relative']).resolve(strict=True)
        if target not in [executable, app_dir / 'resources' / 'app.asar']:
            raise ValueError('Unexpected target path')
        current = digest_file(target)
        if current not in [item['beforeHash'], item['afterHash']]:
            raise ValueError('Installed files differ from this version-locked package; no files changed')
        prepared.append((item, target, current))
    if action == 'check':
        return {'success': True, 'action': action, 'version': manifest['version'],
                'states': ['patched' if value == item['afterHash'] else 'original' for item, _, value in prepared]}
    stopped(executable)
    desired = 'after' if action == 'install' else 'before'
    journal_file = directory / (action + '-journal.json')
    journal = {'action': action, 'status': 'preparing', 'files': [str(target) for _, target, _ in prepared]}
    with contextlib.ExitStack() as stack:
        streams = [(item, stack.enter_context(open_target(target)), current) for item, target, current in prepared]
        for item, stream, current in streams:
            if digest_stream(stream) != current:
                raise ValueError('Concurrent file change detected')
        stopped(executable)
        save(journal_file, journal)
        attempted = []
        try:
            for item, stream, current in streams:
                if current == item[desired + 'Hash']:
                    continue
                attempted.append((item, stream, current))
                write_file(stream, directory / item[desired])
                if digest_stream(stream) != item[desired + 'Hash']:
                    raise ValueError('Post-write verification failed')
            journal['status'] = 'installed' if action == 'install' else 'restored'
            save(journal_file, journal)
        except BaseException:
            recovery_errors = []
            for item, stream, current in reversed(attempted):
                original_key = 'before' if current == item['beforeHash'] else 'after'
                try:
                    write_file(stream, directory / item[original_key])
                    if digest_stream(stream) != current:
                        raise ValueError('Recovery verification failed')
                except Exception as error:
                    recovery_errors.append(str(error))
            journal['status'] = 'recovery-required' if recovery_errors else 'rolled-back'
            journal['recoveryErrors'] = recovery_errors
            save(journal_file, journal)
            raise
    return {'success': True, 'action': action, 'version': manifest['version'], 'manifest': str(manifest_file),
            'permissions_changed': False, 'signature': 'invalid (expected)' if action == 'install' else 'restored'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'install', 'restore'])
    parser.add_argument('--manifest', required=True, type=Path)
    args = parser.parse_args()
    manifest_file = args.manifest.resolve(strict=True)
    try:
        result = run(args.action, manifest_file)
    except Exception as error:
        result = {'success': False, 'action': args.action, 'error': f'{type(error).__name__}: {error}'}
    save(manifest_file.parent / (args.action + '-result.json'), result)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result['success'] else 1)
