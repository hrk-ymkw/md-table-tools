"""Cut real screen-recording clips and convert them to an optimized GIF."""
import argparse
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ffmpeg', required=True, help='Path to the ffmpeg executable')
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--segments', required=True, help='Comma-separated start:end times in seconds')
    parser.add_argument('--crop', required=True, help='ffmpeg crop as width:height:x:y')
    parser.add_argument('--fps', type=int, default=15)
    parser.add_argument('--width', type=int, help='Resize the cropped video to this width')
    parser.add_argument('--colors', type=int, default=128)
    args = parser.parse_args()

    segments = []
    if not 2 <= args.colors <= 256:
        parser.error('--colors must be between 2 and 256')
    for pair in args.segments.split(','):
        start, end = map(float, pair.split(':'))
        if not 0 <= start < end:
            parser.error('Each segment must have 0 <= start < end')
        segments.append((start, end))
    filters = [f'[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[s{i}]'
               for i, (start, end) in enumerate(segments)]
    streams = ''.join(f'[s{i}]' for i in range(len(segments)))
    scale = f',scale={args.width}:-2:flags=lanczos' if args.width else ''
    filters.append(f'{streams}concat=n={len(segments)}:v=1:a=0,crop={args.crop}{scale},'
                   f'fps={args.fps},split[frames][palette_input]')
    filters.append(f'[palette_input]palettegen=stats_mode=diff:max_colors={args.colors}[palette]')
    filters.append('[frames][palette]paletteuse=dither=sierra2_4a:diff_mode=rectangle[out]')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
                    '-i', str(args.input), '-filter_complex', ';'.join(filters),
                    '-map', '[out]', '-loop', '0', str(args.output)], check=True)
    print(args.output)


if __name__ == '__main__':
    main()
