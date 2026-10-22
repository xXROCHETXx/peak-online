"""Create the per-host Windows release from the verified local PEAK experiment.

The published Pages directory never contains executables, runtime, logs or game data.
Only the original unmodified assets are fetched from the pinned upstream CDN.
"""
import argparse
import hashlib
import json
import re
import shutil
import zipfile
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[1]
CDN = 'https://cdn.jsdelivr.net/gh/wasmdotrip/Peak-Port@f1924c4fcd0099172f50f8d2a5273fda12fa1444'
SCRIPTS = ['host.css', 'host.js', 'socket-bridge.js', 'voice-pump.js', 'voice-output.js',
           'voice-bridge.js', 'room-controller.js', 'native-client.js', 'mic-worklet.js',
           'PEAK.voice.wasm', 'PEAK.voice.framework.js']

def cdn_entry(original, root):
    match = re.search(r'var MANIFEST = (\{.*?\n\});', original, re.S)
    if not match:
        raise ValueError('The source no longer has the expected Unity manifest.')
    manifest = json.loads(match[1])
    for name in ('code', 'framework'):
        entry = manifest[name]
        entry['local'] = True
        filename = entry['file'].split('?')[0].removeprefix('../')
        entry['bytes'] = (root / filename).stat().st_size
    replacements = [
        (match[0], 'var MANIFEST = ' + json.dumps(manifest, indent=2) + ';'),
        ('var BUILD = "Build";', 'var BUILD = ' + json.dumps(CDN + '/Build/') + ';'),
        ('var CDN_BASE = new URL(".", window.location.href).href.replace(/\\/$/, "");',
         'var CDN_BASE = ' + json.dumps(CDN) + ';'),
        ('var url = BUILD + "/" + urls[i];',
         'var url = new URL(urls[i], entry.local ? new URL("Build/", location.href).href : BUILD).href;'),
        ('script.src = BUILD + "/" + MANIFEST.loader.file;', 'script.src = new URL(MANIFEST.loader.file, BUILD).href;'),
        ('streamingAssetsUrl: "StreamingAssets",', 'streamingAssetsUrl: CDN_BASE + "/StreamingAssets",'),
        ('<script src="experimental/host.js"></script>', '<script src="experimental/host.js"></script>\n<script src="experimental/host-share.js"></script>'),
        ('// All player files, StreamingAssets and LevelBundles are served from here.',
         '// Original data, StreamingAssets and LevelBundles come from the pinned CDN.\n      // The patched code and networking scripts stay on this host.'),
    ]
    for before, after in replacements:
        if original.count(before) != 1:
            raise ValueError('Unexpected loader structure: ' + before)
        original = original.replace(before, after)
    return original

def copy_tree(source, destination):
    shutil.copytree(source, destination, ignore=shutil.ignore_patterns('bin', 'obj', '.git', '*.pdb'), dirs_exist_ok=True)

def package(game_root):
    # A dedicated ignored artifact directory; no mutation of the tested local game.
    out = REPOSITORY / 'artifacts' / 'PEAK-host-Windows'
    if out.exists():
        raise SystemExit('Artifact folder already exists; choose a new clean checkout or move it before rebuilding: ' + str(out))
    www = out / 'www'
    (www / 'experimental').mkdir(parents=True)
    html = cdn_entry((game_root / 'host.html').read_text(encoding='utf-8'), game_root)
    (www / 'host.html').write_text(html, encoding='utf-8')
    for filename in SCRIPTS:
        shutil.copy2(game_root / 'experimental' / filename, www / 'experimental' / filename)
    shutil.copy2(REPOSITORY / 'host' / 'host-share.js', www / 'experimental' / 'host-share.js')
    for filename in ('Crear partida.cmd', 'iniciar-online.ps1'):
        shutil.copy2(REPOSITORY / 'host' / filename, out / filename)
    copy_tree(game_root / 'host-server', out / 'host-server')
    # Include the actual voice patch source and upstream attribution next to its runtime.
    copy_tree(game_root / 'experimental' / 'voice-patch', out / 'source' / 'voice-patch')
    shutil.copy2(game_root / 'HOST-POR-CODIGO.md', out / 'source' / 'VALIDACION-LOCAL.md')
    shutil.copy2(REPOSITORY / 'README.md', out / 'LEEME.md')
    manifest = {'upstream_cdn': CDN, 'voice_default': 'Controles de PEAK', 'files': {}}
    for file in sorted(out.rglob('*')):
        if file.is_file():
            manifest['files'][file.relative_to(out).as_posix()] = hashlib.sha256(file.read_bytes()).hexdigest()
    (out / 'package-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    archive = REPOSITORY / 'artifacts' / 'PEAK-host-Windows.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for file in sorted(out.rglob('*')):
            if file.is_file():
                bundle.write(file, Path(out.name) / file.relative_to(out))
    print(json.dumps({'directory': str(out), 'archive': str(archive), 'archive_bytes': archive.stat().st_size,
                      'files': len(manifest['files']), 'cdn': CDN}, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-root', type=Path, required=True)
    args = parser.parse_args()
    package(args.game_root.resolve())
