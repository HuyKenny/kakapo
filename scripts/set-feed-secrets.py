#!/usr/bin/env python3
"""Load FEED_URL_<id> (+ CJ creds) into the import Worker secrets of an environment. Values are never printed; only feed hosts.
Usage: python3 scripts/set-feed-secrets.py staging|production"""
import json, os, subprocess, sys, urllib.request
from urllib.parse import urlparse
envname = sys.argv[1]
if envname not in ('staging', 'production'):
    sys.exit('env must be staging|production')
CRED = '/home/kenny/ai/credentials'
def read(f):
    d = {}
    for l in open(f'{CRED}/{f}'):
        l = l.strip()
        if '=' in l and not l.startswith('#'):
            k, v = l.split('=', 1); d[k] = v.strip().strip('"\'')
    return d
kk, cf = read('.kakapo-credentials.env'), read('.cloudflare-credentials.env')
req = urllib.request.Request(kk['WP_URL'].rstrip('/') + '/wp-json/kakapo/v1/maintenance/export?table=_feed_urls', headers={'User-Agent': 'Mozilla/5.0 kakapo-migration', 'Authorization': 'Basic ' + __import__('base64').b64encode(f"{kk['WP_USER']}:{kk['WP_APP_PASSWORD']}".encode()).decode()})
resp = json.load(urllib.request.urlopen(req, timeout=120))
feeds = resp['feeds']
sfx = '_STAGING' if envname == 'staging' else '_PRODUCTION'
secrets = {'IMPORT_SHARED_SECRET': kk['IMPORT_SHARED_SECRET' + sfx]}
hosts = set()
for f in feeds:
    u = (f.get('url') or '').strip()
    if u.startswith('http'):
        secrets[f"FEED_URL_{f['id']}"] = u; hosts.add(urlparse(u).hostname)
for k in ('CJ_API_TOKEN', 'CJ_CID'):
    if kk.get(k): secrets[k] = kk[k]
if resp.get('cj_pid'): secrets['CJ_PID'] = resp['cj_pid']
print('feed secrets:', sum(1 for k in secrets if k.startswith('FEED_URL_')), 'hosts:', sorted(hosts))
env = {**os.environ, 'CLOUDFLARE_EMAIL': cf['CF_EMAIL'], 'CLOUDFLARE_API_KEY': cf.get('CF_GLOBAL_API_KEY') or cf['CF_API_KEY'], 'CLOUDFLARE_ACCOUNT_ID': kk['CF_ACCOUNT_ID']}
r = subprocess.run(['npx', 'wrangler', 'secret', 'bulk', '-c', 'workers/import/wrangler.jsonc', '--env', envname], input=json.dumps(secrets), text=True, env=env, capture_output=True, cwd='/home/kenny/ai/apps/kakapo')
print(r.stdout[-300:] if r.returncode == 0 else 'FAILED: ' + r.stderr[-400:])
