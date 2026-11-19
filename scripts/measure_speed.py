#!/usr/bin/env python3
"""Measure the storefront's speed and the load it puts on WordPress, on this machine only.

Starts the built storefront (dist/, via server.mjs) on a spare port with WordPress reached through a small
counting proxy, then times each page type cold and warm and reports, per page view: response time, calls made
to WordPress, time WordPress spent on them, the Node process's CPU time, and the bytes of the page's images.

  WP_INTERNAL_URL=http://127.0.0.1:10125 npm run build     # the build bakes the WordPress address in
  python3 scripts/measure_speed.py --label baseline --out /path/to/result.json

It refuses any WordPress address that is not on this machine.
"""
import argparse
import http.client
import http.server
import json
import os
import re
import statistics
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_HOSTS = {'127.0.0.1', 'localhost', '::1'}


class Counter:
    def __init__(self):
        self.lock = threading.Lock()
        self.calls = 0
        self.seconds = 0.0

    def add(self, seconds):
        with self.lock:
            self.calls += 1
            self.seconds += seconds

    def take(self):
        with self.lock:
            out = (self.calls, self.seconds)
            self.calls, self.seconds = 0, 0.0
            return out


def make_proxy(target_host, target_port, counter):
    class Proxy(http.server.BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *args):
            pass

        def forward(self):
            length = int(self.headers.get('Content-Length') or 0)
            body = self.rfile.read(length) if length else None
            headers = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'connection')}
            headers['Host'] = f'{target_host}:{target_port}'
            started = time.perf_counter()
            conn = http.client.HTTPConnection(target_host, target_port, timeout=60)
            try:
                conn.request(self.command, self.path, body=body, headers=headers)
                res = conn.getresponse()
                data = res.read()
                counter.add(time.perf_counter() - started)
                self.send_response(res.status)
                for k, v in res.getheaders():
                    if k.lower() not in ('transfer-encoding', 'connection', 'content-length'):
                        self.send_header(k, v)
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                if self.command != 'HEAD':
                    self.wfile.write(data)
            except Exception:
                counter.add(time.perf_counter() - started)
                self.send_error(502)
            finally:
                conn.close()

        do_GET = do_POST = do_HEAD = do_PUT = do_DELETE = do_OPTIONS = forward

    return Proxy


def read_env(path):
    env = {}
    if os.path.exists(path):
        for line in open(path, encoding='utf-8'):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env


SITE_HOST = None  # sent as the forwarded host, as the production proxy does, so a local run counts as the site's own host


def fetch(url, headers=None, timeout=90):
    headers = dict(headers or {})
    if SITE_HOST and ':10025' not in url:
        headers.setdefault('X-Forwarded-Host', SITE_HOST)
        headers.setdefault('X-Forwarded-Proto', 'https')
    req = urllib.request.Request(url, headers=headers)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            first = time.perf_counter() - started
            body = res.read()
            return {'status': res.status, 'ttfb': first, 'total': time.perf_counter() - started, 'body': body,
                    'shell': res.headers.get('X-Mos-Shell')}
    except urllib.error.HTTPError as err:
        return {'status': err.code, 'ttfb': 0.0, 'total': time.perf_counter() - started, 'body': b''}


def cpu_seconds(pid):
    out = subprocess.run(['ps', '-p', str(pid), '-o', 'cputime='], capture_output=True, text=True).stdout.strip()
    if not out:
        return 0.0
    parts = [float(p) for p in out.split(':')]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def best_candidate(srcset, want):
    """The narrowest srcset candidate at least `want` wide, else the widest."""
    found = []
    for part in srcset.split(','):
        bits = part.strip().split()
        if len(bits) == 2 and bits[1].endswith('w') and bits[1][:-1].isdigit():
            found.append((int(bits[1][:-1]), bits[0]))
    if not found:
        return None
    found.sort()
    for width, url in found:
        if width >= want:
            return url
    return found[-1][1]


def image_urls(html, want):
    """What a browser that takes AVIF, then WebP, would fetch for each <img> at about `want` px wide."""
    urls = []
    pictures = set()
    for pic in re.finditer(r'<picture\b.*?</picture>', html, re.S):
        pictures.add(pic.span())
        source = re.search(r'<source\b[^>]*\bsrcset="([^"]+)"', pic.group(0))
        img = re.search(r'<img\b[^>]*>', pic.group(0))
        pick = best_candidate(source.group(1).replace('&amp;', '&'), want) if source else None
        if not pick and img:
            pick = pick_img(img.group(0), want)
        if pick:
            urls.append(pick)
    for img in re.finditer(r'<img\b[^>]*>', html):
        if any(a <= img.start() < b for a, b in pictures):
            continue
        pick = pick_img(img.group(0), want)
        if pick:
            urls.append(pick)
    return urls


def pick_img(tag, want):
    srcset = re.search(r'\bsrcset="([^"]+)"', tag)
    src = re.search(r'\bsrc="([^"]+)"', tag)
    pick = best_candidate(srcset.group(1).replace('&amp;', '&'), want) if srcset else None
    return pick or (src.group(1).replace('&amp;', '&') if src else None)


def image_bytes(base, urls):
    total, count = 0, 0
    for url in urls:
        if url.startswith('data:'):
            continue
        full = urllib.parse.urljoin(base, url)
        if urllib.parse.urlparse(full).hostname not in LOCAL_HOSTS:
            continue
        got = fetch(full, {'Accept': 'image/avif,image/webp,image/*'})
        if got['status'] == 200:
            total += len(got['body'])
            count += 1
    return total, count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--label', default='run')
    ap.add_argument('--out')
    ap.add_argument('--port', type=int, default=10126)
    ap.add_argument('--proxy-port', type=int, default=10125)
    ap.add_argument('--wordpress', default='http://127.0.0.1:10025')
    ap.add_argument('--warm', type=int, default=10)
    ap.add_argument('--site-host', help="forwarded host for storefront requests (the site's own host)")
    args = ap.parse_args()
    global SITE_HOST
    SITE_HOST = args.site_host

    wp = urllib.parse.urlparse(args.wordpress)
    if wp.hostname not in LOCAL_HOSTS:
        sys.exit('refusing: WordPress must be on this machine')

    counter = Counter()
    proxy = http.server.ThreadingHTTPServer(('127.0.0.1', args.proxy_port), make_proxy(wp.hostname, wp.port or 80, counter))
    threading.Thread(target=proxy.serve_forever, daemon=True).start()

    env = dict(os.environ)
    env.update(read_env(os.path.join(ROOT, '.env')))
    env.update({'HOST': '127.0.0.1', 'PORT': str(args.port), 'NODE_ENV': 'production', 'MOS_LOG_LEVEL': 'warn',
                'WP_INTERNAL_URL': f'http://127.0.0.1:{args.proxy_port}'})
    server = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f'http://127.0.0.1:{args.port}'
    try:
        for _ in range(60):
            try:
                if fetch(base + '/api/healthz/', timeout=2)['status'] == 200:
                    break
            except Exception:
                time.sleep(0.5)
        else:
            sys.exit('the storefront did not start')
        counter.take()

        store = json.loads(fetch(f'{args.wordpress}/wp-json/wc/store/v1/products?per_page=27')['body'])
        variable = next(p for p in store if p['type'] == 'variable')
        pdp = urllib.parse.urlparse(variable['permalink']).path
        listing = fetch(base + '/verslun/')
        counter.take()
        category = re.search(r'href="(/voruflokkur/[a-z0-9/-]+/)"', listing['body'].decode('utf-8', 'replace'))
        pages = [('Forsíða', '/'), ('Vörulisti', '/verslun/'), ('Flokkur', category.group(1) if category else '/verslun/'),
                 ('Síaður listi', '/verslun/?utsala=1'), ('Vörusíða', pdp)]

        # A restart so every page's first view below is truly cold.
        server.terminate(); server.wait()
        server = subprocess.Popen(['node', 'server.mjs'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try:
                if fetch(base + '/api/healthz/', timeout=2)['status'] == 200:
                    break
            except Exception:
                time.sleep(0.5)
        counter.take()

        rows = []
        for name, path in pages:
            cold = fetch(base + path)
            time.sleep(0.3)
            cold_calls, cold_wp = counter.take()
            cpu_before = cpu_seconds(server.pid)
            warm = [fetch(base + path) for _ in range(args.warm)]
            time.sleep(0.3)
            warm_calls, warm_wp = counter.take()
            cpu = (cpu_seconds(server.pid) - cpu_before) / args.warm
            rows.append({'page': name, 'path': path, 'status': cold['status'], 'html_bytes': len(cold['body']),
                         'shell': warm[-1].get('shell'),
                         'cold_s': cold['total'], 'cold_wp_calls': cold_calls, 'cold_wp_s': cold_wp,
                         'warm_s': statistics.median(w['total'] for w in warm),
                         'warm_wp_calls': warm_calls / args.warm, 'warm_wp_s': warm_wp / args.warm, 'warm_cpu_s': cpu})

        live = []
        ids = ','.join(str(p['id']) for p in store)
        for name, path in [('Verð og lager, 27 vörur', f'/api/live/?ids={ids}'), ('Verð og lager, vörusíða', f"/api/live/product/{variable['id']}/")]:
            first = fetch(base + path)
            if first['status'] != 200:
                continue
            counter.take()
            shots = [fetch(base + path) for _ in range(args.warm)]
            time.sleep(0.3)
            calls, wp_s = counter.take()
            live.append({'call': name, 'median_s': statistics.median(s['total'] for s in shots),
                         'wp_calls': calls / args.warm, 'wp_s': wp_s / args.warm, 'bytes': len(first['body'])})

        home = fetch(base + '/')['body'].decode('utf-8', 'replace')
        wall = listing['body'].decode('utf-8', 'replace')
        hero_tag = re.search(r'<section[^>]*class="[^"]*\bhero\b.*?</section>', home, re.S)
        hero = image_urls(hero_tag.group(0), 1536)[:1] if hero_tag else []
        hero_bytes, hero_n = image_bytes(base, hero)
        grid = re.search(r'data-archive-grid.*', wall, re.S)
        cards = image_urls(grid.group(0) if grid else wall, 450)[:27]
        card_bytes, card_n = image_bytes(base, cards)
        images = {'hero_bytes': hero_bytes, 'hero_images': hero_n, 'card_bytes': card_bytes, 'card_images': card_n}

        result = {'label': args.label, 'pages': rows, 'live': live, 'images': images}
        if args.out:
            with open(args.out, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False, indent=1)
        print(f"== {args.label}")
        print('page | cold s | cold WP calls | cold WP s | warm s | warm WP calls | warm WP s | warm CPU ms | HTML KB')
        for r in rows:
            print(f"{r['page']} | {r['cold_s']:.3f} | {r['cold_wp_calls']} | {r['cold_wp_s']:.2f} | {r['warm_s']:.3f} | "
                  f"{r['warm_wp_calls']:.1f} | {r['warm_wp_s']:.3f} | {r['warm_cpu_s'] * 1000:.1f} | {r['html_bytes'] / 1024:.0f} | {r.get('shell')}")
        for l in live:
            print(f"{l['call']} | median {l['median_s']:.3f} s | WP calls {l['wp_calls']:.1f} | WP s {l['wp_s']:.3f} | {l['bytes']} B")
        print(f"images | hero {hero_bytes / 1024:.0f} KB ({hero_n}) | {card_n} cards {card_bytes / 1024:.0f} KB")
    finally:
        server.terminate()
        proxy.shutdown()


if __name__ == '__main__':
    main()
