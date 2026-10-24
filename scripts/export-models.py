"""Development-only MiniFASNet conversion. Does not alter pinned manifests."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--accept-model-terms', action='store_true')
parser.add_argument('--output', type=Path, default=ROOT / 'public/models')
args = parser.parse_args()
if not args.accept_model_terms:
    parser.error('Read public/models/README.md and upstream terms, then pass --accept-model-terms.')
try:
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
except ImportError as error:
    raise SystemExit('Install scripts/requirements-export.txt in a Python 3.11 virtual environment. ' + str(error)) from error

manifest = json.loads((ROOT / 'public/models/rgb-source.json').read_text('utf-8'))
SOURCE = ROOT / '.model-source'
SOURCE.mkdir(exist_ok=True)
DEST = args.output.resolve()
DEST.mkdir(parents=True, exist_ok=True)
base = f"https://raw.githubusercontent.com/minivision-ai/Silent-Face-Anti-Spoofing/{manifest['revision']}/"

def restore(relative, path, expected_hash):
    if path.is_file():
        payload = path.read_bytes()
    else:
        request = urllib.request.Request(base + relative, headers={'User-Agent': 'beizhi-liveness-lab/0.1.0'})
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = response.read()
    if hashlib.sha256(payload).hexdigest() != expected_hash:
        raise ValueError(f'Upstream hash mismatch: {relative}')
    path.write_bytes(payload)

# Verify downloaded Python before importing and weights before loading.
restore('src/model_lib/MiniFASNet.py', SOURCE / 'MiniFASNet.py', manifest['architectureSha256'])
spec = importlib.util.spec_from_file_location('MiniFASNet', SOURCE / 'MiniFASNet.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
torch.set_num_threads(1)
torch.manual_seed(16)
for item, cls_name in zip(manifest['models'], ['MiniFASNetV2', 'MiniFASNetV1SE']):
    path = SOURCE / item['upstreamFile']
    restore('resources/anti_spoof_models/' + item['upstreamFile'], path, item['sourceSha256'])
    state = torch.load(path, map_location='cpu', weights_only=True)
    model = getattr(module, cls_name)(conv6_kernel=(5, 5))
    model.load_state_dict({key.removeprefix('module.'): value for key, value in state.items()})
    model.eval()
    sample = torch.rand(1, 3, 80, 80) * 255
    output = DEST / item['file']
    partial = output.with_suffix('.onnx.part')
    torch.onnx.export(model, sample, str(partial), input_names=['input'], output_names=['logits'], opset_version=13, dynamo=False)
    onnx.checker.check_model(str(partial))
    session = ort.InferenceSession(str(partial), providers=['CPUExecutionProvider'])
    errors = []
    for value in [sample, torch.zeros_like(sample), torch.full_like(sample, 255)]:
        with torch.no_grad():
            expected = model(value).numpy()
        actual = session.run(None, {'input': value.numpy()})[0]
        np.testing.assert_allclose(actual, expected, rtol=1e-3, atol=3e-3)
        errors.append(float(np.max(np.abs(actual - expected))))
    if hashlib.sha256(partial.read_bytes()).hexdigest() != item['sha256']:
        raise ValueError(f"ONNX checksum mismatch: {item['file']}. Use pinned export tools; manifest is never rewritten.")
    if output.exists() and hashlib.sha256(output.read_bytes()).hexdigest() != item['sha256']:
        raise ValueError(f'Refusing to overwrite modified model: {output}')
    partial.replace(output)
    print(item['file'], 'verified, max numerical error', max(errors), flush=True)
