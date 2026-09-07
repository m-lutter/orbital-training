begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
)
values (
    '00000000-0000-0000-0000-000000000000',
    '51000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'account-export@example.test', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.programs (id, user_id, name, payload)
values (
    'e1000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001',
    'Account lifecycle program',
    '{}'::jsonb
);

insert into public.feedback_reports (
    id, user_id, program_id, category, message, blocked_user, may_contact,
    page_path, app_version, client_context
)
values (
    'f1000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'idea',
    'Include this owned feedback in the account data export.',
    false,
    true,
    '/dashboard',
    '0.0.1-beta.4',
    '{"viewportWidth":390}'::jsonb
);

set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '51000000-0000-4000-8000-000000000001',
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
    jsonb_array_length(public.export_my_feedback()),
    1,
    'an authenticated user can export exactly their own feedback'
);

select ok(
    not (public.export_my_feedback() -> 0 ? 'user_id'),
    'the feedback export omits the redundant internal owner identifier'
);

select is(
    public.delete_my_account(),
    true,
    'an authenticated user can delete their own account'
);

reset role;

select is(
    (select count(*) from auth.users
     where id = '51000000-0000-4000-8000-000000000001'),
    0::bigint,
    'account deletion removes the Auth user'
);
select is(
    (select count(*) from public.profiles
     where id = '51000000-0000-4000-8000-000000000001'),
    0::bigint,
    'account deletion cascades to the profile'
);
select is(
    (select count(*) from public.programs
     where user_id = '51000000-0000-4000-8000-000000000001'),
    0::bigint,
    'account deletion cascades to programs'
);
select is(
    (select count(*) from public.feedback_reports
     where user_id = '51000000-0000-4000-8000-000000000001'),
    0::bigint,
    'account deletion cascades to feedback reports'
);

select * from finish();
rollback;
