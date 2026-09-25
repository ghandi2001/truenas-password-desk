#!/usr/bin/env python3
"""Prepare integrity-checked npm tarballs; never copy host native node_modules."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def matches(data, integrity):
    algorithm, expected = integrity.split('-', 1)
    return base64.b64encode(hashlib.new(algorithm, data).digest()).decode() == expected


def prepare(arch):
    root = Path(__file__).resolve().parent.parent
    lock = json.loads((root / 'package-lock.json').read_text())
    dest = root / '.build-cache'
    dest.mkdir(exist_ok=True, mode=0o700)
    manifest = []
    for name, package in lock['packages'].items():
        if not package.get('resolved'):
            continue
        if package.get('os') and 'linux' not in package['os']:
            continue
        if package.get('cpu') and arch not in package['cpu']:
            continue
        if package.get('libc') and 'glibc' not in package['libc']:
            continue
        integrity = package['integrity']
        algorithm, encoded = integrity.split('-', 1)
        digest = base64.b64decode(encoded).hex()
        archive = dest / (digest + '.tgz')
        cached = Path.home() / '.npm/_cacache/content-v2' / algorithm / digest[:2] / digest[2:4] / digest[4:]
        if not archive.exists() and cached.exists() and matches(cached.read_bytes(), integrity):
            shutil.copyfile(cached, archive)
        if not archive.exists():
            print('Downloading', name, flush=True)
            # Resume partial archives on transient interruption; final SRI validation is mandatory.
            partial = archive.with_suffix('.partial')
            for attempt in range(3):
                result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location',
                    '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '10',
                    '--max-time', '180', '--continue-at', '-', '--output', str(partial), package['resolved']])
                if result.returncode == 0:
                    break
                if attempt == 2:
                    raise RuntimeError('Archive download failed; partial content retained for explicit resume.')
            if not matches(partial.read_bytes(), integrity):
                raise RuntimeError('Archive integrity mismatch; refusing build input.')
            os.replace(partial, archive)
        if not matches(archive.read_bytes(), integrity):
            raise RuntimeError('Cached archive integrity mismatch.')
        manifest.append({'url': package['resolved'], 'integrity': integrity, 'file': archive.name})
    (dest / 'manifest.json').write_text(json.dumps(manifest))
    print('Prepared', len(manifest), 'verified archives for linux/' + arch)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--arch', choices=['arm64', 'x64'], required=True)
    args = parser.parse_args()
    prepare(args.arch)
