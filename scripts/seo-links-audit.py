#!/usr/bin/env python3
"""Internal-link audit of kakapo.cz category pages: inbound links per URL (from <main> and sitewide), orphans, targets that redirect.

    scripts/seo-links-audit.py OUT.json            # crawl sitemap (everything except hotels/products) and write the link graph
    scripts/seo-links-audit.py --report OUT.json [BEFORE.json]   # print the summary (and the change against BEFORE)
"""
import collections, concurrent.futures as cf, json, re, sys, urllib.request

HOST = 'https://kakapo.cz'
UA = {'User-Agent': 'Mozilla/5.0 (kakapo-links-audit)'}


def get(u):
    for _ in range(3):
        try: return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40).read().decode()
        except Exception: pass
    return ''


def norm(u):
    return re.sub(r'[?#].*$', '', u)


def crawl(out):
    urls = []
    for s in re.findall(r'<loc>(.*?)</loc>', get(HOST + '/sitemap_index.xml')): urls += re.findall(r'<loc>(.*?)</loc>', get(s))
    pages = sorted({u.replace(HOST, '') for u in urls if '/hotel/' not in u and '/zazitek/' not in u})
    print(len(pages), 'category pages')
    graph = {}

    def one(p):
        h = get(HOST + p)
        m = re.search(r'<main.*?</main>', h, re.S)
        main = {norm(x) for x in re.findall(r'href="(/[a-z0-9][^"]*)"', m.group(0) if m else h)}
        allh = {norm(x) for x in re.findall(r'href="(/[a-z0-9][^"]*)"', h)}
        return p, sorted(main), sorted(allh)

    with cf.ThreadPoolExecutor(6) as ex:
        for i, (p, main, allh) in enumerate(ex.map(one, pages)):
            graph[p] = {'main': main, 'all': allh}
            if i % 500 == 0: print(i, flush=True)
    json.dump(graph, open(out, 'w'))


def stats(graph):
    inm, ina = collections.Counter(), collections.Counter()
    for p, g in graph.items():
        for t in g['main']:
            if t != p: inm[t] += 1
        for t in g['all']:
            if t != p: ina[t] += 1
    return inm, ina


def report(path, before=None):
    g = json.load(open(path)); inm, ina = stats(g)
    b = stats(json.load(open(before)))[0] if before else None
    cats = [p for p in g if p.count('/') == 2 and not p.startswith('/zazitek')]  # /country/
    orphans = [p for p in g if inm[p] == 0]
    print(f'pages {len(g)}; orphans (no link from <main> of another page): {len(orphans)}')
    print('top by inbound links from <main>:')
    for p, n in inm.most_common(25): print(f'  {n:5} {p}' + (f'  (before {b[p]})' if b else ''))
    for p in ['/egypt/', '/turecko/', '/recko/', '/chorvatsko/', '/bulharsko/', '/portugalsko/', '/albanie/', '/kapverdy/', '/destinace/']:
        print(f'  {p:16} main {inm[p]:4} sitewide {ina[p]:5}' + (f'  (before main {b[p]})' if b else ''))
    print('first orphans:', orphans[:15])


if __name__ == '__main__':
    a = sys.argv[1:]
    if a and a[0] == '--report': report(a[1], a[2] if len(a) > 2 else None)
    else: crawl(a[0])
