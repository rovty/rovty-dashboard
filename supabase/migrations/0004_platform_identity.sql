-- Platform identity stays in this project. Product databases reference these UUIDs.
begin;
create table public.platform_revocations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revoked_before timestamptz not null
);
alter table public.platform_revocations enable row level security;
revoke all on public.platform_revocations from public, anon, authenticated;
grant all on public.platform_revocations to service_role;

create function public.rovty_session_valid(_user uuid, _session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    left join public.platform_revocations r on r.user_id = s.user_id
    where s.id = _session and s.user_id = _user
      and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until <= now())
      and (s.not_after is null or s.not_after > now())
      and (r.revoked_before is null or s.created_at > r.revoked_before)
  );
$$;
revoke all on function public.rovty_session_valid(uuid,uuid) from public, anon, authenticated;
grant execute on function public.rovty_session_valid(uuid,uuid) to service_role;

create function public.rovty_session_status(_user uuid, _session uuid, _product text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.rovty_session_valid(_user,_session) then return jsonb_build_object('active',false,'reason','session'); end if;
  if _product is not null and not exists(select 1 from public.product_access where user_id=_user and product=_product and status='active') then
    return jsonb_build_object('active',false,'reason','access');
  end if;
  return (select jsonb_build_object('active',true,'user_id',id,'session_id',_session,'email',email) from auth.users where id=_user);
end;
$$;
revoke all on function public.rovty_session_status(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.rovty_session_status(uuid,uuid,text) to service_role;

create function public.rovty_revoke_sessions(_user uuid, _session uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  -- Never let an old signed-out token revoke sessions created by a later login.
  -- A repeated request for an already-revoked session is a successful no-op.
  perform 1 from auth.users where id=_user for update;
  if not public.rovty_session_valid(_user,_session) then return true; end if;
  insert into public.platform_revocations(user_id,revoked_before) values(_user,clock_timestamp())
    on conflict(user_id) do update set revoked_before=excluded.revoked_before;
  return true;
end;
$$;
revoke all on function public.rovty_revoke_sessions(uuid,uuid) from public, anon, authenticated;
grant execute on function public.rovty_revoke_sessions(uuid,uuid) to service_role;

create function public.rovty_current_session_active()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return public.rovty_session_valid(auth.uid(), (auth.jwt()->>'session_id')::uuid);
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function public.rovty_current_session_active() from public, anon;
grant execute on function public.rovty_current_session_active() to authenticated;
create policy "Active Rovty session required" on public.product_access as restrictive
  for all to authenticated using ((select public.rovty_current_session_active()))
  with check ((select public.rovty_current_session_active()));
commit;
