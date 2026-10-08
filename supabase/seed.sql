-- =============================================================================
-- Dev seed users (mirrors the Laravel DatabaseSeeder):
--   admin@kanewedding.test  / password   -> admin
--   editor@kanewedding.test / password   -> editor
--
-- Run AFTER the migration, in Supabase Dashboard → SQL Editor
-- (the Supabase CLI also runs this file automatically on `supabase db reset`).
-- Safe to re-run: existing users get their password reset, are confirmed,
-- and have their role re-applied.
--
-- ⚠ Weak, publicly known passwords — change them before going live.
-- =============================================================================

create or replace function pg_temp.seed_user(p_email text, p_password text, p_name text, p_role text)
returns void
language plpgsql
as $$
declare
    uid uuid;
begin
    select id into uid from auth.users where email = p_email;

    if uid is null then
        uid := gen_random_uuid();

        insert into auth.users (
            instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
            -- GoTrue cannot scan NULL into these token columns: keep them ''.
            confirmation_token, recovery_token, email_change_token_new, email_change
        ) values (
            '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
            p_email, extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('name', p_name), now(), now(),
            '', '', '', ''
        );

        insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (
            gen_random_uuid(), uid, uid::text,
            jsonb_build_object('sub', uid::text, 'email', p_email, 'email_verified', true),
            'email', now(), now(), now()
        );
    else
        update auth.users
        set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
            email_confirmed_at = coalesce(email_confirmed_at, now()),
            updated_at = now()
        where id = uid;
    end if;

    -- The on_auth_user_created trigger normally creates the profile; enforce name/role either way.
    insert into public.profiles (id, email, name, role)
    values (uid, p_email, p_name, p_role)
    on conflict (id) do update set email = excluded.email, name = excluded.name, role = excluded.role;
end;
$$;

select pg_temp.seed_user('admin@kanewedding.test', 'password', 'Kane Wedding Admin', 'admin');
select pg_temp.seed_user('editor@kanewedding.test', 'password', 'Kane Wedding Editor', 'editor');

select email, role from public.profiles where email like '%@kanewedding.test' order by role;
