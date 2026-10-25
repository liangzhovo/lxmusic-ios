#!/bin/bash
set -euo pipefail
REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$REPOSITORY_ROOT"
# The explicit capture matrix is shared with the Python driver.
export LX_UI_FORMS='tablet tabletportrait phone'
export LX_UI_PHASES='table favorites list settings menu navhidden library keyboard darktable darkmenu darklibrary darklist themeswitch lightagain palette-grey palette-orange palette-purple palette-blue'
python3 -u "$REPOSITORY_ROOT/scripts/run-ios-playback-smoke.py"
# Independently re-read saved files after the driver's simulator cleanup.
python3 - <<'PYTHON'
import hashlib, json, os, pathlib
p = pathlib.Path('build/checks').resolve()
for phase in ['online', 'offline']:
    report = json.loads((p / ('playback-' + phase + '.json')).read_text())
    assert report.get('success') and report.get('done'), report
manifest = json.loads((p / 'UI-MANIFEST.json').read_text())
assert manifest['commit'] == os.environ['GITHUB_SHA']
assert manifest['run'] == os.environ['GITHUB_RUN_ID']
assert manifest['count'] == len(manifest['screenshots']) == 54
for item in manifest['screenshots']:
    image = (p / item['image']).read_bytes()
    assert image.startswith(b'\x89PNG\r\n\x1a\n') and len(image) > 1024
    assert hashlib.sha256(image).hexdigest() == item['sha256']
    report = json.loads((p / item['report']).read_text())
    assert report.get('success') and report.get('done'), report
print('Native playback records and 54 production-view screenshots are present.')
PYTHON
