"""Package existing automatic outputs for local Review. No inference or reference data."""
import argparse
import base64
import hashlib
import json
from pathlib import Path

ARTIFACTS = {
    'rawXml': 'A-homr.raw.musicxml',
    'candidateXml': 'C-integrated.candidate.musicxml',
    'evidence': 'evidence.json', 'links': 'source-links.json',
    'geometry': 'geometry/source-geometry.json',
    'provenance': 'geometry/token-event-provenance.json',
    'ocr': 'ocr.raw.json', 'slashes': 'slash-pixel-candidates.json',
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def package(candidate, image, output):
    artifacts = {}
    for key, name in ARTIFACTS.items():
        data = (candidate / name).read_bytes()
        artifacts[key] = {'text': data.decode('utf-8'), 'sha256': digest(data)}
    evidence = json.loads(artifacts['evidence']['text'])
    data = image.read_bytes()
    assert digest(data) == evidence['input']['sha256'], 'Original image binding mismatch'
    assert artifacts['rawXml']['sha256'] == evidence['engine']['rawXmlSha256']
    assert evidence['runtimeOracleUsed'] is False and evidence['sourceEligibility']['approved'] is False
    mime = 'image/png' if data.startswith(b'\x89PNG\r\n\x1a\n') else 'image/jpeg'
    bound_image = {'base64': base64.b64encode(data).decode('ascii'), 'sha256': digest(data),
                   'mimeType': mime, 'width': evidence['input']['size'][0], 'height': evidence['input']['size'][1]}
    manifest = 'image:' + bound_image['sha256'] + '\n' + ''.join(key + ':' + artifacts[key]['sha256'] + '\n' for key in sorted(artifacts))
    bundle = {'version': 'hm-local-candidate-v1', 'image': bound_image, 'artifacts': artifacts,
              'manifestSha256': digest(manifest.encode('utf-8'))}
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('xb') as stream:
        stream.write(json.dumps(bundle, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    print(json.dumps({'bundle': str(output), 'bytes': output.stat().st_size, 'manifest': bundle['manifestSha256'],
                      'inputHistoryUsed': False, 'inferenceExecuted': False}))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--candidate', type=Path, required=True)
    p.add_argument('--image', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    v = p.parse_args()
    package(v.candidate, v.image, v.output)
