"""Billing transactions in an isolated disposable PostgreSQL container. No hosted writes."""
import concurrent.futures,json,pathlib,subprocess,time,uuid
ROOT=pathlib.Path(__file__).resolve().parents[1]
NAME='rovty-billing-test-'+uuid.uuid4().hex[:8]
def uid(n):return f'00000000-0000-4000-8000-{n:012d}'
def sql(q,ok=True):
 r=subprocess.run(['docker','exec','-i',NAME,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-qAt'],input=q,text=True,capture_output=True)
 assert (r.returncode==0)==ok,r.stderr or 'Expected rejection: '+q
 return r.stdout.strip() if ok else r.stderr
def literal(v):return "'"+json.dumps(v).replace("'","''")+"'::jsonb"
def admin(action,params,user=1):return json.loads(sql(f"select billing_admin('{uid(user)}','wed','{action}',{literal(params)});"))
def order(user=2,plan='essential',code='',mode='live',amount=490000):return json.loads(sql(f"select billing_create_order('{uid(user)}','wed','{plan}','{code}','{mode}','https://dash.example.test',{amount});"))
def event(o,typ='payment.succeeded',eid=None,**patch):
 p={'object':'payment','id':'pay_'+o['id'],'checkoutId':'chk_'+o['id'],'mode':o['mode'],'status':'succeeded','reference':o['id'],'currency':'LKR','amountCents':o['amount_cents'],'refundedCents':0,**patch}
 e={'object':'event','id':eid or str(uuid.uuid4()),'type':typ,'mode':o['mode'],'data':p if typ!='refund.succeeded' else {'payment':p}}
 return json.loads(sql('select billing_event('+literal(e)+');'))
subprocess.run(['docker','run','--rm','-d','--network','none','--name',NAME,'-e','POSTGRES_PASSWORD=local-test-only','postgres:17-alpine'],check=True,capture_output=True)
try:
 for _ in range(60):
  if subprocess.run(['docker','exec',NAME,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.25)
 sql('''create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,created_at timestamptz default now(),last_sign_in_at timestamptz,raw_user_meta_data jsonb default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default now(),not_after timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;''')
 for n in ['0001_product_access.sql','0002_sso_nonces.sql','0004_platform_identity.sql']:sql((ROOT/'supabase/migrations'/n).read_text())
 for i in range(1,10):sql(f"insert into auth.users(id,email,email_confirmed_at) values('{uid(i)}','{'ireshek@gmail.com' if i==1 else f'user{i}@example.test'}',now());insert into auth.sessions(id,user_id) values('{uid(i+100)}','{uid(i)}');")
 sql(f"insert into product_access(user_id,product,status) values('{uid(9)}','wed','active');")
 sql((ROOT/'supabase/migrations/0005_billing.sql').read_text())
 assert json.loads(sql(f"select billing_access('{uid(9)}','wed')"))['plan']=='studio'
 for role in ['anon','authenticated']:
  for table in ['billing_orders','billing_plans','billing_staff','billing_promotions','billing_events','billing_audit']:
   assert 'permission denied' in sql(f'set role {role}; select * from {table}',False)
  assert 'permission denied' in sql(f"set role {role};select billing_admin('{uid(1)}','wed','users','{{}}')",False)
 assert 'access is required' in sql(f"select billing_admin('{uid(2)}','wed','users','{{}}')",False)
 assert admin('users',{})['total']==9
 assert admin('users',{'query':'user2'})['items'][0]['id']==uid(2)
 o=order();assert order()['id']==o['id']
 assert event(o,amountCents=1000)['outcome']=='mismatch'
 assert event(o,eid='first')['outcome']=='granted'
 assert event(o,eid='first')['replayed']
 assert event(o)['outcome']=='already_processed'
 a=json.loads(sql(f"select billing_access('{uid(2)}','wed')"));assert a['plan']=='essential' and a['active']
 expiry=a['expires_at'];event(o);assert json.loads(sql(f"select billing_access('{uid(2)}','wed')"))['expires_at']==expiry
 test=order(user=3,mode='test');assert event(test)['outcome']=='test_only'
 assert not json.loads(sql(f"select billing_access('{uid(3)}','wed')"))['active']
 # Invitation cannot overwrite purchased or revoked access.
 sql(f"select billing_member_grant('{uid(2)}','wed');select billing_member_grant('{uid(4)}','wed');")
 assert json.loads(sql(f"select billing_access('{uid(2)}','wed')"))['plan']=='essential'
 assert json.loads(sql(f"select billing_access('{uid(4)}','wed')"))['features']==[]
 # Admin override while a payment is outstanding is never overwritten by a late webhook.
 o4=order(user=4)
 admin('assign',{'user_id':uid(4),'version':1,'plan':'studio','status':'active','expires_at':'2030-01-01','reason':'Approved upgrade'})
 assert event(o4)['outcome']=='access_changed'
 assert json.loads(sql(f"select billing_access('{uid(4)}','wed')"))['plan']=='studio'
 assert 'changed' in sql(f"select billing_admin('{uid(1)}','wed','assign',{literal({'user_id':uid(4),'version':1,'plan':'essential','status':'active','expires_at':'2030-01-01','reason':'Stale request'})})",False)
 # Price edits do not change an existing order. Client totals are never trusted.
 o5=order(user=5)
 admin('save_plan',{'code':'essential','version':1,'price_cents':590000,'months':6,'active':True,'reason':'New season price'})
 assert order(user=5)['amount_cents']==490000
 assert 'price changed' in sql(f"select billing_create_order('{uid(6)}','wed','essential','','live','https://dash.example.test',1)",False)
 # One promotion use cannot be reserved by concurrent customers.
 admin('save_promotion',{'version':0,'code':'ONEONLY','plan_code':'essential','kind':'percent','value':10,'active':True,'starts_at':'2020-01-01','ends_at':'2035-01-01','max_uses':1,'per_user':1,'reason':'Launch promotion'})
 def reserve(i):
  try:return order(user=i,code='ONEONLY',amount=531000)
  except AssertionError:return None
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:reserved=list(pool.map(reserve,[6,7]))
 assert sum(x is not None for x in reserved)==1
 # An attached checkout must match exactly; only provider-confirmed closure releases it.
 checkout={'object':'checkout','id':'chk_'+o5['id'],'mode':'live','status':'open','url':'https://payments.lk/checkout/local','expiresAt':'2030-01-01T00:00:00Z','payment':{'id':'pay_'+o5['id'],'checkoutId':'chk_'+o5['id'],'mode':'live','reference':o5['id'],'amountCents':o5['amount_cents'],'currency':'LKR'}}
 attached=json.loads(sql(f"select billing_attach('{o5['id']}',{literal(checkout)})"));assert attached['status']=='pending'
 malformed={**checkout,'payment':{**checkout['payment'],'currency':None}}
 assert 'did not match' in sql(f"select billing_attach('{o5['id']}',{literal(malformed)})",False)
 expired={'object':'event','mode':'live','id':'expire_test','type':'checkout.expired','data':{'object':'checkout','id':checkout['id'],'paymentId':checkout['payment']['id']}}
 assert json.loads(sql('select billing_event('+literal(expired)+')'))['outcome']=='expired'
 assert order(user=5,amount=590000)['id']!=o5['id']
 # Concurrency on same customer returns one immutable order.
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:dupes=list(pool.map(lambda _:order(user=8,amount=590000),range(2)))
 assert dupes[0]['id']==dupes[1]['id']
 # Change-plan cancellation is safe before checkout, and refused after a request starts.
 draft=dupes[0]
 canceled=json.loads(sql(f"select billing_checkout_action('{uid(8)}','{draft['id']}','cancel')"));assert canceled['status']=='expired'
 fresh=order(user=8,amount=590000)
 started=json.loads(sql(f"select billing_checkout_action('{uid(8)}','{fresh['id']}','start')"));assert started['checkout_started_at']
 assert 'already started' in sql(f"select billing_checkout_action('{uid(8)}','{fresh['id']}','cancel')",False)
 assert order(user=8,plan='complete',amount=790000)['id']==fresh['id']
 # The start/cancel race ends in exactly one valid outcome.
 sql(f"insert into auth.users(id,email,email_confirmed_at) values('{uid(11)}','race@example.test',now())")
 race=order(user=11,amount=590000)
 def action(name):
  try:return json.loads(sql(f"select billing_checkout_action('{uid(11)}','{race['id']}','{name}')"))
  except AssertionError:return None
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(action,['start','cancel']))
 raced=json.loads(sql(f"select billing_order('{uid(11)}','{race['id']}')"))
 assert (raced['status']=='pending' and raced['checkout_started_at']) or (raced['status']=='expired' and not raced['checkout_started_at'])
 # An abandoned order cannot hold its customer or a discount forever.
 unused=order(user=5,amount=590000)
 sql(f"update billing_orders set created_at=now()-interval '31 minutes' where id='{unused['id']}'")
 assert json.loads(sql(f"select billing_checkout_action('{uid(5)}','{unused['id']}','start')"))['status']=='expired'
 assert order(user=5,amount=590000)['id']!=unused['id']
 # Full refund only removes access still granted by the affected order.
 assert event(o,'refund.succeeded',refundedCents=o['amount_cents'])['outcome']=='refund'
 assert not json.loads(sql(f"select billing_access('{uid(2)}','wed')"))['active']
 assert event(o)['outcome']=='already_processed'
 print('PASS: billing migrations, roles, account search, price snapshots, test isolation, replay, mismatch, concurrent checkout/promotion reservations, staff overrides and refund ordering.')
finally:subprocess.run(['docker','rm','-f',NAME],check=True,capture_output=True)
