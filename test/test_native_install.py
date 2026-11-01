"""Synthetic Windows file-transaction tests. No vendor resources or process execution."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


@unittest.skipUnless(sys.platform == 'win32', 'Windows file APIs')
class NativeInstallTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        scripts = Path(__file__).resolve().parents[1] / 'scripts'
        sys.path.insert(0, str(scripts))
        spec = importlib.util.spec_from_file_location('native_installer_test', scripts / 'install-native.py')
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ccmr-native-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / 'app'
        self.state = self.root / 'state'
        (self.app / 'resources').mkdir(parents=True)
        self.state.mkdir()
        self.files = []
        for number, name in enumerate(['resources/app.asar', 'claude.exe']):
            before = b'authored fixture original ' + bytes([number])
            after = b'authored fixture changed, a different length ' + bytes([number])
            (self.app / name).write_bytes(before)
            item = {'relative': name}
            for key, value in [('before', before), ('after', after)]:
                item[key] = f'{number}.{key}'
                item[key + 'Hash'] = hashlib.sha256(value).hexdigest()
                (self.state / item[key]).write_bytes(value)
            self.files.append(item)
        self.manifest = self.state / 'manifest.json'
        self.manifest.write_text(json.dumps({'format': 1, 'mode': 'native-runtime', 'version': 'test',
                                            'appDir': str(self.app), 'files': self.files}), encoding='utf-8')

    def assert_state(self, key):
        for item in self.files:
            self.assertEqual((self.app / item['relative']).read_bytes(), (self.state / item[key]).read_bytes())

    def test_install_restore_and_idempotence(self):
        self.module.run('install', self.manifest)
        self.assert_state('after')
        self.module.run('install', self.manifest)
        self.module.run('restore', self.manifest)
        self.assert_state('before')
        self.assertEqual(self.module.run('check', self.manifest)['states'], ['original', 'original'])

    def test_second_file_failure_restores_both_originals(self):
        write = self.module.write_file

        def fail(stream, source):
            if source.name == '1.after':
                raise OSError('injected second-file failure')
            return write(stream, source)

        with mock.patch.object(self.module, 'write_file', side_effect=fail):
            with self.assertRaises(OSError):
                self.module.run('install', self.manifest)
        self.assert_state('before')
        self.assertEqual(json.loads((self.state / 'install-journal.json').read_text())['status'], 'rolled-back')

    def test_tampered_backup_and_updated_target_are_refused(self):
        target = self.app / 'claude.exe'
        original = target.read_bytes()
        target.write_bytes(b'new application version')
        with self.assertRaises(ValueError):
            self.module.run('install', self.manifest)
        self.assertEqual((self.app / 'resources/app.asar').read_bytes(), (self.state / '0.before').read_bytes())
        target.write_bytes(original)
        (self.state / '1.after').write_bytes(b'tampered')
        with self.assertRaises(ValueError):
            self.module.run('install', self.manifest)
        self.assert_state('before')


if __name__ == '__main__':
    unittest.main()
