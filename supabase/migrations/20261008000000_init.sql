-- =============================================================================
-- Kane Wedding — Supabase schema
--
--   profiles            1 row per auth user (name + role admin|editor)
--   templates           registry synced from ./templates by `npm run templates:sync`
--   invitations         per-template content as JSON (settings/theme/seo)
--   media               image/audio pool of an invitation, referenced by id from settings
--   rsvps               guest RSVPs           (written only through submit_rsvp())
--   guestbook_messages  guest wishes          (written only through submit_guestbook())
--
-- Access model:
--   * admin  -> everything
--   * editor -> only their own invitations (+ media / guests of those)
--   * anon   -> no table access at all; public pages go through SECURITY DEFINER
--               RPCs that only ever expose PUBLISHED invitations.
-- =============================================================================

create extension if not exists pg_trgm;

-- -----------------------------------------------------------------------------
-- Profiles & roles
-- -----------------------------------------------------------------------------
create table public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    email       text,
    name        text,
    role        text not null default 'editor' check (role in ('admin', 'editor')),
    created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- The very first account becomes admin; later ones are editors (promote in SQL).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, name, role)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
        case when exists (select 1 from public.profiles) then 'editor' else 'admin' end
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create policy "profiles: read self or admin" on public.profiles
    for select to authenticated using (id = auth.uid() or public.is_admin());

create policy "profiles: admin manages" on public.profiles
    for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Templates (read-only for the app; written by the sync script / SQL editor)
-- -----------------------------------------------------------------------------
create table public.templates (
    key          text primary key,                     -- folder name, e.g. "nobel"
    name         text not null,
    version      text not null default '1.0.0',
    description  text,
    thumbnail    text,                                 -- e.g. /templates/nobel/images/thumbnail.jpg
    status       text not null default 'active' check (status in ('active', 'disabled')),
    -- `json` (not jsonb) on purpose: it keeps key order, and section/field order
    -- in template.json is the order the admin form is built in.
    manifest     json not null default '{}'::json,     -- template.json (+ generated custom_images)
    preview      json not null default '{}'::json,     -- preview.json (demo content)
    synced_at    timestamptz,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

alter table public.templates enable row level security;

create policy "templates: signed-in users read active" on public.templates
    for select to authenticated using (status = 'active' or public.is_admin());

-- -----------------------------------------------------------------------------
-- Invitations
-- -----------------------------------------------------------------------------
create table public.invitations (
    id            bigint generated always as identity primary key,
    user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
    template_key  text not null references public.templates (key) on update cascade on delete restrict,
    slug          text not null unique
                  check (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'),
    title         text not null check (char_length(title) <= 120),
    status        text not null default 'draft' check (status in ('draft', 'published')),
    published_at  timestamptz,
    view_count    bigint not null default 0,
    locale        text not null default 'vi' check (locale in ('vi', 'en')),
    settings      jsonb not null default '{}'::jsonb,
    theme         jsonb not null default '{}'::jsonb,
    seo           jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index invitations_user_idx on public.invitations (user_id, created_at desc);
create index invitations_status_idx on public.invitations (status);
create index invitations_title_trgm on public.invitations using gin (title gin_trgm_ops);

alter table public.invitations enable row level security;

-- Slugs that would shadow app routes.
create or replace function public.is_reserved_slug(p_slug text)
returns boolean
language sql
immutable
as $$
    select p_slug = any (array['admin', 'api', 'templates', 'assets', 'images', 'storage',
                               'build', 'up', 'login', 'logout', 'preview', 'healthz', 'favicon-ico']);
$$;

alter table public.invitations
    add constraint invitations_slug_not_reserved check (not public.is_reserved_slug(slug));

create or replace function public.can_edit_invitation(p_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.invitations
        where id = p_id and (user_id = auth.uid() or public.is_admin())
    );
$$;

create policy "invitations: owner or admin read" on public.invitations
    for select to authenticated using (user_id = auth.uid() or public.is_admin());

create policy "invitations: create own" on public.invitations
    for insert to authenticated with check (user_id = auth.uid());

create policy "invitations: owner or admin update" on public.invitations
    for update to authenticated
    using (user_id = auth.uid() or public.is_admin())
    with check (user_id = auth.uid() or public.is_admin());

create policy "invitations: owner or admin delete" on public.invitations
    for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- updated_at doubles as the render-cache key, so view counting must not bump it.
create or replace function public.touch_invitation()
returns trigger
language plpgsql
as $$
begin
    if (new.settings, new.theme, new.seo, new.title, new.slug, new.status, new.locale, new.template_key)
       is not distinct from
       (old.settings, old.theme, old.seo, old.title, old.slug, old.status, old.locale, old.template_key)
    then
        return new;
    end if;

    new.updated_at := now();
    if new.status = 'published' and new.published_at is null then
        new.published_at := now();
    end if;
    return new;
end;
$$;

create trigger invitations_touch
    before update on public.invitations
    for each row execute function public.touch_invitation();

-- Users may not hand their invitation to someone else (admins may).
create or replace function public.guard_invitation_owner()
returns trigger
language plpgsql
as $$
begin
    if new.user_id is distinct from old.user_id and not public.is_admin() then
        raise exception 'Không thể đổi chủ sở hữu thiệp.';
    end if;
    return new;
end;
$$;

create trigger invitations_guard_owner
    before update on public.invitations
    for each row execute function public.guard_invitation_owner();

-- Turn a slugified base into a free slug: "anh-em", "anh-em-2", "anh-em-3", ...
-- SECURITY DEFINER so it sees every invitation, not only the caller's.
create or replace function public.unique_slug(p_base text, p_ignore_id bigint default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    base      text := coalesce(nullif(trim(both '-' from p_base), ''), 'thiep-cuoi');
    candidate text := base;
    i         int := 1;
begin
    if base !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' then
        raise exception 'Slug không hợp lệ: %', p_base;
    end if;

    while public.is_reserved_slug(candidate)
       or exists (select 1 from public.invitations
                  where slug = candidate and (p_ignore_id is null or id <> p_ignore_id))
    loop
        i := i + 1;
        candidate := base || '-' || i;
    end loop;

    return candidate;
end;
$$;

-- -----------------------------------------------------------------------------
-- Media (image / audio pool per invitation)
--   url columns hold either a Supabase Storage public URL, or a site-relative
--   /templates/{key}/... path for demo assets that ship with a template.
--   storage_paths lists the objects in the "media" bucket owned by this row.
-- -----------------------------------------------------------------------------
create table public.media (
    id             bigint generated always as identity primary key,
    invitation_id  bigint not null references public.invitations (id) on delete cascade,
    collection     text not null check (collection in ('library', 'audio')),
    name           text not null,
    full_url       text not null,
    web_url        text,
    thumb_url      text,
    alt            text not null default '',
    storage_paths  text[] not null default '{}',
    created_at     timestamptz not null default now()
);

create index media_invitation_idx on public.media (invitation_id, collection);

alter table public.media enable row level security;

create policy "media: owner or admin all" on public.media
    for all to authenticated
    using (public.can_edit_invitation(invitation_id))
    with check (public.can_edit_invitation(invitation_id));

-- -----------------------------------------------------------------------------
-- RSVPs & guestbook
-- -----------------------------------------------------------------------------
create table public.rsvps (
    id             bigint generated always as identity primary key,
    invitation_id  bigint not null references public.invitations (id) on delete cascade,
    name           text not null,
    phone          text,
    guest_count    smallint not null default 1 check (guest_count between 1 and 20),
    attendance     text not null default 'yes' check (attendance in ('yes', 'no', 'maybe')),
    food_option    text,
    notes          text,
    ip             text,
    created_at     timestamptz not null default now()
);

create index rsvps_invitation_idx on public.rsvps (invitation_id, attendance);
create index rsvps_ip_idx on public.rsvps (ip, created_at);

create table public.guestbook_messages (
    id             bigint generated always as identity primary key,
    invitation_id  bigint not null references public.invitations (id) on delete cascade,
    name           text not null,
    message        text not null,
    emoji          text,
    status         text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
    ip             text,
    created_at     timestamptz not null default now()
);

create index guestbook_invitation_idx on public.guestbook_messages (invitation_id, status, created_at desc);
create index guestbook_ip_idx on public.guestbook_messages (ip, created_at);

alter table public.rsvps enable row level security;
alter table public.guestbook_messages enable row level security;

-- Owners read/moderate/delete; nobody inserts directly (public RPCs do that).
create policy "rsvps: owner or admin read" on public.rsvps
    for select to authenticated using (public.can_edit_invitation(invitation_id));
create policy "rsvps: owner or admin delete" on public.rsvps
    for delete to authenticated using (public.can_edit_invitation(invitation_id));

create policy "guestbook: owner or admin read" on public.guestbook_messages
    for select to authenticated using (public.can_edit_invitation(invitation_id));
create policy "guestbook: owner or admin moderate" on public.guestbook_messages
    for update to authenticated
    using (public.can_edit_invitation(invitation_id))
    with check (public.can_edit_invitation(invitation_id));
create policy "guestbook: owner or admin delete" on public.guestbook_messages
    for delete to authenticated using (public.can_edit_invitation(invitation_id));

-- Only the status of a wish is moderatable.
revoke update on public.guestbook_messages from authenticated;
grant update (status) on public.guestbook_messages to authenticated;

-- -----------------------------------------------------------------------------
-- Public helpers
-- -----------------------------------------------------------------------------
create or replace function public.clean_text(p_value text, p_max int)
returns text
language sql
immutable
as $$
    select nullif(left(trim(regexp_replace(coalesce(p_value, ''), '<[^>]*>', '', 'g')), p_max), '');
$$;

-- Caller IP as seen by PostgREST (first hop of X-Forwarded-For).
create or replace function public.request_ip()
returns text
language sql
stable
as $$
    select nullif(trim(split_part(
        coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), '');
$$;

create or replace function public.published_invitation_id(p_slug text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
    select id from public.invitations where slug = p_slug and status = 'published';
$$;

create or replace function public.rsvp_stats(p_invitation_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'attending_guests', coalesce(sum(guest_count) filter (where attendance = 'yes'), 0),
        'rsvp_count', count(*)
    )
    from public.rsvps where invitation_id = p_invitation_id;
$$;

-- Everything the public page renderer needs, for a PUBLISHED invitation only.
-- Optionally counts the view (without touching updated_at).
create or replace function public.public_invitation(p_slug text, p_track boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    inv public.invitations;
    result jsonb;
begin
    select * into inv from public.invitations where slug = p_slug and status = 'published';
    if not found then
        return null;
    end if;

    if p_track then
        update public.invitations set view_count = view_count + 1 where id = inv.id;
    end if;

    select jsonb_build_object(
        'invitation', jsonb_build_object(
            'id', inv.id, 'slug', inv.slug, 'title', inv.title, 'locale', inv.locale,
            'template_key', inv.template_key, 'settings', inv.settings, 'theme', inv.theme,
            'seo', inv.seo, 'updated_at', inv.updated_at
        ),
        'manifest', t.manifest,
        'media', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', m.id, 'collection', m.collection, 'name', m.name, 'full_url', m.full_url,
                'web_url', m.web_url, 'thumb_url', m.thumb_url, 'alt', m.alt
            ) order by m.id)
            from public.media m where m.invitation_id = inv.id
        ), '[]'::jsonb)
    ) into result
    from public.templates t where t.key = inv.template_key;

    return result;
end;
$$;

create or replace function public.public_guestbook(p_slug text)
returns table (id bigint, name text, message text, emoji text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
    select g.id, g.name, g.message, g.emoji, g.created_at
    from public.guestbook_messages g
    where g.invitation_id = public.published_invitation_id(p_slug) and g.status = 'approved'
    order by g.created_at desc
    limit 50;
$$;

create or replace function public.public_rsvp_stats(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    inv_id bigint := public.published_invitation_id(p_slug);
begin
    if inv_id is null then
        raise exception 'Không tìm thấy thiệp.' using errcode = 'P0002';
    end if;
    return public.rsvp_stats(inv_id);
end;
$$;

create or replace function public.submit_rsvp(
    p_slug         text,
    p_name         text,
    p_phone        text default null,
    p_guest_count  int  default 1,
    p_attendance   text default 'yes',
    p_food_option  text default null,
    p_notes        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    inv_id bigint := public.published_invitation_id(p_slug);
    v_ip   text := public.request_ip();
    v_name text := public.clean_text(p_name, 120);
begin
    if inv_id is null then
        raise exception 'Không tìm thấy thiệp.' using errcode = 'P0002';
    end if;
    if v_name is null then
        raise exception 'Vui lòng nhập họ tên.';
    end if;
    if v_ip is not null and (
        select count(*) from public.rsvps where ip = v_ip and created_at > now() - interval '1 minute'
    ) >= 5 then
        raise exception 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.';
    end if;

    insert into public.rsvps (invitation_id, name, phone, guest_count, attendance, food_option, notes, ip)
    values (
        inv_id,
        v_name,
        public.clean_text(p_phone, 20),
        least(20, greatest(1, coalesce(p_guest_count, 1))),
        case when p_attendance in ('yes', 'no', 'maybe') then p_attendance else 'yes' end,
        public.clean_text(p_food_option, 80),
        public.clean_text(p_notes, 500),
        v_ip
    );

    return jsonb_build_object('message', 'Cảm ơn bạn đã xác nhận!', 'stats', public.rsvp_stats(inv_id));
end;
$$;

create or replace function public.submit_guestbook(
    p_slug     text,
    p_name     text,
    p_message  text,
    p_emoji    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    inv     public.invitations;
    v_ip    text := public.request_ip();
    v_name  text := public.clean_text(p_name, 80);
    v_msg   text := public.clean_text(p_message, 500);
    v_row   public.guestbook_messages;
begin
    select * into inv from public.invitations where slug = p_slug and status = 'published';
    if not found then
        raise exception 'Không tìm thấy thiệp.' using errcode = 'P0002';
    end if;
    if v_name is null or v_msg is null then
        raise exception 'Vui lòng nhập tên và lời chúc.';
    end if;
    if v_ip is not null and (
        select count(*) from public.guestbook_messages where ip = v_ip and created_at > now() - interval '1 minute'
    ) >= 5 then
        raise exception 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.';
    end if;

    insert into public.guestbook_messages (invitation_id, name, message, emoji, status, ip)
    values (
        inv.id, v_name, v_msg, public.clean_text(p_emoji, 16),
        case when coalesce((inv.settings #>> '{guestbook,moderate}')::boolean, false) then 'pending' else 'approved' end,
        v_ip
    )
    returning * into v_row;

    return jsonb_build_object(
        'message', case when v_row.status = 'approved'
                        then 'Cảm ơn lời chúc của bạn!'
                        else 'Lời chúc đã được gửi và đang chờ duyệt.' end,
        'approved', v_row.status = 'approved',
        'data', jsonb_build_object('id', v_row.id, 'name', v_row.name, 'message', v_row.message,
                                   'emoji', v_row.emoji, 'created_at', v_row.created_at)
    );
end;
$$;

-- Anonymous visitors may only call these RPCs.
revoke execute on function public.public_invitation(text, boolean) from public;
grant execute on function public.public_invitation(text, boolean) to anon, authenticated;
grant execute on function public.public_guestbook(text) to anon, authenticated;
grant execute on function public.public_rsvp_stats(text) to anon, authenticated;
grant execute on function public.submit_rsvp(text, text, text, int, text, text, text) to anon, authenticated;
grant execute on function public.submit_guestbook(text, text, text, text) to anon, authenticated;

-- Internal helpers are not part of the API (Supabase grants execute to
-- anon/authenticated by default, so revoke from them explicitly).
revoke execute on function public.rsvp_stats(bigint) from public, anon, authenticated;
revoke execute on function public.published_invitation_id(text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: broadcast new wishes / RSVP totals on topic "invitation:{id}".
-- Payloads carry no personal data (no phone numbers, no IPs). Best-effort:
-- a Realtime hiccup must never fail the guest's submission.
-- -----------------------------------------------------------------------------
create or replace function public.broadcast_guestbook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
        begin
            perform realtime.send(
                jsonb_build_object('id', new.id, 'name', new.name, 'message', new.message,
                                   'emoji', new.emoji, 'created_at', new.created_at),
                'guestbook', 'invitation:' || new.invitation_id, false);
        exception when others then
            raise warning 'realtime broadcast failed: %', sqlerrm;
        end;
    end if;
    return new;
end;
$$;

create trigger guestbook_broadcast
    after insert or update of status on public.guestbook_messages
    for each row execute function public.broadcast_guestbook();

create or replace function public.broadcast_rsvp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    begin
        perform realtime.send(public.rsvp_stats(new.invitation_id), 'rsvp',
                              'invitation:' || new.invitation_id, false);
    exception when others then
        raise warning 'realtime broadcast failed: %', sqlerrm;
    end;
    return new;
end;
$$;

create trigger rsvp_broadcast
    after insert on public.rsvps
    for each row execute function public.broadcast_rsvp();

-- -----------------------------------------------------------------------------
-- Storage: public "media" bucket, objects stored under "{invitation_id}/..."
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'media', 'media', true, 20971520,  -- 20 MB (images are capped at 10 MB client-side)
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
          'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/x-m4a', 'audio/mp4']
)
on conflict (id) do nothing;

create or replace function public.storage_invitation_id(p_name text)
returns bigint
language sql
immutable
as $$
    select case when split_part(p_name, '/', 1) ~ '^[0-9]+$' then split_part(p_name, '/', 1)::bigint end;
$$;

create policy "media bucket: editors read" on storage.objects
    for select to authenticated
    using (bucket_id = 'media' and public.can_edit_invitation(public.storage_invitation_id(name)));

create policy "media bucket: editors upload" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'media' and public.can_edit_invitation(public.storage_invitation_id(name)));

create policy "media bucket: editors update" on storage.objects
    for update to authenticated
    using (bucket_id = 'media' and public.can_edit_invitation(public.storage_invitation_id(name)));

create policy "media bucket: editors delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'media' and public.can_edit_invitation(public.storage_invitation_id(name)));
