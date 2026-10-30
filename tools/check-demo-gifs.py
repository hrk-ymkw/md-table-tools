"""Decode demo GIFs with ffmpeg and check size, frame rate and animation."""
import argparse
from fractions import Fraction
from pathlib import Path
import subprocess
import sys


def inspect(ffmpeg, path, max_bytes, min_fps):
    if not path.is_file():
        raise ValueError(f'file not found: {path}')
    size = path.stat().st_size
    with path.open('rb') as file:
        if file.read(6) not in (b'GIF87a', b'GIF89a'):
            raise ValueError(f'{path}: not a GIF file')
    if size > max_bytes:
        raise ValueError(f'{path}: {size} bytes exceeds {max_bytes}')
    result = subprocess.run(
        [ffmpeg, '-v', 'error', '-i', str(path), '-vsync', '0', '-f', 'framemd5', '-'],
        capture_output=True, text=True, check=True,
    )
    timebase = None
    dimensions = None
    frames = []
    for line in result.stdout.splitlines():
        if line.startswith('#tb 0:'):
            timebase = Fraction(line.split(':', 1)[1].strip())
        elif line.startswith('#dimensions 0:'):
            dimensions = line.split(':', 1)[1].strip()
        elif line and not line.startswith('#'):
            fields = [part.strip() for part in line.split(',')]
            if len(fields) != 6 or fields[0] != '0':
                raise ValueError(f'{path}: unexpected decoded frame data')
            frames.append((int(fields[2]), int(fields[3]), fields[5]))
    if not timebase or not dimensions or len(frames) < 2:
        raise ValueError(f'{path}: insufficient decoded frames or metadata')
    duration = float((frames[-1][0] + frames[-1][1] - frames[0][0]) * timebase)
    fps = len(frames) / duration if duration > 0 else 0
    distinct = len({frame[2] for frame in frames})
    if distinct < 2:
        raise ValueError(f'{path}: decoded frames are all identical')
    if fps + 0.01 < min_fps:
        raise ValueError(f'{path}: {fps:.2f} fps is below {min_fps:g} fps')
    print(f'PASS {path}: {dimensions}, {len(frames)} frames, {fps:.2f} fps, '
          f'{distinct} different frames, {size / 1024 / 1024:.2f} MiB')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--max-mib', type=float, default=5)
    parser.add_argument('--min-fps', type=float, default=15)
    parser.add_argument('files', nargs='+', type=Path)
    args = parser.parse_args()
    if args.max_mib <= 0 or args.min_fps <= 0:
        parser.error('limits must be positive')
    try:
        for path in args.files:
            inspect(args.ffmpeg, path, args.max_mib * 1024 * 1024, args.min_fps)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
