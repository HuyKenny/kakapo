#!/usr/bin/env python3
"""Firma na zážitky (CJ) → kakapo: keeps the feed's allow-list equal to the partner category /zazitkove-pobyty/.

The CJ product feed (partnerIds 7918457) has ~1 000 products and no category, so the importer takes only the products listed on
https://www.firmanazazitky.cz/zazitkove-pobyty/ (type 'zazitky', shown in /zazitky/). Idempotent: creates the partner and feed 42 when
missing, otherwise rewrites the allow-list in feeds.mapping_json. Re-run when the partner adds stays (the importer itself runs daily).

    scripts/sync-fna-feed.py [--dry]
"""
import json, re, sys, urllib.request

CRED = '/home/kenny/ai/credentials/'
FEED_ID, PARTNER, CATEGORY = 42, 'firmanazazitky', 'https://www.firmanazazitky.cz/zazitkove-pobyty/'
DB = '302b7cb9-53f0-47f3-bb6a-239a7402334f'


def env(f):
    o = {}
    for l in open(CRED + f):
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', l.strip())
        if m: o[m[1]] = m[2].strip('"\'')
    return o


def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60).read().decode()


kk, cf = env('.kakapo-credentials.env'), env('.cloudflare-credentials.env')
slugs, prev = set(), -1
for page in range(1, 40):  # ?page=N is cumulative ("load more"); stop when it no longer grows
    found = set(re.findall(r'href="(?:https://www\.firmanazazitky\.cz)?/([a-z0-9-]+)"', get(f'{CATEGORY}?page={page}')))
    slugs = found
    if len(found) == prev: break
    prev = len(found)
# keep only product slugs: those that exist in the CJ feed
feed = []
for off in range(0, 5000, 500):
    q = '{ products(companyId: "%s", partnerIds: ["7918457"], offset: %d, limit: 500) { totalCount resultList { link } } }' % (kk['CJ_CID'], off)
    r = urllib.request.Request('https://ads.api.cj.com/query', json.dumps({'query': q}).encode(), {'Authorization': 'Bearer ' + kk['CJ_API_TOKEN'], 'Content-Type': 'application/json'})
    d = json.load(urllib.request.urlopen(r, timeout=90))['data']['products']
    feed += d['resultList']
    if off + 500 >= d['totalCount']: break
inFeed = {p['link'].split('?')[0].rstrip('/').split('/')[-1] for p in feed}
allow = sorted(slugs & inFeed)
print(f'category links {len(slugs)}, in CJ feed {len(allow)}')
if len(allow) < 50: sys.exit('suspiciously few products, not writing')
mapping = json.dumps({'source': 'cj', 'partner_id': '7918457', 'parser': 'fna', 'force_type': 'zazitky', 'only_slugs': allow}, ensure_ascii=False, separators=(',', ':'))
if '--dry' in sys.argv: sys.exit(0)
sql = [
    {'sql': "INSERT OR IGNORE INTO partners (slug, name, disclosure, enabled) VALUES (?, ?, '', 1)", 'params': [PARTNER, PARTNER]},
    {'sql': "INSERT INTO feeds (id, name, partner_slug, adapter, content_type, is_full_catalogue, source_ref, affiliate_params, interval_hours, enabled, source_kind, mapping_json) VALUES (?, 'Firma na zážitky', ?, 'cj-generic', 'products', 1, ?, '', 24, 1, 'cj', ?) ON CONFLICT(id) DO UPDATE SET mapping_json = excluded.mapping_json", 'params': [FEED_ID, PARTNER, f'FEED_URL_{FEED_ID}', mapping]},
]
r = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{kk['CF_ACCOUNT_ID']}/d1/database/{DB}/query", json.dumps({'batch': sql}).encode(),
                           {'X-Auth-Email': cf.get('CF_EMAIL') or kk['CF_AUTH_EMAIL'], 'X-Auth-Key': cf.get('CF_GLOBAL_API_KEY') or kk['CF_GLOBAL_API_KEY'], 'Content-Type': 'application/json'})
print('ok' if json.load(urllib.request.urlopen(r, timeout=60))['success'] else 'FAILED')
