#!/usr/bin/env python3
"""Compare live kakapo.cz (WordPress) with a new environment: status, redirect target, canonical, robots, title, description, H1, H2 count,
JSON-LD types. Usage: python3 scripts/seo-parity.py <base-url> [--all-landings] [--hotels N] [--out report.json]
Staging is behind Access: the service token from credentials is sent automatically for *.workers.dev hosts."""
import json, re, subprocess, sys, html, concurrent.futures as cf, random, time
from urllib.parse import urlparse
base = sys.argv[1].rstrip('/')
hotels_n = int(sys.argv[sys.argv.index('--hotels') + 1]) if '--hotels' in sys.argv else 150
out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
def creds(f):
    d = {}
    for l in open('/home/kenny/ai/credentials/' + f):
        l = l.strip()
        if '=' in l and not l.startswith('#'):
            k, v = l.split('=', 1); d[k] = v.strip().strip('"\'')
    return d
sk = creds('.kuponmat-sk-credentials.env')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 kakapo-parity'
def fetch(url, access=False):
    cmd = ['curl', '-s', '-m', '60', '-A', UA, '-o', '-', '-w', '\n__STATUS__%{http_code} %{redirect_url}', '--max-redirs', '0', url]
    if access: cmd[1:1] = ['-H', 'CF-Access-Client-Id: ' + sk['ACCESS_CLIENT_ID_STAGING'], '-H', 'CF-Access-Client-Secret: ' + sk['ACCESS_CLIENT_SECRET_STAGING']]
    r = subprocess.run(cmd, capture_output=True, text=True, errors='replace').stdout
    body, _, tail = r.rpartition('\n__STATUS__')
    st, _, loc = tail.partition(' ')
    return int(st or 0), loc.strip(), body
def meta(body):
    g = lambda p: (re.search(p, body, re.S | re.I) or [None, ''])[1]
    t = lambda s: re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s))).strip().replace(' ', ' ')
    return {
        'title': t(g(r'<title[^>]*>(.*?)</title>')),
        'description': t(g(r'<meta name="description" content="([^"]*)"')),
        'canonical': g(r'<link rel="canonical" href="([^"]*)"'),
        'robots': re.sub(r'\s+', '', g(r'<meta name="robots" content="([^"]*)"')).replace('max-snippet:-1,max-video-preview:-1,max-image-preview:large', ''),
        'h1': t(g(r'<h1[^>]*>(.*?)</h1>')),
        'h2': len(re.findall(r'<h2[\b>]', body)),
        'ld': sorted(set(re.findall(r'"@type"\s*:\s*"([A-Za-z]+)"', ' '.join(re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', body, re.S))))),
    }
# URL sample from the LIVE sitemaps
idx = fetch('https://kakapo.cz/sitemap_index.xml')[2]
files = re.findall(r'<loc>([^<]+)</loc>', idx)
urls = []
for f in files:
    urls += re.findall(r'<loc>([^<]+)</loc>', fetch(f)[2])
paths = [urlparse(u).path for u in urls]
hot = [p for p in paths if p.startswith('/hotel/')]
oth = [p for p in paths if not p.startswith('/hotel/')]
random.seed(7)
sample = oth + random.sample(hot, min(hotels_n, len(hot))) + ['/dovolena/', '/vlastni-dopravou/', '/nic-takoveho-neexistuje/', '/hotel/neexistuje-xyz/', '/kypr/kypr/']
print(f'live sitemap URLs: {len(paths)} (hotels {len(hot)}), checking {len(sample)}')
live_host = 'https://kakapo.cz'
def check(p):
    time.sleep(0.15)
    a = fetch(live_host + p); b = fetch(base + p, access=base.endswith('workers.dev'))
    res = {'path': p, 'live': a[0], 'new': b[0], 'diff': []}
    if a[0] != b[0]: res['diff'].append(f'status {a[0]} vs {b[0]}')
    elif a[0] in (301, 302, 308):
        if urlparse(a[1]).path != urlparse(b[1]).path: res['diff'].append(f'redirect {urlparse(a[1]).path} vs {urlparse(b[1]).path}')
    elif a[0] == 200:
        ma, mb = meta(a[2]), meta(b[2])
        for k in ma:
            va, vb = ma[k], mb[k]
            if k == 'canonical': va, vb = urlparse(va).path, urlparse(vb).path
            if va != vb: res['diff'].append(f'{k}: {str(va)[:70]!r} vs {str(vb)[:70]!r}')
    return res
with cf.ThreadPoolExecutor(3) as ex: results = list(ex.map(check, sample))
bad = [r for r in results if r['diff']]
print(f'identical: {len(results) - len(bad)} / {len(results)}')
for r in bad[:60]: print(r['path'], '|', '; '.join(r['diff']))
if out: json.dump(results, open(out, 'w'), ensure_ascii=False, indent=1)
