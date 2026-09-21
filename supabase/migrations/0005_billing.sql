-- CENTRAL ACCOUNT PROJECT ONLY. No card data is stored by Rovty.
begin;
create table public.billing_plans (
  product text not null, code text not null, name text not null,
  price_cents integer not null check(price_cents between 1000 and 100000000),
  months integer not null check(months between 1 and 120),
  rank integer not null check(rank > 0), features text[] not null,
  active boolean not null default true, version integer not null default 1,
  primary key(product,code), unique(product,rank)
);
insert into public.billing_plans(product,code,name,price_cents,months,rank,features) values
 ('wed','essential','Essential',490000,6,1,array['website','templates','rsvp','guests']),
 ('wed','complete','Complete',790000,12,2,array['website','templates','rsvp','guests','seating','team']),
 ('wed','studio','Studio',990000,24,3,array['website','templates','rsvp','guests','seating','team','canvas']);
create table public.billing_staff (
 email text not null, product text not null, role text not null check(role in ('admin','viewer')),
 primary key(email,product), check(email=lower(trim(email)))
);
insert into public.billing_staff values('ireshek@gmail.com','wed','admin');
create table public.billing_promotions (
 id uuid primary key default gen_random_uuid(), product text not null, code text not null,
 plan_code text, kind text not null check(kind in ('percent','fixed')),
 value integer not null check(value>0), active boolean not null default true,
 starts_at timestamptz not null default now(), ends_at timestamptz not null,
 max_uses integer not null check(max_uses between 1 and 1000000),
 per_user integer not null default 1 check(per_user between 1 and 100),
 version integer not null default 1, unique(product,code),
 foreign key(product,plan_code) references public.billing_plans(product,code),
 check(code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
 check((kind='percent' and value<=95) or (kind='fixed' and value<=99999000)),
 check(ends_at>starts_at)
);
alter table public.product_access
 add column plan_code text,
 add column source text not null default 'legacy' check(source in ('legacy','purchase','manual','member')),
 add column expires_at timestamptz,
 add column revision integer not null default 1,
 add column order_id uuid;
-- Preserve all previously granted Wed access, including current custom designs.
update public.product_access set plan_code='studio' where product='wed';
create table public.billing_orders (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 product text not null, plan_code text not null, plan_name text not null,
 plan_rank integer not null, features text[] not null, months integer not null,
 subtotal_cents integer not null, discount_cents integer not null default 0,
 amount_cents integer not null check(amount_cents between 1000 and 100000000),
 promotion_id uuid references public.billing_promotions(id), promotion_code text,
 mode text not null check(mode in ('test','live')),
 status text not null default 'pending' check(status in ('pending','paid','expired','review','refunded')),
 access_revision integer not null, checkout_id text, payment_id text, checkout_url text,
 checkout_expires_at timestamptz, checkout_started_at timestamptz, request_body jsonb not null,
 created_at timestamptz not null default now(), paid_at timestamptz,
 review_reason text, refunded_cents integer not null default 0,
 check(amount_cents=subtotal_cents-discount_cents),
 unique(mode,checkout_id), unique(mode,payment_id)
);
create unique index billing_one_pending on public.billing_orders(user_id,product,mode) where status='pending';
create index billing_orders_product on public.billing_orders(product,created_at desc,id);
create index billing_orders_user on public.billing_orders(user_id,created_at desc);
create index billing_orders_promotion on public.billing_orders(promotion_id,mode,status);
create table public.billing_events (
 mode text not null, id text not null, type text not null, order_id uuid references public.billing_orders(id),
 outcome text not null, received_at timestamptz not null default now(), primary key(mode,id)
);
create table public.billing_audit (
 id bigint generated always as identity primary key,
 actor uuid references auth.users(id), product text not null, action text not null,
 target text not null, reason text not null, before_value jsonb, after_value jsonb,
 created_at timestamptz not null default now()
);
do $$ declare t text; begin
 foreach t in array array['billing_plans','billing_staff','billing_promotions','billing_orders','billing_events','billing_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function public.billing_access(_user uuid, _product text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('plan',a.plan_code,'source',a.source,'expires_at',a.expires_at,'revision',a.revision,
  'active',a.status='active' and (a.expires_at is null or a.expires_at>now()),
  'features',case when a.status='active' and (a.expires_at is null or a.expires_at>now()) then coalesce(p.features,'{}'::text[]) else '{}'::text[] end)
 from public.product_access a left join public.billing_plans p on p.product=a.product and p.code=a.plan_code
 where a.user_id=_user and a.product=_product), jsonb_build_object('active',false,'features','[]'::jsonb,'revision',0));
$$;
create or replace function public.rovty_session_status(_user uuid, _session uuid, _product text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a jsonb; begin
 if not public.rovty_session_valid(_user,_session) then return jsonb_build_object('active',false,'reason','session'); end if;
 if _product is not null then
  a:=public.billing_access(_user,_product);
  if not (a->>'active')::boolean then return jsonb_build_object('active',false,'reason','access'); end if;
 end if;
 return (select jsonb_build_object('active',true,'user_id',id,'session_id',_session,'email',email,'entitlement',a) from auth.users where id=_user);
end $$;
create function public.billing_access_many(_users uuid[],_product text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(u::text,public.billing_access(u,_product)),'{}'::jsonb) from unnest(_users) u;
$$;
create function public.billing_member_grant(_user uuid,_product text) returns void
language plpgsql security definer set search_path='' as $$ begin
 -- Invitations cannot reactivate revoked purchases or change paid plans.
 insert into public.product_access(user_id,product,status,source,granted_at)
 values(_user,_product,'active','member',now()) on conflict(user_id,product) do nothing;
end $$;
create function public.billing_catalog(_product text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(p) order by rank),'[]'::jsonb) from public.billing_plans p where product=_product and active;
$$;

create function public.billing_quote(_user uuid,_product text,_plan text,_code text,_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.billing_plans; c public.billing_promotions; d integer:=0; n integer; begin
 if _mode not in ('test','live') then raise exception 'Invalid payment mode'; end if;
 select * into p from public.billing_plans where product=_product and code=_plan and active;
 if not found then raise exception 'This plan is not available.'; end if;
 if coalesce(_code,'')<>'' then
  select * into c from public.billing_promotions where product=_product and code=upper(trim(_code)) for update;
  if not found or not c.active or c.starts_at>now() or c.ends_at<=now() or (c.plan_code is not null and c.plan_code<>_plan)
   then raise exception 'This promotion code is not available for this plan.'; end if;
  select count(*) into n from public.billing_orders where promotion_id=c.id and mode=_mode and status<>'expired' and (status<>'pending' or checkout_started_at is not null or created_at>now()-interval '30 minutes');
  if n>=c.max_uses then raise exception 'This promotion has reached its limit.'; end if;
  select count(*) into n from public.billing_orders where promotion_id=c.id and mode=_mode and user_id=_user and status<>'expired' and (status<>'pending' or checkout_started_at is not null or created_at>now()-interval '30 minutes');
  if n>=c.per_user then raise exception 'This account has already used or reserved this promotion.'; end if;
  d:=case when c.kind='percent' then (p.price_cents::bigint*c.value/100)::integer else c.value end;
  if p.price_cents-d<1000 then raise exception 'This promotion cannot be applied to this plan.'; end if;
 end if;
 return jsonb_build_object('plan',to_jsonb(p),'subtotal_cents',p.price_cents,'discount_cents',d,'amount_cents',p.price_cents-d,'promotion_id',c.id,'promotion_code',c.code);
end $$;
create function public.billing_create_order(_user uuid,_product text,_plan text,_code text,_mode text,_origin text,_expected integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_orders; q jsonb; p jsonb; a jsonb; r integer; oid uuid:=gen_random_uuid(); begin
 perform 1 from auth.users where id=_user for update;
 select * into o from public.billing_orders where user_id=_user and product=_product and mode=_mode and status='pending' for update;
 if found then
  if o.checkout_started_at is null and o.created_at<=now()-interval '30 minutes' then
   update public.billing_orders set status='expired' where id=o.id;
  else return to_jsonb(o); end if;
 end if;
 q:=public.billing_quote(_user,_product,_plan,_code,_mode); p:=q->'plan';
 if _expected is distinct from (q->>'amount_cents')::integer then raise exception 'The price changed. Review the updated total before paying.'; end if;
 a:=public.billing_access(_user,_product);
 if (a->>'active')::boolean and a->>'source'<>'member' then
  select rank into r from public.billing_plans where product=_product and code=a->>'plan';
  if r>=(p->>'rank')::integer then raise exception 'You already have this plan or a higher plan. Contact Rovty for changes.'; end if;
 end if;
 insert into public.billing_orders(id,user_id,product,plan_code,plan_name,plan_rank,features,months,subtotal_cents,discount_cents,amount_cents,promotion_id,promotion_code,mode,access_revision,request_body)
 values(oid,_user,_product,_plan,p->>'name',(p->>'rank')::integer,array(select jsonb_array_elements_text(p->'features')),(p->>'months')::integer,
 (q->>'subtotal_cents')::integer,(q->>'discount_cents')::integer,(q->>'amount_cents')::integer,(q->>'promotion_id')::uuid,q->>'promotion_code',_mode,(a->>'revision')::integer,
 jsonb_build_object('amountCents',(q->>'amount_cents')::integer,'description','Rovty '||initcap(_product)||' '||(p->>'name'),'reference',oid,
 'successUrl',_origin||'/billing/orders/'||oid,'cancelUrl',_origin||'/billing/orders/'||oid||'?returned=cancel')) returning * into o;
 return to_jsonb(o);
end $$;
create function public.billing_order(_user uuid,_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.billing_orders; begin
 select * into o from public.billing_orders where id=_id and user_id=_user for update;
 if not found then return null; end if;
 if o.status='pending' and o.checkout_started_at is null and o.created_at<=now()-interval '30 minutes' then
  update public.billing_orders set status='expired' where id=o.id returning * into o;
 end if;
 return to_jsonb(o);
end $$;
create function public.billing_checkout_action(_user uuid,_id uuid,_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.billing_orders; begin
 -- Locks serialize cancellation against starting the provider request.
 select * into o from public.billing_orders where id=_id and user_id=_user for update;
 if not found then raise exception 'Order not found.'; end if;
 if o.status<>'pending' then return to_jsonb(o); end if;
 if o.promotion_id is not null then perform 1 from public.billing_promotions where id=o.promotion_id for update; end if;
 if _action='cancel' then
  if o.checkout_started_at is not null then raise exception 'This checkout has already started. Reopen it or wait for it to close before choosing another plan.'; end if;
  update public.billing_orders set status='expired' where id=o.id returning * into o;
 elsif _action='start' then
  if o.checkout_started_at is null and o.created_at<=clock_timestamp()-interval '30 minutes' then
   update public.billing_orders set status='expired' where id=o.id returning * into o;
  else
   update public.billing_orders set checkout_started_at=coalesce(checkout_started_at,now()) where id=o.id returning * into o;
  end if;
 else raise exception 'Unknown checkout action.';
 end if;
 return to_jsonb(o);
end $$;
create function public.billing_orders_for(_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$ select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) from (select id,product,plan_name,amount_cents,mode,status,created_at from public.billing_orders where user_id=_user order by created_at desc limit 50) o $$;
create function public.billing_attach(_id uuid,_checkout jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.billing_orders; p jsonb:=_checkout->'payment'; begin
 select * into o from public.billing_orders where id=_id for update;
 if not found then raise exception 'Order not found'; end if;
 if _checkout->>'object' is distinct from 'checkout' or _checkout->>'mode' is distinct from o.mode or p->>'reference' is distinct from o.id::text
 or (p->>'amountCents')::integer is distinct from o.amount_cents or p->>'currency' is distinct from 'LKR' or p->>'mode' is distinct from o.mode
 or p->>'checkoutId' is distinct from _checkout->>'id' or nullif(p->>'id','') is null
 or nullif(_checkout->>'id','') is null or nullif(_checkout->>'url','') is null or nullif(_checkout->>'expiresAt','') is null
 or (o.checkout_id is not null and o.checkout_id is distinct from _checkout->>'id') or (o.payment_id is not null and o.payment_id is distinct from p->>'id')
 then raise exception 'Checkout did not match the order'; end if;
 update public.billing_orders set checkout_started_at=coalesce(checkout_started_at,now()),checkout_id=_checkout->>'id',payment_id=p->>'id',checkout_url=_checkout->>'url',checkout_expires_at=(_checkout->>'expiresAt')::timestamptz where id=_id returning * into o;
 -- Only a provider-confirmed terminal checkout releases a reservation. A return URL never does.
 if _checkout->>'status' in ('expired','canceled') and o.status='pending' then
  update public.billing_orders set status='expired' where id=_id returning * into o;
 end if;
 return to_jsonb(o);
end $$;

create function public.billing_event(_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.billing_orders; a public.product_access; d jsonb:=_event->'data'; p jsonb; typ text:=_event->>'type'; event_outcome text:='ignored'; begin
 insert into public.billing_events(mode,id,type,outcome) values(_event->>'mode',_event->>'id',typ,'received') on conflict do nothing;
 if not found then return jsonb_build_object('ok',true,'replayed',true); end if;
 if typ='checkout.expired' then
  select * into o from public.billing_orders where mode=_event->>'mode' and checkout_id=d->>'id' for update;
  -- If create response has not arrived, retry delivery after attach, not an irreversible no-op.
  if not found then raise exception 'Checkout not attached yet'; end if;
  if o.payment_id=d->>'paymentId' and o.status='pending' then
   update public.billing_orders set status='expired' where id=o.id; event_outcome:='expired';
  end if;
 elsif typ in ('payment.succeeded','refund.succeeded') then
  p:=case when typ='refund.succeeded' then d->'payment' else d end;
  select * into o from public.billing_orders where id::text=p->>'reference' and mode=_event->>'mode';
  if found then
   -- Match lock order used by checkout/admin to avoid deadlocks.
   perform 1 from auth.users where id=o.user_id for update;
   select * into o from public.billing_orders where id=o.id for update;
   if p->>'object' is distinct from 'payment' or p->>'mode' is distinct from o.mode or p->>'currency' is distinct from 'LKR'
    or (p->>'amountCents')::integer is distinct from o.amount_cents or nullif(p->>'id','') is null or nullif(p->>'checkoutId','') is null
    or (o.payment_id is not null and o.payment_id<>p->>'id') or (o.checkout_id is not null and o.checkout_id<>p->>'checkoutId') then
    event_outcome:='mismatch';
   else
    update public.billing_orders set payment_id=p->>'id',checkout_id=p->>'checkoutId' where id=o.id;
    if typ='refund.succeeded' then
     update public.billing_orders set refunded_cents=greatest(refunded_cents,coalesce((p->>'refundedCents')::integer,0)),status=case when (p->>'refundedCents')::integer>=amount_cents then 'refunded' else 'review' end,review_reason='Refund received. Review product access.' where id=o.id;
     if o.mode='live' and (p->>'refundedCents')::integer>=o.amount_cents then
      update public.product_access set status='inactive',revision=revision+1 where user_id=o.user_id and product=o.product and order_id=o.id;
     end if;
     event_outcome:='refund';
    elsif o.status in ('paid','refunded','review') then event_outcome:='already_processed';
    elsif p->>'status' is distinct from 'succeeded' or coalesce((p->>'refundedCents')::integer,0)>0 then event_outcome:='invalid_payment_state';
    elsif o.mode='test' then
     update public.billing_orders set status='paid',paid_at=now() where id=o.id; event_outcome:='test_only';
    else
     select * into a from public.product_access where user_id=o.user_id and product=o.product for update;
     if coalesce(a.revision,0)<>o.access_revision then
      update public.billing_orders set status='review',paid_at=now(),review_reason='Access changed while this checkout was open. Review before assigning a plan.' where id=o.id; event_outcome:='access_changed';
     else
      insert into public.product_access(user_id,product,status,plan_code,source,granted_at,expires_at,revision,order_id)
       values(o.user_id,o.product,'active',o.plan_code,'purchase',now(),now()+make_interval(months=>o.months),o.access_revision+1,o.id)
       on conflict(user_id,product) do update set status=excluded.status,plan_code=excluded.plan_code,source=excluded.source,granted_at=excluded.granted_at,expires_at=excluded.expires_at,revision=excluded.revision,order_id=excluded.order_id;
      update public.billing_orders set status='paid',paid_at=now() where id=o.id; event_outcome:='granted';
     end if;
    end if;
   end if;
  end if;
 end if;
 update public.billing_events set outcome=event_outcome,order_id=o.id where mode=_event->>'mode' and id=_event->>'id';
 return jsonb_build_object('ok',true,'outcome',event_outcome);
end $$;
create function public.billing_admin(_actor uuid,_product text,_action text,_params jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare role_name text; before_row jsonb; after_row jsonb; target_id uuid; a public.product_access; p public.billing_plans;
 q text:=left(lower(trim(coalesce(_params->>'query',''))),150); page_num integer:=greatest(0,least(10000,coalesce((_params->>'page')::integer,0))); result jsonb; reason_text text:=trim(_params->>'reason'); begin
 select s.role into role_name from public.billing_staff s join auth.users u on lower(u.email)=s.email
 where u.id=_actor and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()) and s.product=_product;
 if role_name is null then raise exception using errcode='42501',message='Rovty billing team access is required.'; end if;
 if _action='access' then return jsonb_build_object('role',role_name); end if;
 if _action='users' then
  select jsonb_build_object('total',count(*),'items',coalesce((select jsonb_agg(x) from (
    select u.id,u.email,coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','') as name,u.created_at,u.last_sign_in_at,
     public.billing_access(u.id,_product) as access from auth.users u
    where q='' or strpos(lower(coalesce(u.email,'')||' '||coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','')),q)>0
    order by u.created_at desc,u.id limit 25 offset page_num*25) x),'[]'::jsonb)) into result from auth.users u
   where q='' or strpos(lower(coalesce(u.email,'')||' '||coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','')),q)>0;
  return result;
 elsif _action='plans' then return (select coalesce(jsonb_agg(to_jsonb(x) order by rank),'[]'::jsonb) from public.billing_plans x where product=_product);
 elsif _action='promotions' then return (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select * from public.billing_promotions where product=_product order by starts_at desc limit 200) x);
 elsif _action='orders' then
  return (select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)) from (
   select o.*,u.email from public.billing_orders o join auth.users u on u.id=o.user_id where o.product=_product
    and (q='' or strpos(lower(coalesce(u.email,'')||' '||o.id::text||' '||o.status||' '||o.mode),q)>0)
   order by o.created_at desc,o.id limit 25 offset page_num*25) x);
 elsif _action='audit' then return (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select * from public.billing_audit where product=_product order by id desc limit 100) x);
 end if;
 if role_name<>'admin' then raise exception using errcode='42501',message='Administrator access is required.'; end if;
 if reason_text is null or length(reason_text)<5 or length(reason_text)>500 then raise exception 'Add a reason between 5 and 500 characters.'; end if;
 if _action='assign' then
  target_id:=(_params->>'user_id')::uuid;
  perform 1 from auth.users where id=target_id for update;
  if not found then raise exception 'Account not found.'; end if;
  select * into a from public.product_access where user_id=target_id and product=_product for update;
  before_row:=to_jsonb(a);
  if coalesce(a.revision,0) is distinct from (_params->>'version')::integer then raise exception using errcode='40001',message='Access changed. Refresh and try again.'; end if;
  select * into p from public.billing_plans where product=_product and code=_params->>'plan';
  if not found or coalesce(_params->>'status','') not in ('active','inactive') then raise exception 'Choose a valid plan and access status.'; end if;
  if _params->>'status'='active' and ((_params->>'expires_at')::timestamptz is null or (_params->>'expires_at')::timestamptz<=now()) then raise exception 'Choose a future access end date.'; end if;
  insert into public.product_access(user_id,product,status,plan_code,source,granted_at,expires_at,revision,order_id)
  values(target_id,_product,_params->>'status',p.code,'manual',now(),(_params->>'expires_at')::timestamptz,coalesce(a.revision,0)+1,null)
  on conflict(user_id,product) do update set status=excluded.status,plan_code=excluded.plan_code,source=excluded.source,granted_at=excluded.granted_at,expires_at=excluded.expires_at,revision=excluded.revision,order_id=null;
  after_row:=public.billing_access(target_id,_product);
 elsif _action='save_plan' then
  select to_jsonb(x) into before_row from public.billing_plans x where product=_product and code=_params->>'code' for update;
  if before_row is null then raise exception 'Plan not found.'; end if;
  if (before_row->>'version')::integer is distinct from (_params->>'version')::integer then raise exception using errcode='40001',message='Plan changed. Refresh and try again.'; end if;
  update public.billing_plans set price_cents=(_params->>'price_cents')::integer,months=(_params->>'months')::integer,active=(_params->>'active')::boolean,version=version+1
  where product=_product and code=_params->>'code' returning to_jsonb(billing_plans.*) into after_row;
 elsif _action='save_promotion' then
  target_id:=coalesce((_params->>'id')::uuid,gen_random_uuid());
  select to_jsonb(x) into before_row from public.billing_promotions x where id=target_id and product=_product for update;
  if coalesce((before_row->>'version')::integer,0) is distinct from (_params->>'version')::integer then raise exception using errcode='40001',message='Promotion changed. Refresh and try again.'; end if;
  if not exists(select 1 from public.billing_plans where product=_product) then raise exception 'Unknown product.'; end if;
  if before_row is null then
   insert into public.billing_promotions(id,product,code,plan_code,kind,value,active,starts_at,ends_at,max_uses,per_user)
   values(target_id,_product,upper(trim(_params->>'code')),nullif(_params->>'plan_code',''),_params->>'kind',(_params->>'value')::integer,(_params->>'active')::boolean,
   (_params->>'starts_at')::timestamptz,(_params->>'ends_at')::timestamptz,(_params->>'max_uses')::integer,(_params->>'per_user')::integer) returning to_jsonb(billing_promotions.*) into after_row;
  else
   -- Terms of issued codes stay fixed. Pause the code and create a new one to change its discount.
   update public.billing_promotions set active=(_params->>'active')::boolean,ends_at=(_params->>'ends_at')::timestamptz,max_uses=(_params->>'max_uses')::integer,version=version+1
   where id=target_id returning to_jsonb(billing_promotions.*) into after_row;
  end if;
 else raise exception 'Unknown billing action.';
 end if;
 insert into public.billing_audit(actor,product,action,target,reason,before_value,after_value)
 values(_actor,_product,_action,coalesce(target_id::text,_params->>'code'),reason_text,before_row,after_row);
 return after_row;
end $$;
-- All billing RPCs are server-only, including the public catalog's database function.
do $$ declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'billing_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
