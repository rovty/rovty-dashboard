"""Run the three local apps using docs/platform-navigation.md. All auth/data is mocked.
This exercises real navigation across separate origins; no real account or data writes.
"""
import asyncio
import base64
import json
import re
import time
from urllib.parse import urlparse, parse_qs

from playwright.async_api import async_playwright, expect

SITE = 'http://127.0.0.1:5177'
DASH = 'http://127.0.0.1:5176'
WED = 'http://127.0.0.1:5178'
USER = {'id': '00000000-0000-4000-8000-000000000001', 'email': 'alex@example.test', 'aud': 'authenticated', 'role': 'authenticated', 'app_metadata': {'provider': 'email'}, 'user_metadata': {'full_name': 'Alex Morgan'}, 'created_at': '2026-01-01T00:00:00Z'}
WEDDING = {'id': '00000000-0000-4000-8000-000000000002', 'owner_id': USER['id'], 'slug': 'local-wedding', 'bride': 'Alex', 'groom': 'Sam', 'event_date': '2030-06-10T10:00:00Z', 'event_end': None, 'reception_date': None, 'reception_end': None, 'venue': 'Test venue', 'hall': 'Test hall', 'address': 'Test address', 'published': True, 'template': 'editorial', 'description': 'A test wedding', 'design': None, 'updated_at': '2026-01-01T00:00:00Z', 'created_at': '2026-01-01T00:00:00Z', 'bride_parents_names': '', 'groom_parents_names': '', 'couple_photo_url': None, 'venue_photo_url': None, 'maps_url': None, 'music_url': None, 'floor_plan_url': None}

def encode(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')

def session():
    expires = int(time.time()) + 3600
    return {'access_token': f'{encode({"alg": "HS256", "typ": "JWT"})}.{encode({"sub": USER["id"], "exp": expires})}.test', 'refresh_token': 'local-only', 'expires_in': 3600, 'expires_at': expires, 'token_type': 'bearer', 'user': USER}

async def fixture(browser, signed_in=True, width=1440):
    context = await browser.new_context(viewport={'width': width, 'height': 844}, reduced_motion='reduce')
    state = {'mints': 0, 'error': False, 'active': True, 'errors': []}
    if signed_in:
        await context.add_init_script(f"if(location.origin === '{DASH}' && !localStorage.getItem('test-seeded')) {{ localStorage.setItem('sb-rovty-dashboard-test-auth-token', {json.dumps(json.dumps(session()))}); localStorage.setItem('test-seeded', '1'); }}")

    async def route(r):
        url = r.request.url
        if 'rovty-dashboard-test.supabase.co' in url or 'rovty-wed-test.supabase.co' in url:
            path = urlparse(url).path
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
            return await r.fulfill(content_type='text/html', body=f"<script>localStorage.setItem('sb-rovty-wed-test-auth-token', {json.dumps(json.dumps(session()))}); location.replace('/admin');</script>")
        if any(url.startswith(origin) for origin in [SITE, DASH, WED, 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/']):
            return await r.continue_()
        await r.abort()

    await context.route('**/*', route)
    page = await context.new_page()
    page.on('pageerror', lambda error: state['errors'].append(str(error)))
    return context, page, state

async def run():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(channel='chrome', headless=True)
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
        await page.get_by_label('Partner one', exact=True).fill('Unsaved test edit')
        page.once('dialog', lambda dialog: dialog.dismiss())
        await page.go_back()
        await expect(page).to_have_url(f'{WED}/admin?section=design')
        await expect(page.get_by_label('Partner one', exact=True)).to_have_value('Unsaved test edit')
        assert not state['errors'], state['errors']
        await context.close()
        print('PASS: browser Back protects unsaved studio edits when leaving is cancelled', flush=True)
        await browser.close()

if __name__ == '__main__':
    asyncio.run(run())
