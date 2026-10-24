"""Restore pinned models locally; model rights are separate from the source license."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'public/models'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--accept-model-terms', action='store_true')
args = parser.parse_args()

def manifest(name):
    return json.loads((MODELS / name).read_text('utf-8'))

def valid(path, model):
    return path.is_file() and (not model.get('bytes') or path.stat().st_size == model['bytes']) and hashlib.sha256(path.read_bytes()).hexdigest() == model['sha256']

face = dict(file='face_landmarker.task', **manifest('mediapipe-source.json'))
identity = manifest('identity-source.json')
rgb = manifest('rgb-source.json')['models']
models = [face, *rgb, identity]
missing = [m for m in models if not valid(MODELS / m['file'], m)]
if missing and not args.accept_model_terms:
    parser.error('Read public/models/README.md and upstream model terms first, then use --accept-model-terms. InsightFace weights are non-commercial research only.')
for model in missing:
    if (MODELS / model['file']).exists():
        raise ValueError(f"Hash mismatch: {model['file']}. Move it aside manually before restoring.")

def download(url, target):
    request = urllib.request.Request(url, headers={'User-Agent': 'beizhi-liveness-lab/0.1.0'})
    with urllib.request.urlopen(request, timeout=120) as response, target.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)

if any(m['file'] == face['file'] for m in missing):
    partial = MODELS / (face['file'] + '.part')
    download(face['url'], partial)
    if not valid(partial, face):
        raise ValueError('Face Landmarker checksum mismatch')
    partial.replace(MODELS / face['file'])

if any(m['file'] in {item['file'] for item in rgb} for m in missing):
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/export-models.py'), '--accept-model-terms'], check=False)
    if result.returncode:
        raise SystemExit(result.returncode)

if any(m['file'] == identity['file'] for m in missing):
    cache = ROOT / '.cache'
    cache.mkdir(exist_ok=True)
    archive = cache / 'buffalo_s.zip'
    if not archive.exists():
        partial = archive.with_suffix('.zip.part')
        download(identity['url'], partial)
        partial.replace(archive)
    # Read only the expected entry; never execute or unpack archive paths.
    with zipfile.ZipFile(archive) as package:
        data = package.read(identity['file'])
    if len(data) != identity['bytes'] or hashlib.sha256(data).hexdigest() != identity['sha256']:
        raise ValueError('MobileFaceNet checksum mismatch; inspect/remove .cache/buffalo_s.zip before retrying')
    partial = MODELS / (identity['file'] + '.part')
    partial.write_bytes(data)
    partial.replace(MODELS / identity['file'])

for model in models:
    if not valid(MODELS / model['file'], model):
        raise ValueError(f"Model checksum mismatch: {model['file']}")
    print(f"Verified SHA-256: {model['file']}", flush=True)
