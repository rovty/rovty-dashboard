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


async def fixture(browser, *, access='active', width=1440, authenticated=True, profile=None):
    context = await browser.new_context(viewport={'width': width, 'height': 844 if width < 600 else 1000}, device_scale_factor=1)
    user = {**USER, 'user_metadata': USER['user_metadata'] if profile is None else profile}
    state = {'access': access, 'mint_error': False, 'mint_calls': [], 'logout_error': False, 'queries': [], 'errors': []}
    if authenticated:
        expires = int(time.time()) + 3600
        session = {
            'access_token': f'{encode({"alg": "HS256", "typ": "JWT"})}.{encode({"sub": USER["id"], "exp": expires})}.test',
            'refresh_token': 'local-test-only', 'expires_in': 3600,
            'expires_at': expires, 'token_type': 'bearer', 'user': user,
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
            await request_route.fulfill(json=user)
        elif url == f'{BASE}/api/sso/mint':
            state['mint_calls'].append(request.post_data_json)
            assert request.headers.get('authorization', '').startswith('Bearer ')
            await request_route.fulfill(status=503 if state['mint_error'] else 200, json={'error': 'Please try opening your product again.'} if state['mint_error'] else {'url': f'{BASE}/test-sso-landed'})
        elif url == f'{BASE}/test-sso-landed':
            await request_route.fulfill(content_type='text/html', body='<h1>Product hand-off reached</h1>')
        elif url.startswith(BASE) or url.startswith('https://rovty.com/') or url.startswith('https://fonts.googleapis.com/') or url.startswith('https://fonts.gstatic.com/'):
            await request_route.continue_()
        else:
            await request_route.abort()

    await context.route('**/*', route)
    page = await context.new_page()
    page.on('pageerror', lambda error: state['errors'].append(str(error)))
    await page.goto(BASE, wait_until='domcontentloaded')
    if authenticated:
        await expect(page.get_by_role('heading', name='Your apps')).to_be_visible()
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
        await expect(page.get_by_text('1 app ready to open')).to_be_visible()
        await expect(page.locator('.account-name')).to_have_text('Alex Morgan')
        await expect(page.get_by_role('button', name='Sign out', exact=True)).to_be_visible()
        assert not await page.get_by_text('Rovty Assist', exact=True).count()
        assert not await page.get_by_text('In development', exact=True).count()
        assert not await page.get_by_text('Your account', exact=True).count()
        assert not await page.get_by_role('link', name='View account', exact=True).count()
        assert not await page.locator('a[href^="mailto:"]').count()
        assert not await page.get_by_role('group', name='Filter products').count()
        assert all('user_id=eq.' + USER['id'] in url for url in state['queries'])
        await no_overflow(page)
        await page.screenshot(path='/tmp/rovty-apps-desktop.png', full_page=True)
        assert await page.locator('.workspace-header').evaluate("el => getComputedStyle(el).backdropFilter") != 'none'
        await page.get_by_role('navigation', name='Workspace', exact=True).get_by_role('link', name='Apps', exact=True).click()
        await expect(page.get_by_role('button', name='Open Rovty Wed')).to_be_in_viewport()
        help_link = page.get_by_role('navigation', name='Workspace', exact=True).get_by_role('link', name='Get help')
        await expect(help_link).to_have_attribute('href', 'https://rovty.com/contact')
        async with page.expect_popup() as popup_info:
            await help_link.click()
        support_page = await popup_info.value
        await support_page.wait_for_url('https://rovty.com/contact')
        await expect(support_page.get_by_role('textbox', name='Full name')).to_be_visible(timeout=20000)
        await support_page.close()
        state['mint_error'] = True
        await page.get_by_role('button', name='Open Rovty Wed').click()
        await expect(page.get_by_role('alert')).to_contain_text('Please try opening your product again.')
        await expect(page.get_by_role('button', name='Open Rovty Wed')).to_be_enabled()
        state['mint_error'] = False
        await page.get_by_role('button', name='Open Rovty Wed').click()
        await expect(page.get_by_role('heading', name='Product hand-off reached')).to_be_visible()
        assert state['mint_calls'] == [{'product': 'wed'}, {'product': 'wed'}]
        assert not state['errors'], state['errors']
        await context.close()
        print('PASS: app launch and retry, direct identity, no development apps, contact form opens, glass header', flush=True)

        for width in [320, 390, 768, 1024, 1920]:
            context, page, state = await fixture(browser, width=width)
            await expect(page.get_by_role('button', name='Open Rovty Wed')).to_be_enabled()
            await expect(page.get_by_role('button', name='Open Rovty Wed')).to_be_in_viewport()
            await expect(page.get_by_role('button', name='Sign out', exact=True)).to_be_in_viewport()
            await no_overflow(page)
            if width == 390:
                await page.screenshot(path='/tmp/rovty-apps-mobile.png', full_page=True)
                await expect(page.get_by_role('navigation', name='Mobile workspace').get_by_role('link', name='Get help')).to_be_in_viewport()
            assert not state['errors'], state['errors']
            await context.close()
        print('PASS: 320, 390, 768, 1024, and 1920px layouts; direct mobile help and sign-out', flush=True)

        for profile, expected in [({}, USER['email']), ({'full_name': '  ', 'name': 'Provider Name'}, 'Provider Name'), ({'full_name': 'Alexandra Morgan With A Very Long Account Name'}, 'Alexandra Morgan With A Very Long Account Name')]:
            context, page, state = await fixture(browser, width=320, profile=profile)
            await expect(page.locator('.account-name')).to_have_text(expected)
            await no_overflow(page)
            await context.close()
        print('PASS: missing, blank, and long profile names', flush=True)

        for access in ['empty', 'inactive']:
            context, page, state = await fixture(browser, access=access)
            await expect(page.get_by_role('link', name='Get Rovty Wed')).to_have_attribute('href', 'https://rovty.com/pricing/wed')
            await expect(page.get_by_text('Choose an app to get started.')).to_be_visible()
            assert not await page.get_by_role('button', name='Open Rovty Wed').count()
            assert not await page.get_by_text('Rovty Assist', exact=True).count()
            assert state['mint_calls'] == []
            await context.close()
        print('PASS: empty and inactive accounts show only available apps without launch access', flush=True)

        context, page, state = await fixture(browser, access='error', width=390)
        await expect(page.get_by_role('alert')).to_contain_text('We couldn’t load your apps.', timeout=20000)
        assert not await page.get_by_role('link', name='Get Rovty Wed').count()
        await page.screenshot(path='/tmp/rovty-apps-error.png', full_page=True)
        state['access'] = 'active'
        await page.get_by_role('button', name='Try again').click()
        await expect(page.get_by_role('button', name='Open Rovty Wed')).to_be_enabled()
        await context.close()
        context, page, state = await fixture(browser, access='loading')
        await expect(page.get_by_role('status', name='Loading your apps')).to_be_visible()
        await expect(page.get_by_role('button', name='Open Rovty Wed')).to_be_enabled()
        await context.close()
        print('PASS: loading, errors, and access retry', flush=True)

        for error in [True, False]:
            context, page, state = await fixture(browser)
            state['logout_error'] = error
            await page.get_by_role('button', name='Sign out', exact=True).click()
            # Supabase clears the local session even when server revocation fails.
            await expect(page).to_have_url(f'{BASE}/login')
            assert await page.evaluate("localStorage.getItem('sb-rovty-dashboard-test-auth-token')") is None
            await context.close()
        context, page, state = await fixture(browser, authenticated=False)
        await expect(page).to_have_url(f'{BASE}/login')
        await context.close()
        print('PASS: direct sign-out, server-error session cleanup, and route protection', flush=True)
        await browser.close()
        print('Screenshots saved to /tmp/rovty-apps-{desktop,mobile,error}.png', flush=True)


if __name__ == '__main__':
    asyncio.run(run())
