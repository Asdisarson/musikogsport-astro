"""Smoke-test the WP content pages and the contact form against a storefront: STOREFRONT_URL, default the worktree
dev server (http://127.0.0.1:4322). Exits non-zero on any failure.

By default the contact form is only checked with an incomplete submission, which the route rejects (400) before it
reaches WordPress, so no mail is sent. `--send-contact` also posts one complete test message: WordPress e-mails it
to the shop, so use it only against a local WordPress whose mail goes nowhere.

Usage: python3 scripts/verify_content_pages.py [--send-contact]
"""
import json, os, re, sys, urllib.error, urllib.request

B = os.environ.get('STOREFRONT_URL', 'http://127.0.0.1:4322').rstrip('/')
ok = True


def check(name, cond, detail=''):
    global ok
    ok &= bool(cond)
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))


def get(path):
    try:
        with urllib.request.urlopen(B + path, timeout=60) as r:
            return r.status, r.read().decode('utf-8', 'ignore')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'ignore')


def post_json(body):
    req = urllib.request.Request(B + '/api/contact', method='POST', headers={'Content-Type': 'application/json'}, data=json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def text(html):
    main = html[html.find('<main'):html.find('</main>')]
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', main)).strip()


for path, expect in [('/hafa-samband/', 'Viltu spjalla?'), ('/skilmalar/', 'Þjónustuskilmálar'),
                     ('/opnunartimi/', 'Virkir dagar'), ('/staerdir/', 'STRÁKAR'), ('/oskalisti/', 'Óskalisti'),
                     ('/thetta-er-ekki-til/', None)]:
    s, html = get(path)
    t = text(html)
    check(path, (s == 200 and expect in t) if expect else s == 404, f'{s} {t[:90]}')

s, html = get('/opnunartimi/')
at = html.find('Virkir')
check('opnunartimi keeps the line break', at >= 0 and re.search(r'<br\s*/?>', html[at:at + 200]) is not None)

s, body = post_json({'name': 'x'})
check('incomplete contact submit rejected before WordPress', s == 400, f'{s} {body[:80]}')

if '--send-contact' in sys.argv:
    s, body = post_json({'name': 'Prófun Claude', 'email': 'test@example.com', 'topic': 'almenn-fyrirspurn', 'message': 'Sjálfvirk prófun — má eyða.'})
    check('contact JSON submit (sends a real message)', s == 200, f'{s} {body[:80]}')
else:
    print('SKIP complete contact submit (sends mail; pass --send-contact to include it)')

print('OK' if ok else 'FAILED')
sys.exit(0 if ok else 1)
