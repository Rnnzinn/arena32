-- ARENA 32 — esquema do Supabase. Rode inteiro no SQL Editor do seu projeto.
-- ATENÇÃO: este arquivo NÃO foi executado em um banco real por mim (sem acesso a um projeto Supabase).
-- Rode em um projeto de teste primeiro e leia os erros, se houver. Veja docs/STATUS.md.

create extension if not exists citext;
create sequence if not exists public.player_seq start 1;            -- IDs sequenciais: 1, 2, 3 ... (exibidos como 00001, 00002 ...)

-- ===================== PERFIS =====================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  player_number bigint not null unique default nextval('public.player_seq'),
  player_code text not null unique,                                  -- '00001'. Passa de 5 dígitos sozinho (100000...)
  nickname citext not null unique check (nickname ~ '^[A-Za-z0-9_]{3,32}$'),
  nickname_set boolean not null default false,                       -- false até a 1ª escolha (grátis)
  nickname_changes int not null default 0,
  avatar text not null default 'a1' check (avatar ~ '^a[1-8]$'),
  photo_url text,
  level int not null default 1,
  xp bigint not null default 0,
  coins bigint not null default 0 check (coins >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.cloud_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.matches (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null, placement int, kills int, deaths int, damage int, xp int, coins int, won boolean,
  at timestamptz not null default now()
);

create table if not exists public.friendships (
  id bigserial primary key,
  requester uuid not null references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));

-- ===================== SEGURANÇA (RLS) =====================
-- Os clientes só LEEM os próprios dados. Toda escrita passa pelas funções abaixo (SECURITY DEFINER),
-- então ninguém consegue editar moedas/nível direto pela API.
alter table public.profiles enable row level security;
alter table public.cloud_saves enable row level security;
alter table public.matches enable row level security;
alter table public.friendships enable row level security;
drop policy if exists p_profiles_sel on public.profiles;     create policy p_profiles_sel on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists p_saves_sel on public.cloud_saves;     create policy p_saves_sel on public.cloud_saves for select to authenticated using (auth.uid() = user_id);
drop policy if exists p_matches_sel on public.matches;       create policy p_matches_sel on public.matches for select to authenticated using (auth.uid() = user_id);
drop policy if exists p_friends_sel on public.friendships;   create policy p_friends_sel on public.friendships for select to authenticated using (auth.uid() in (requester, addressee));

-- ===================== CRIAÇÃO AUTOMÁTICA DO PERFIL =====================
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  n := nextval('public.player_seq');
  insert into public.profiles(id, player_number, player_code, nickname) values (new.id, n, lpad(n::text, 5, '0'), 'jogador' || lpad(n::text, 5, '0'));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ===================== APELIDO: 1ª escolha grátis, depois 1.000 moedas =====================
create or replace function public.set_nickname(p_nick text) returns bigint language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  if p_nick !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'Apelido inválido: use 3 a 16 letras, números ou _'; end if;
  select * into p from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Perfil não encontrado'; end if;
  if p.nickname_set then
    if p.coins < 1000 then raise exception 'Saldo insuficiente: trocar o apelido custa 1000 moedas'; end if;
    update public.profiles set nickname = p_nick, coins = coins - 1000, nickname_changes = nickname_changes + 1 where id = auth.uid();
  else
    update public.profiles set nickname = p_nick, nickname_set = true where id = auth.uid();
  end if;
  return (select coins from public.profiles where id = auth.uid());
exception when unique_violation then raise exception 'Esse apelido já está em uso';
end $$;

create or replace function public.set_avatar(p_avatar text) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_avatar !~ '^a[1-8]$' then raise exception 'Avatar inválido'; end if;
  update public.profiles set avatar = p_avatar, photo_url = null where id = auth.uid();
end $$;

create or replace function public.set_photo(p_url text) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_url not like '%/storage/v1/object/public/avatars/' || auth.uid()::text || '/%' then raise exception 'Foto inválida'; end if;
  update public.profiles set photo_url = p_url where id = auth.uid();
end $$;

-- ===================== NUVEM =====================
-- ATENÇÃO (honestidade): o progresso do jogo OFFLINE é calculado no navegador. Aqui ele é aceito como veio, com limites básicos.
-- Moedas/XP de partidas ONLINE vêm do servidor (award_match) e são confiáveis. Para blindar o offline, ele teria que rodar no servidor também.
create or replace function public.push_save(p_data jsonb) returns void language plpgsql security definer set search_path = public as $$
declare st jsonb; v_xp bigint; v_c bigint;
begin
  if pg_column_size(p_data) > 200000 then raise exception 'Save grande demais'; end if;
  insert into public.cloud_saves(user_id, data, updated_at) values (auth.uid(), p_data, now())
    on conflict (user_id) do update set data = excluded.data, updated_at = now();
  begin st := (p_data->>'a32s')::jsonb; exception when others then st := null; end;
  if st is not null and (st->>'xp') ~ '^[0-9]{1,9}$' and (st->>'c') ~ '^[0-9]{1,9}$' then
    v_xp := (st->>'xp')::bigint; v_c := (st->>'c')::bigint;
    update public.profiles set xp = greatest(xp, v_xp), level = 1 + (greatest(xp, v_xp) / 100)::int, coins = v_c where id = auth.uid();
  end if;
end $$;

-- ===================== AMIGOS =====================
create or replace function public.search_players(q text) returns table(id uuid, nickname text, player_code text, avatar text, level int)
language sql security definer set search_path = public as $$
  select p.id, p.nickname::text, p.player_code, p.avatar, p.level from public.profiles p
  where p.id <> auth.uid() and p.nickname_set and (
        (q ~ '^[0-9]{1,5}$' and p.player_code = lpad(q, 5, '0'))
     or (length(q) >= 2 and p.nickname ilike replace(replace(q, '%', ''), '_', '\_') || '%'))
  order by p.nickname limit 10 $$;

create or replace function public.send_friend_request(p_target uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_target = auth.uid() then raise exception 'Você não pode adicionar a si mesmo'; end if;
  if exists (select 1 from public.friendships where least(requester, addressee) = least(auth.uid(), p_target) and greatest(requester, addressee) = greatest(auth.uid(), p_target)) then
    raise exception 'Já existe uma solicitação ou amizade com esse jogador'; end if;
  insert into public.friendships(requester, addressee) values (auth.uid(), p_target);
end $$;

create or replace function public.respond_friend(p_id bigint, p_accept boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_accept then update public.friendships set status = 'accepted' where id = p_id and addressee = auth.uid() and status = 'pending';
  else delete from public.friendships where id = p_id and addressee = auth.uid() and status = 'pending'; end if;
end $$;

create or replace function public.remove_friend(p_id bigint) returns void language sql security definer set search_path = public as $$
  delete from public.friendships where id = p_id and auth.uid() in (requester, addressee) $$;

create or replace function public.list_friends() returns table(fid bigint, uid uuid, nickname text, code text, status text, incoming boolean)
language sql security definer set search_path = public as $$
  select f.id, p.id, p.nickname::text, p.player_code, f.status, (f.addressee = auth.uid())
  from public.friendships f join public.profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where auth.uid() in (f.requester, f.addressee) order by f.status, p.nickname $$;

-- ===================== PRÊMIO DE PARTIDA (só o servidor multiplayer chama) =====================
create or replace function public.award_match(p_rows jsonb, p_mode text) returns void language plpgsql security definer set search_path = public as $$
declare r jsonb; uid uuid;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    begin uid := (r->>'id')::uuid; exception when others then continue; end;
    continue when not exists (select 1 from public.profiles where id = uid);
    update public.profiles set xp = xp + (r->>'xp')::int, coins = coins + (r->>'coins')::int, level = 1 + ((xp + (r->>'xp')::int) / 100)::int where id = uid;
    insert into public.matches(user_id, mode, placement, kills, deaths, damage, xp, coins, won)
      values (uid, p_mode, (r->>'place')::int, (r->>'kills')::int, (r->>'deaths')::int, (r->>'dmg')::int, (r->>'xp')::int, (r->>'coins')::int, (r->>'won')::boolean);
  end loop;
end $$;

-- ===================== PERMISSÕES DAS FUNÇÕES =====================
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.set_nickname(text), public.set_avatar(text), public.set_photo(text), public.push_save(jsonb),
  public.search_players(text), public.send_friend_request(uuid), public.respond_friend(bigint, boolean), public.remove_friend(bigint), public.list_friends() to authenticated;
grant execute on function public.award_match(jsonb, text) to service_role;      -- NÃO para clientes
grant select on public.profiles, public.cloud_saves, public.matches, public.friendships to authenticated;

-- ===================== FOTOS DE PERFIL (Storage) =====================
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
drop policy if exists avatar_insert_own on storage.objects; drop policy if exists avatar_update_own on storage.objects;
create policy avatar_insert_own on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatar_update_own on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
