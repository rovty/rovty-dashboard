"""Run the three local apps using docs/platform-navigation.md. All auth/data is mocked.
This exercises real navigation across separate origins; no real account or data writes.
"""
import asyncio
import base64
import json
import re
import time
import sys
from urllib.parse import urlparse, parse_qs

from playwright.async_api import async_playwright, expect
expect.set_options(timeout=15000)

SITE = 'http://127.0.0.1:5177'
DASH = 'http://127.0.0.1:5176'
WED = 'http://127.0.0.1:5178'
USER = {'id': '00000000-0000-4000-8000-000000000001', 'email': 'alex@example.test', 'aud': 'authenticated', 'role': 'authenticated', 'app_metadata': {'provider': 'email'}, 'user_metadata': {'full_name': 'Alex Morgan'}, 'created_at': '2026-01-01T00:00:00Z'}
WEDDING = {'id': '00000000-0000-4000-8000-000000000002', 'owner_id': USER['id'], 'slug': 'local-wedding', 'bride': 'Alex', 'groom': 'Sam', 'event_date': '2030-06-10T10:00:00Z', 'event_end': None, 'reception_date': None, 'reception_end': None, 'venue': 'Test venue', 'hall': 'Test hall', 'address': 'Test address', 'published': True, 'template': 'editorial', 'description': 'A test wedding', 'design': None, 'updated_at': '2026-01-01T00:00:00Z', 'created_at': '2026-01-01T00:00:00Z', 'bride_parents_names': '', 'groom_parents_names': '', 'couple_photo_url': None, 'venue_photo_url': None, 'maps_url': None, 'music_url': None, 'floor_plan_url': None}

def encode(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')

def session():
    expires = int(time.time()) + 3600
    return {'access_token': f'{encode({"alg": "HS256", "typ": "JWT"})}.{encode({"sub": USER["id"], "session_id": "00000000-0000-4000-8000-000000000003", "exp": expires})}.test', 'refresh_token': 'local-only', 'expires_in': 3600, 'expires_at': expires, 'token_type': 'bearer', 'user': USER}

async def fixture(browser, signed_in=True, width=1440):
    context = await browser.new_context(viewport={'width': width, 'height': 844}, reduced_motion='reduce')
    state = {'mints': 0, 'error': False, 'active': True, 'errors': [], 'revoked': False, 'outage': False, 'legacy': False, 'logouts': [], 'data': []}
    if signed_in:
        await context.add_init_script(f"if(location.origin === '{DASH}' && !localStorage.getItem('test-seeded')) {{ localStorage.setItem('sb-rovty-dashboard-test-auth-token', {json.dumps(json.dumps(session()))}); localStorage.setItem('test-seeded', '1'); }}")

    async def route(r):
        url = r.request.url
        path = urlparse(url).path
        if url.startswith(DASH + '/api/account/') or url.startswith(WED + '/api/session') or url.startswith(WED + '/api/data?'):
            assert r.request.headers.get('authorization', '').startswith('Bearer ')
            logout = path.endswith('/logout') or r.request.method == 'DELETE' and path == '/api/session'
            if state['outage']:
                return await r.fulfill(status=503, json={'error': 'Connection interrupted. Your edits are still here.', 'code': 'PLATFORM_UNAVAILABLE'})
            if logout:
                state['revoked'] = True
                state['logouts'].append(url)
                return await r.fulfill(json={'ok': True})
            code = 'SESSION_EXPIRED' if state['revoked'] else 'RECONNECT_REQUIRED' if state['legacy'] and url.startswith(WED) else 'ACCESS_REVOKED' if not state['active'] and url.startswith(WED) else None
            if code:
                message = 'Your Rovty session has ended.' if code == 'SESSION_EXPIRED' else 'Open Rovty Wed from your dashboard to reconnect.' if code == 'RECONNECT_REQUIRED' else 'Your product access is no longer active.'
                return await r.fulfill(status=403 if code == 'ACCESS_REVOKED' else 401, json={'error': message, 'message': message, 'code': code})
            if path == '/api/data':
                data_path = urlparse(parse_qs(urlparse(url).query)['path'][0]).path
                state['data'].append(data_path)
                if data_path.endswith('/weddings'): return await r.fulfill(json=WEDDING)
                if data_path.endswith('/seating_config'): return await r.fulfill(json={'published': False})
                return await r.fulfill(json=[])
            return await r.fulfill(json={'active': True})
        if url.startswith(WED + '/api/plan'):
            if state['revoked'] or not state['active']:
                return await r.fulfill(status=403, json={'error':'Your product access is no longer active.'})
            plan={'plan':'studio','active':True,'features':['website','templates','rsvp','guests','seating','team','canvas']}
            return await r.fulfill(json={'own':plan,'weddings':{WEDDING['id']:plan}})
        if url.startswith(WED + '/api/manage'):
            return await r.fulfill(status=403, json={'error': 'Rovty team access required.'})
        if 'rovty-dashboard-test.supabase.co' in url or 'rovty-wed-test.supabase.co' in url:
            path = urlparse(url).path
            if 'rovty-wed-test' in url and path.startswith('/rest/'):
                state['errors'].append('Private Wed data bypassed its gateway: ' + path)
                return await r.abort()
            if '/auth/v1/authorize' in path:
                return await r.fulfill(content_type='text/html', body='<h1>Test identity provider</h1>')
            if '/auth/v1/token' in path:
                return await r.fulfill(json=session())
            if '/auth/v1/user' in path:
                return await r.fulfill(json=USER)
            if '/auth/v1/logout' in path:
                return await r.fulfill(status=204, body='')
            if path.endswith('/product_access'):
                return await r.fulfill(json=[{'product': 'wed', 'status': 'active'}] if state['active'] else [])
            if path.endswith('/weddings'):
                return await r.fulfill(json=WEDDING)
            if path.endswith('/seating_config'):
                return await r.fulfill(json={'published': False})
            return await r.fulfill(json=[])
        if url == f'{DASH}/api/sso/mint':
            assert r.request.post_data_json == {'product': 'wed'}
            state['mints'] += 1
            return await r.fulfill(status=503 if state['error'] else 200, json={'error': 'Test connection unavailable'} if state['error'] else {'url': f'{WED}/sso?token=local-only'})
        if url.startswith(f'{WED}/sso?'):
            # Only the cross-Worker hand-off is stubbed. The actual admin, auth,
            # dashboard, router, and SDK run unchanged on separate local servers.
            state['legacy'] = False
            return await r.fulfill(content_type='text/html', body=f"<script>localStorage.setItem('sb-rovty-wed-test-auth-token', {json.dumps(json.dumps(session()))}); location.replace('/admin');</script>")
        if any(url.startswith(origin) for origin in [SITE, DASH, WED, 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/']):
            return await r.continue_()
        await r.abort()

    await context.route('**/*', route)
    page = await context.new_page()
    page.on('pageerror', lambda error: state['errors'].append(str(error)))
    return context, page, state

async def session_flows(browser):
    for logout_from in ['dashboard', 'wed']:
        context, page, state = await fixture(browser)
        await page.goto(f'{DASH}/open/wed', wait_until='domcontentloaded')
        await expect(page.get_by_role('button', name='Design', exact=True)).to_be_visible(timeout=30000)
        other = await context.new_page()
        await other.goto(DASH, wait_until='domcontentloaded')
        await expect(other.get_by_role('heading', name='Your apps')).to_be_visible()
        actor, observer = (other, page) if logout_from == 'dashboard' else (page, other)
        if logout_from == 'dashboard':
            await actor.get_by_role('button', name='Account options for Alex Morgan').click()
            await actor.get_by_role('menuitem', name='Sign out').click()
        else:
            await actor.get_by_role('button', name='Sign out', exact=True).click()
        await expect(actor).to_have_url(SITE + '/')
        await observer.bring_to_front()
        await observer.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}))")
        if logout_from == 'dashboard':
            await expect(observer.get_by_role('heading', name='Reconnect with Rovty')).to_be_visible(timeout=20000)
            await expect(observer.get_by_role('button', name='Design', exact=True)).to_have_count(0)
            assert await observer.evaluate("localStorage.getItem('sb-rovty-wed-test-auth-token')") is None
        else:
            await expect(observer).to_have_url(f'{DASH}/login', timeout=20000)
        assert len(state['logouts']) == 1, state['logouts']
        assert not state['errors'], state['errors']
        await context.close()
    print('PASS: logout from either app redirects home and clears the other app on return', flush=True)

    context, page, state = await fixture(browser)
    await page.goto(f'{DASH}/open/wed', wait_until='domcontentloaded')
    await page.get_by_role('button', name='Design', exact=True).click(timeout=30000)
    await page.get_by_role('button', name='Open design studio', exact=True).click()
    await page.get_by_label('Your welcome note').fill('Keep my unsaved wedding note')
    state['outage'] = True
    await page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}))")
    await expect(page.get_by_role('alert')).to_contain_text('Your edits are still here')
    await expect(page.get_by_label('Your welcome note')).to_have_value('Keep my unsaved wedding note')
    state['outage'] = False
    await page.get_by_role('button', name='Try again', exact=True).click()
    await expect(page.get_by_role('alert')).to_have_count(0)
    await expect(page.get_by_label('Your welcome note')).to_have_value('Keep my unsaved wedding note')
    # A rejected data request also clears cached private UI, without waiting for polling.
    state['active'] = False
    await page.get_by_role('button', name='Save to live site', exact=True).click()
    await expect(page.get_by_role('heading', name='Reconnect with Rovty')).to_be_visible()
    await expect(page.get_by_label('Your welcome note')).to_have_count(0)
    assert not state['errors'], state['errors']
    await context.close()
    print('PASS: outages preserve unsaved edits; access removal rejects the next save and clears private UI', flush=True)

    await recovery_flows(browser)

async def recovery_flows(browser):
    context, page, state = await fixture(browser)
    await page.goto(DASH, wait_until='domcontentloaded')
    await expect(page.get_by_role('heading', name='Your apps')).to_be_visible()
    state['outage'] = True
    await page.get_by_role('button', name='Account options for Alex Morgan').click()
    await page.get_by_role('menuitem', name='Sign out').click()
    await expect(page.get_by_role('alert')).to_contain_text('Couldn’t sign out. Please try again.')
    assert state['logouts'] == []
    assert page.url == DASH + '/'
    state['outage'] = False
    await page.get_by_role('menuitem', name='Sign out').click()
    await expect(page).to_have_url(SITE + '/')
    await context.close()
    print('PASS: failed central logout keeps a retryable session instead of reporting success', flush=True)

    context, page, state = await fixture(browser)
    await page.goto(f'{DASH}/open/wed', wait_until='domcontentloaded')
    await expect(page.get_by_role('button', name='Design', exact=True)).to_be_visible(timeout=30000)
    state['legacy'] = True
    await page.reload(wait_until='domcontentloaded')
    await expect(page.get_by_role('heading', name='Reconnect with Rovty')).to_be_visible()
    await page.get_by_role('link', name='Continue with Rovty').click()
    await expect(page.get_by_role('button', name='Design', exact=True)).to_be_visible(timeout=30000)
    assert state['mints'] == 2
    assert not state['errors'], state['errors']
    await context.close()
    print('PASS: legacy product sessions reconnect through a fresh dashboard handoff', flush=True)

async def run():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(channel='chrome', headless=True)
        if '--recovery-only' in sys.argv:
            await recovery_flows(browser)
            await browser.close()
            return
        if '--sessions-only' in sys.argv:
            await session_flows(browser)
            await browser.close()
            return
        context, page, state = await fixture(browser)
        await page.goto(SITE, wait_until='domcontentloaded')
        await page.locator('header').get_by_role('link', name='Apps', exact=True).click()
        await expect(page.get_by_role('heading', name='Your apps')).to_be_visible()
        await page.get_by_role('button', name='Open Rovty Wed').click()
        await expect(page.get_by_role('navigation', name='Rovty platform')).to_be_visible(timeout=30000)
        await page.get_by_role('button', name='Guests', exact=True).click()
        await expect(page).to_have_url(f'{WED}/admin?section=guests')
        await page.get_by_role('button', name='Design', exact=True).click()
        await expect(page).to_have_url(f'{WED}/admin?section=design')
        await page.go_back()
        await expect(page.get_by_role('button', name='Guests', exact=True)).to_have_attribute('aria-current', 'page')
        await page.go_forward()
        await expect(page.get_by_role('button', name='Design', exact=True)).to_have_attribute('aria-current', 'page')
        await page.reload(wait_until='domcontentloaded')
        await expect(page.get_by_role('button', name='Design', exact=True)).to_have_attribute('aria-current', 'page')
        await page.get_by_role('link', name='All apps', exact=True).click()
        await expect(page.get_by_role('heading', name='Your apps')).to_be_visible()
        await page.go_back()
        await expect(page).to_have_url(f'{WED}/admin?section=design')
        await expect(page.get_by_role('button', name='Design', exact=True)).to_have_attribute('aria-current', 'page')
        await page.go_forward()
        await expect(page.get_by_role('button', name='Open Rovty Wed')).to_be_enabled()
        assert state['mints'] == 1, 'Back/Forward must not replay the one-use hand-off'
        assert not state['errors'], state['errors']
        await context.close()
        print('PASS: website → apps → Wed, section Back/Forward and reload, All apps round-trip, no token replay', flush=True)

        context, page, state = await fixture(browser, signed_in=False, width=390)
        await page.goto(f'{WED}/admin', wait_until='domcontentloaded')
        await page.get_by_role('button', name='Continue with Rovty').click()
        await expect(page).to_have_url(f'{DASH}/login?next=%2Fopen%2Fwed')
        await page.reload(wait_until='domcontentloaded')
        await page.get_by_role('textbox', name='Email', exact=True).fill(USER['email'])
        await page.get_by_label('Password', exact=True).fill('local-test-only-password')
        await page.get_by_role('button', name='Sign in', exact=True).click()
        await expect(page.get_by_role('link', name='All apps', exact=True)).to_be_visible(timeout=30000)
        await expect(page).to_have_url(f'{WED}/admin')
        assert state['mints'] == 1
        await page.get_by_role('button', name='Guests', exact=True).click()
        await page.get_by_role('button', name='Seating', exact=True).click()
        await page.go_back()
        await expect(page.get_by_role('button', name='Guests', exact=True)).to_have_attribute('aria-current', 'page')
        await expect(page.get_by_role('link', name='All apps', exact=True)).to_be_in_viewport()
        await page.screenshot(path='/tmp/rovty-platform-mobile.png')
        assert not state['errors'], state['errors']
        await context.close()
        print('PASS: direct Wed entry → sign in → requested app; mobile history and All apps', flush=True)

        context, page, state = await fixture(browser, signed_in=False)
        await page.goto(f'{DASH}/login?next=%2Fopen%2Fwed', wait_until='domcontentloaded')
        await page.get_by_role('button', name='Continue with Google').click()
        await expect(page.get_by_role('heading', name='Test identity provider')).to_be_visible()
        callback = parse_qs(urlparse(page.url).query)['redirect_to'][0]
        assert callback == f'{DASH}/login?next=%2Fopen%2Fwed'
        await page.go_back()
        await expect(page.get_by_role('button', name='Continue with Google')).to_be_enabled()
        await context.close()
        print('PASS: OAuth carries a local product destination and returning from the provider unlocks sign-in', flush=True)

        for active, slug in [(False, 'wed'), (True, 'assist')]:
            context, page, state = await fixture(browser)
            state['active'] = active
            await page.goto(f'{DASH}/open/{slug}', wait_until='domcontentloaded')
            await expect(page.get_by_role('link', name='All apps', exact=True)).to_be_visible()
            if active:
                await expect(page.get_by_role('heading', name='App unavailable')).to_be_visible()
            else:
                await expect(page.get_by_role('link', name='See plans')).to_be_visible()
            assert state['mints'] == 0
            await context.close()
        print('PASS: direct links cannot launch inactive or planned apps', flush=True)

        context, page, state = await fixture(browser)
        await page.goto(DASH, wait_until='domcontentloaded')
        await expect(page.get_by_role('button', name='Open Rovty Wed')).to_be_enabled()
        state['active'] = False
        await page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}))")
        await expect(page.get_by_role('link', name='Get Rovty Wed')).to_be_visible()
        await page.evaluate("localStorage.removeItem('sb-rovty-dashboard-test-auth-token'); window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}))")
        await expect(page).to_have_url(f'{DASH}/login')
        await context.close()
        print('PASS: cached-page restore refreshes access and rejects a removed session', flush=True)

        context, page, state = await fixture(browser)
        await page.goto(f'{DASH}/open/wed', wait_until='domcontentloaded')
        await expect(page.get_by_role('button', name='Design', exact=True)).to_be_visible(timeout=30000)
        await page.get_by_role('button', name='Guests', exact=True).click()
        await page.get_by_role('button', name='Design', exact=True).click()
        await page.get_by_role('button', name='Open design studio', exact=True).click()
        await page.get_by_label('Your welcome note').fill('Unsaved test edit')
        page.once('dialog', lambda dialog: dialog.dismiss())
        await page.go_back()
        await expect(page).to_have_url(f'{WED}/admin?section=design')
        await expect(page.get_by_label('Your welcome note')).to_have_value('Unsaved test edit')
        assert not state['errors'], state['errors']
        await context.close()
        print('PASS: browser Back protects unsaved studio edits when leaving is cancelled', flush=True)

        await session_flows(browser)
        await browser.close()

if __name__ == '__main__':
    asyncio.run(run())
