#!/usr/bin/env python3
"""Hotel pages that rank in Google Search (average position <= 30, or >= 5 impressions) must never be retired (301): write src/data/keep-hotels.json.

Why: only hotel pages rank on kakapo.cz (134 of 197 queries at position <= 15), and the retire job redirected exactly
those once their offers expired (e.g. chateau-grandcastle at position 1.2 -> /slovensko/). A kept hotel stays a 200 page
with "no offers now + similar hotels" and keeps its place in the sitemap.

Runs on Malina (service account ~/.config/gsc/service-account.json, read-only scope), refreshed weekly:
    scripts/static/gsc-keep.py [--days 180]
"""
import argparse, datetime as dt, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

import jwt  # PyJWT

KEY = Path('/home/kenny/.config/gsc/service-account.json')
OUT = Path(__file__).resolve().parent.parent.parent / 'src' / 'data' / 'keep-hotels.json'
SITE = 'sc-domain:kakapo.cz'


def token():
    d = json.loads(KEY.read_text()); now = int(time.time())
    a = jwt.encode({'iss': d['client_email'], 'scope': 'https://www.googleapis.com/auth/webmasters.readonly',
                    'aud': 'https://oauth2.googleapis.com/token', 'iat': now, 'exp': now + 3600}, d['private_key'], algorithm='RS256')
    r = urllib.request.Request('https://oauth2.googleapis.com/token', data=urllib.parse.urlencode(
        {'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': a}).encode())
    return json.load(urllib.request.urlopen(r))['access_token']


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--days', type=int, default=180); a = ap.parse_args()
    tok = token(); end = dt.date.today() - dt.timedelta(days=3); start = end - dt.timedelta(days=a.days)
    slugs: dict[str, int] = {}; row = 0
    while True:
        body = {'startDate': start.isoformat(), 'endDate': end.isoformat(), 'dimensions': ['page'], 'rowLimit': 25000, 'startRow': row,
                'dimensionFilterGroups': [{'filters': [{'dimension': 'page', 'operator': 'contains', 'expression': '/hotel/'}]}]}
        r = urllib.request.Request(f'https://www.googleapis.com/webmasters/v3/sites/{urllib.parse.quote(SITE, safe="")}/searchAnalytics/query',
                                   data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
        rows = json.load(urllib.request.urlopen(r)).get('rows', [])
        for x in rows:
            m = re.match(r'https://kakapo\.cz/hotel/([a-z0-9-]+)/?$', x['keys'][0])
            # a page that really shows up: average position <= 30 or a few impressions (position-80 singles are noise)
            if m and (x['position'] <= 30 or x['impressions'] >= 5): slugs[m.group(1)] = slugs.get(m.group(1), 0) + int(x['impressions'])
        if len(rows) < 25000: break
        row += 25000
    out = sorted(slugs, key=lambda s: (-slugs[s], s))
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0) + '\n')
    print(f'{len(out)} hotel slugs ranking (pos <= 30 or >= 5 impressions) in the last {a.days} days -> {OUT.name}')


if __name__ == '__main__':
    sys.exit(main())
