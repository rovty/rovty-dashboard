"""Local mocked checkout/admin flows. No provider request or account mutation leaves this test."""
import asyncio,json,re
from pathlib import Path
from playwright.async_api import async_playwright,expect
from dashboard_browser import fixture,BASE
ID='00000000-0000-4000-8000-000000000005'
PLANS=[dict(product='wed',code=code,name=code.title(),price_cents=price,months=months,rank=rank,features=features,version=1,active=True) for code,price,months,rank,features in [('essential',490000,6,1,['website','templates','rsvp','guests']),('complete',790000,12,2,['website','templates','rsvp','guests','seating','team']),('studio',990000,24,3,['website','templates','rsvp','guests','seating','team','canvas'])]]
async def setup(browser,width=1440,viewer=False):
 c,p,s=await fixture(browser,width=width,access='empty')
 state={'status':'pending','writes':[]}
 order=dict(id=ID,product='wed',plan_name='Complete',subtotal_cents=790000,discount_cents=79000,amount_cents=711000,status='pending',mode='test',months=12,created_at='2026-09-21T12:00:00Z',checkout_url='https://payments.lk/checkout/local-mocked')
 user=dict(id=ID,email='couple@example.test',name='Alex & Sam',access=dict(plan='essential',active=True,features=['website'],revision=1,source='purchase'))
 async def api(r):
  path=r.request.url.split('/api/billing/')[1].split('?')[0];body=r.request.post_data_json if r.request.method=='POST' else {}
  if path=='catalog':result={'plans':PLANS,'mode':'test','checkout_enabled':True}
  elif path=='access':result={'active':False,'features':[],'revision':0}
  elif path=='quote':result={'subtotal_cents':790000,'discount_cents':79000,'amount_cents':711000}
  elif path=='checkout':state['writes'].append(body);result={'order_id':ID}
  elif path=='cancel':result={**order,'status':'expired'}
  elif path in ['order','resume']:result={**order,'status':state['status'],'provider_status':'open'}
  elif path=='orders':result=[{**order,'status':state['status']}]
  elif path=='admin':
   action=body['action']
   if action=='access':result={'role':'viewer' if viewer else 'admin'}
   elif action=='plans':result=PLANS
   elif action=='users':result={'items':[user],'total':1}
   elif action=='promotions':result=[]
   elif action=='orders':result={'items':[{**order,'email':user['email']}]}
   elif action=='audit':result=[]
   else:state['writes'].append(body);result={'ok':True}
  else:raise AssertionError(path)
  await r.fulfill(json=result)
 await c.route('**/api/billing/**',api)
 await c.route('https://payments.lk/**',lambda r:r.fulfill(content_type='text/html',body='<h1>Mock hosted checkout</h1>'))
 return c,p,s,state
async def main():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(channel='chrome',headless=True)
  for width in [1440,390]:
   c,p,s,state=await setup(browser,width)
   await p.goto(BASE+'/billing/wed?plan=complete')
   await expect(p.get_by_role('heading',name='A plan for your celebration.')).to_be_visible()
   await p.get_by_label('Promotion code').fill('WEDDING10')
   await p.get_by_role('button',name='Review total').click()
   await expect(p.get_by_text(re.compile(r'7,110\.00'))).to_be_visible()
   await p.evaluate('window.scrollTo(0,0)')
   await p.screenshot(path=f'/tmp/rovty-billing-{width}.png',full_page=True)
   assert await p.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'
   await p.get_by_role('button',name='Create order').click()
   await expect(p.get_by_role('heading',name='Your order.',exact=True)).to_be_visible()
   assert state['writes'][0]['expected_amount']==711000
   if width==390:
    await p.get_by_role('button',name='Change plan',exact=True).click()
    await expect(p.get_by_role('heading',name='A plan for your celebration.')).to_be_visible()
    await p.goto(BASE+'/billing/orders/'+ID)
   await p.get_by_role('button',name=re.compile('Continue to pay')).click()
   await expect(p.get_by_role('heading',name='Mock hosted checkout')).to_be_visible()
   await p.goto(BASE+'/billing/orders/'+ID+'?returned=success')
   await expect(p.get_by_role('heading',name='Your order.',exact=True)).to_be_visible()
   state['status']='paid'
   await p.get_by_role('button',name='Check payment status').click()
   await expect(p.get_by_role('heading',name='Test payment received.')).to_be_visible()
   await c.close()
  c,p,s,state=await setup(browser)
  await p.goto(BASE+'/billing/manage/wed')
  await expect(p.get_by_text('couple@example.test',exact=True)).to_be_visible()
  await p.get_by_role('button',name='Manage access').click()
  await p.get_by_label('Plan',exact=True).select_option('studio')
  await p.get_by_label('Reason for this change').fill('Approved customer upgrade')
  await p.get_by_role('button',name='Save changes').click()
  await expect(p.get_by_role('status').filter(has_text='Saved.')).to_be_visible()
  assert state['writes'][-1]['params']['plan']=='studio'
  await p.get_by_role('button',name='plans',exact=True).click()
  await p.get_by_role('button',name='Edit plan').first.click()
  await p.get_by_label('Price (LKR)').fill('5900')
  await p.get_by_label('Reason for this change').fill('New season pricing')
  await p.get_by_role('button',name='Save changes').click()
  await expect(p.get_by_role('status').filter(has_text='Saved.')).to_be_visible()
  assert state['writes'][-1]['params']['price_cents']==590000
  await p.get_by_role('button',name='promotions',exact=True).click()
  await p.get_by_role('button',name='Create promotion').click()
  await p.get_by_label('Code',exact=True).fill('SUMMER10')
  await p.get_by_label('Reason for this change').fill('Summer wedding promotion')
  await p.get_by_role('button',name='Save changes').click()
  await expect(p.get_by_role('status').filter(has_text='Saved.')).to_be_visible()
  assert state['writes'][-1]['params']['code']=='SUMMER10'
  await p.screenshot(path='/tmp/rovty-billing-admin.png',full_page=True)
  await c.close()
  c,p,s,state=await setup(browser,width=390,viewer=True)
  await p.goto(BASE+'/billing/manage/wed')
  await expect(p.get_by_text('couple@example.test',exact=True)).to_be_visible()
  assert await p.get_by_role('button',name='Manage access').count()==0
  assert await p.evaluate('document.documentElement.scrollWidth <= innerWidth')
  await c.close();await browser.close()
 print('PASS: desktop/mobile checkout, promotion totals, hosted handoff, pending return, test receipt, staff account assignment, price and promotion edits, viewer restrictions and responsive layout.')
asyncio.run(main())
