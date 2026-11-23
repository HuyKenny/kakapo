#!/usr/bin/env python3
"""IndexNow ping after a successful deploy (was pingIndexNow() in the import Worker, which pinged before the pages existed).

Submits the sitemap URLs whose lastmod is today or yesterday (max 10 000) from data/state.db (site_cache 'sitemap:all').
The key is public by design (served as /<key>.txt). Prints counts and the HTTP status only.

    python3 scripts/static/indexnow.py data/state.db
"""
import datetime
import json
import re
import sqlite3
import sys
import urllib.error
import urllib.request

KEY = 'fe36085e9198035f67a3f56ddaee9101'
SITE = 'https://kakapo.cz'

con = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
row = con.execute("SELECT value FROM site_cache WHERE key = 'sitemap:all'").fetchone()
if not row:
    sys.exit('indexnow: no sitemap in the state')
today = datetime.datetime.now(datetime.timezone.utc).date()
days = {today.isoformat(), (today - datetime.timedelta(days=1)).isoformat()}
urls = [u for u, d in re.findall(r'<loc>([^<]+)</loc><changefreq>[^<]*</changefreq><lastmod>([^<]+)</lastmod>', row[0]) if d[:10] in days][:10_000]
if not urls:
    print('indexnow: nothing changed')
    sys.exit(0)
body = json.dumps({'host': 'kakapo.cz', 'key': KEY, 'keyLocation': f'{SITE}/{KEY}.txt', 'urlList': urls}).encode()
req = urllib.request.Request('https://api.indexnow.org/indexnow', data=body, method='POST', headers={'content-type': 'application/json; charset=utf-8'})
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        print(f'indexnow: {len(urls)} URLs, HTTP {r.status}')
except urllib.error.HTTPError as e:
    print(f'indexnow: {len(urls)} URLs, HTTP {e.code}')
