"""Local-only dashboard checks. Requires Python Playwright and installed Chrome.

Start Vite with VITE_SUPABASE_URL=https://rovty-dashboard-test.supabase.co
and VITE_SUPABASE_ANON_KEY=local-test-anon. No real account is used.
"""
import asyncio
import base64
import json
import time

from playwright.async_api import async_playwright, expect

BASE = 'http://127.0.0.1:5176'
SUPABASE = 'https://rovty-dashboard-test.supabase.co'
USER = {
    'id': '00000000-0000-4000-8000-000000000001',
    'aud': 'authenticated', 'role': 'authenticated',
    'email': 'alex@example.test',
    'app_metadata': {'provider': 'email', 'providers': ['email']},
    'user_metadata': {'full_name': 'Alex Morgan'},
    'created_at': '2026-01-01T00:00:00Z',
}


def encode(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')


async def fixture(browser, *, access='active', width=1440, authenticated=True):
    context = await browser.new_context(viewport={'width': width, 'height': 1000}, device_scale_factor=1)
    state = {'access': access, 'mint_error': False, 'mint_calls': [], 'logout_error': False, 'queries': [], 'errors': []}
    if authenticated:
        expires = int(time.time()) + 3600
        session = {
            'access_token': f'{encode({"alg": "HS256", "typ": "JWT"})}.{encode({"sub": USER["id"], "exp": expires})}.test',
            'refresh_token': 'local-test-only', 'expires_in': 3600,
            'expires_at': expires, 'token_type': 'bearer', 'user': USER,
        }
        await context.add_init_script(f"localStorage.setItem('sb-rovty-dashboard-test-auth-token', {json.dumps(json.dumps(session))});")

    async def route(request_route):
        request = request_route.request
        url = request.url
        if url.startswith(f'{SUPABASE}/rest/v1/product_access'):
            state['queries'].append(url)
            if state['access'] == 'loading':
                await asyncio.sleep(1)
            if state['access'] == 'error':
                await request_route.fulfill(status=503, json={'message': 'Temporarily unavailable'})
            else:
                rows = [] if state['access'] == 'empty' else [{'product': 'wed', 'status': 'active' if state['access'] == 'loading' else state['access']}, {'product': 'assist', 'status': 'active'}, {'product': 'unknown', 'status': 'active'}]
                await request_route.fulfill(json=rows)
        elif url.startswith(f'{SUPABASE}/auth/v1/logout'):
            await request_route.fulfill(status=500 if state['logout_error'] else 204, body=json.dumps({'message': 'Retry sign out'}) if state['logout_error'] else '')
        elif url.startswith(f'{SUPABASE}/auth/v1/user'):
            await request_route.fulfill(json=USER)
        elif url == f'{BASE}/api/sso/mint':
            state['mint_calls'].append(request.post_data_json)
            assert request.headers.get('authorization', '').startswith('Bearer ')
            await request_route.fulfill(status=503 if state['mint_error'] else 200, json={'error': 'Please try opening your product again.'} if state['mint_error'] else {'url': f'{BASE}/test-sso-landed'})
        elif url == f'{BASE}/test-sso-landed':
            await request_route.fulfill(content_type='text/html', body='<h1>Product hand-off reached</h1>')
        elif url.startswith(BASE) or url.startswith('https://fonts.googleapis.com/') or url.startswith('https://fonts.gstatic.com/'):
            await request_route.continue_()
        else:
            await request_route.abort()

    await context.route('**/*', route)
    page = await context.new_page()
    page.on('pageerror', lambda error: state['errors'].append(str(error)))
    await page.goto(BASE, wait_until='domcontentloaded')
    if authenticated:
        await expect(page.get_by_role('heading', name='Your Rovty.')).to_be_visible()
    return context, page, state


async def no_overflow(page):
    assert await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Horizontal overflow'
    clipped = await page.locator('a, button').evaluate_all('''elements => elements.filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
    }).map(element => element.textContent)''')
    assert not clipped, f'Clipped controls: {clipped}'


async def run():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(channel='chrome', headless=True)
        context, page, state = await fixture(browser)
        await expect(page.get_by_role('button', name='Open Rovty Wed')).to_be_enabled()
        await expect(page.get_by_text('1 product available to you')).to_be_visible()
        assert not await page.get_by_role('link', name='Dashboard', exact=True).count()
        assert not await page.get_by_role('button', name='Open Rovty Assist').count()
        assert all('user_id=eq.' + USER['id'] in url for url in state['queries'])
        await no_overflow(page)
        await page.screenshot(path='/tmp/rovty-dashboard-desktop.png', full_page=True)
        await page.get_by_role('group', name='Filter products').get_by_role('button', name='Your access').click()
        await expect(page.get_by_role('heading', name='Rovty Wed', exact=True)).to_be_visible()
        await expect(page.get_by_role('heading', name='Rovty Assist', exact=True)).to_have_count(0)
        await page.get_by_role('button', name='Coming next').click()
        await expect(page.get_by_role('heading', name='Rovty Wed', exact=True)).to_have_count(0)
        await expect(page.get_by_role('link', name='Preview Rovty Assist')).to_have_attribute('href', 'https://rovty.com/products/assist')
        assert state['mint_calls'] == []
        await page.get_by_role('button', name='All products').click()
        menu = page.get_by_role('button', name='Your account menu')
        await menu.click()
        await expect(page.get_by_role('button', name='Sign out', exact=True)).to_be_visible()
        await page.keyboard.press('Escape')
        await expect(menu).to_be_focused()
        await expect(menu).to_have_attribute('aria-expanded', 'false')
        await menu.click()
        await page.get_by_role('link', name='View account').click()
        assert page.url.endswith('#account')
        await expect(page.get_by_role('navigation', name='Workspace', exact=True).get_by_role('link', name='Account')).to_have_attribute('aria-current', 'location')
        await expect(menu).to_have_attribute('aria-expanded', 'false')
        await page.get_by_role('navigation', name='Workspace', exact=True).get_by_role('link', name='Products').click()
        state['mint_error'] = True
        await page.get_by_role('button', name='Continue in Rovty Wed').click()
        await expect(page.get_by_role('alert')).to_contain_text('Please try opening your product again.')
        await expect(page.get_by_role('button', name='Open Rovty Wed')).to_be_enabled()
        state['mint_error'] = False
        await page.get_by_role('button', name='Open Rovty Wed').click()
        await expect(page.get_by_role('heading', name='Product hand-off reached')).to_be_visible()
        assert state['mint_calls'] == [{'product': 'wed'}, {'product': 'wed'}]
        assert not state['errors'], state['errors']
        await context.close()
        print('PASS: active access, catalog filters, planned-product isolation, navigation, menu, SSO failure and retry')

        for width in [320, 390, 768, 1024, 1920]:
            context, page, state = await fixture(browser, width=width)
            await expect(page.get_by_role('button', name='Open Rovty Wed')).to_be_enabled()
            await no_overflow(page)
            if width == 390:
                await page.screenshot(path='/tmp/rovty-dashboard-mobile.png', full_page=True)
                await page.get_by_role('navigation', name='Mobile workspace').get_by_role('link', name='Account').click()
                await expect(page.get_by_role('heading', name='Your account', exact=True)).to_be_in_viewport()
                await page.get_by_role('button', name='Your account menu').click()
                await expect(page.get_by_role('button', name='Sign out', exact=True)).to_be_in_viewport()
                await no_overflow(page)
            assert not state['errors'], state['errors']
            await context.close()
        print('PASS: responsive layouts at 320, 390, 768, 1024, and 1920 pixels; mobile navigation and menu')

        for access in ['empty', 'inactive']:
            context, page, state = await fixture(browser, access=access)
            await expect(page.get_by_role('link', name='Get Rovty Wed')).to_have_attribute('href', 'https://rovty.com/pricing/wed')
            await expect(page.get_by_text('0 products available to you')).to_be_visible()
            await page.get_by_role('group', name='Filter products').get_by_role('button', name='Your access').click()
            await expect(page.get_by_text('Your next chapter starts here.')).to_be_visible()
            await page.get_by_role('button', name='Explore products').click()
            await expect(page.get_by_role('heading', name='Rovty Wed', exact=True)).to_be_visible()
            assert state['mint_calls'] == []
            await context.close()
        print('PASS: empty and inactive accounts cannot launch products')

        context, page, state = await fixture(browser, access='error', width=390)
        await expect(page.get_by_role('alert')).to_contain_text('We couldn’t check your product access.', timeout=20000)
        await expect(page.get_by_role('button', name='Reconnect to check access')).to_be_disabled()
        await page.screenshot(path='/tmp/rovty-dashboard-error.png', full_page=True)
        state['access'] = 'active'
        await page.get_by_role('button', name='Try again').click()
        await expect(page.get_by_role('button', name='Open Rovty Wed')).to_be_enabled()
        await context.close()
        context, page, state = await fixture(browser, access='loading')
        await expect(page.get_by_role('button', name='Checking your access…')).to_be_disabled()
        await page.get_by_role('group', name='Filter products').get_by_role('button', name='Your access').click()
        await expect(page.get_by_role('status', name='Loading your products')).to_be_visible()
        await expect(page.get_by_role('button', name='Open Rovty Wed')).to_be_enabled()
        await context.close()
        print('PASS: loading, connection errors, and access retry')

        context, page, state = await fixture(browser)
        await page.get_by_role('button', name='Your account menu').click()
        state['logout_error'] = True
        await page.get_by_role('button', name='Sign out', exact=True).click()
        # Supabase clears the local session even when server revocation fails.
        await expect(page).to_have_url(f'{BASE}/login')
        assert await page.evaluate("localStorage.getItem('sb-rovty-dashboard-test-auth-token')") is None
        await context.close()
        context, page, state = await fixture(browser)
        await page.get_by_role('button', name='Your account menu').click()
        await page.get_by_role('button', name='Sign out', exact=True).click()
        await expect(page).to_have_url(f'{BASE}/login')
        await context.close()
        context, page, state = await fixture(browser, authenticated=False)
        await expect(page).to_have_url(f'{BASE}/login')
        await context.close()
        print('PASS: local sign-out during server errors, normal sign-out, and unauthenticated route protection')
        await browser.close()
        print('Screenshots saved to /tmp/rovty-dashboard-{desktop,mobile,error}.png')


if __name__ == '__main__':
    asyncio.run(run())
