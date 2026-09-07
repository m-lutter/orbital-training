begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
)
values
    (
        '00000000-0000-0000-0000-000000000000',
        '10000000-0000-4000-8000-000000000001',
        'authenticated',
        'authenticated',
        'rls-user-a@example.test',
        '',
        now(),
        '{}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
    ),
    (
        '00000000-0000-0000-0000-000000000000',
        '20000000-0000-4000-8000-000000000002',
        'authenticated',
        'authenticated',
        'rls-user-b@example.test',
        '',
        now(),
        '{}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
    );

insert into public.programs (id, user_id, name, payload)
values
    (
        'a0000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'User A program',
        '{}'::jsonb
    ),
    (
        'b0000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000002',
        'User B program',
        '{}'::jsonb
    );

-- PostgreSQL does not allow a data-modifying CTE inside the scalar expression
-- passed to pgTAP's is(). Keep the delete as a top-level statement inside an
-- invoker-security helper so RLS is still evaluated as the authenticated user,
-- then return the affected-row count for the assertion.
create function public.test_delete_program_as_current_user(target_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
    affected_rows bigint;
begin
    delete from public.programs
    where id = target_id;

    get diagnostics affected_rows = row_count;
    return affected_rows;
end;
$$;

grant execute on function public.test_delete_program_as_current_user(uuid)
to authenticated;

set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-8000-000000000001',
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
    'select name from public.programs order by name',
    $$ values ('User A program'::text) $$,
    'User A can read only User A programs'
);

select lives_ok(
    $$ select public.submit_feedback(
        'bug',
        'A reproducible beta issue with enough detail.',
        false,
        true,
        '/programs/a0000000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000001',
        '0.0.1-beta.1',
        '{}'::jsonb
    ) $$,
    'User A can submit feedback about User A program through the bounded RPC'
);

select throws_ok(
    $$ select public.submit_feedback(
        'bug',
        'Attempt to attach feedback to another user program.',
        false,
        false,
        '/dashboard',
        'b0000000-0000-4000-8000-000000000002',
        '0.0.1-beta.1',
        '{}'::jsonb
    ) $$,
    '42501',
    'feedback_program_not_owned',
    'User A cannot attach feedback to User B program'
);

select is(
    public.test_delete_program_as_current_user(
        'b0000000-0000-4000-8000-000000000002'
    ),
    0::bigint,
    'User A cannot delete User B program'
);

select set_config(
    'request.jwt.claim.sub',
    '20000000-0000-4000-8000-000000000002',
    true
);
select results_eq(
    'select name from public.programs order by name',
    $$ values ('User B program'::text) $$,
    'User B can read only User B programs'
);

select set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-8000-000000000001',
    true
);
select is(
    public.test_delete_program_as_current_user(
        'a0000000-0000-4000-8000-000000000001'
    ),
    1::bigint,
    'User A can delete User A program'
);

select * from finish();
rollback;
