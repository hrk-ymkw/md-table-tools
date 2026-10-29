"""Exercise the GIF quality checks against real decoded animations."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('check_demo_gifs', ROOT / 'tools/check-demo-gifs.py')
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')


class GifChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        base = ROOT / 'test/.run'
        base.mkdir(parents=True, exist_ok=True)
        cls.directory = tempfile.TemporaryDirectory(prefix='gif-test-', dir=base)
        cls.path = Path(cls.directory.name)
        for name, source in (
            ('moving.gif', 'testsrc=size=80x80:rate=20:duration=2'),
            ('slow.gif', 'testsrc=size=80x80:rate=5:duration=2'),
            ('static.gif', 'color=c=black:s=80x80:r=20:d=2'),
        ):
            subprocess.run([FFMPEG, '-v', 'error', '-f', 'lavfi', '-i', source,
                            '-loop', '0', str(cls.path / name)], check=True)
        (cls.path / 'invalid.gif').write_text('not a GIF', encoding='utf8')

    @classmethod
    def tearDownClass(cls):
        if not cls.path.resolve().is_relative_to((ROOT / 'test/.run').resolve()):
            raise RuntimeError('refusing to clean up outside test/.run')
        cls.directory.cleanup()

    def test_accepts_animated_gif(self):
        CHECK.inspect(FFMPEG, self.path / 'moving.gif', 5 * 1024 * 1024, 15)

    def test_rejects_static_slow_invalid_and_oversized(self):
        for name in ('static.gif', 'slow.gif', 'invalid.gif'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                CHECK.inspect(FFMPEG, self.path / name, 5 * 1024 * 1024, 15)
        with self.assertRaises(ValueError):
            CHECK.inspect(FFMPEG, self.path / 'moving.gif', 1, 15)


if __name__ == '__main__':
    unittest.main()
