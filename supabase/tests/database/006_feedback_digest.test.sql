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
    '61000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'digest-user@example.test', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.feedback_reports (
    id, user_id, category, message, blocked_user, may_contact,
    page_path, app_version, client_context, created_at
)
values
    (
        'f6000000-0000-4000-8000-000000000001',
        '61000000-0000-4000-8000-000000000001',
        'bug', 'This report should include the permitted contact email.',
        true, true, '/dashboard', '0.0.1-beta.6',
        '{"viewportWidth":390}'::jsonb, now()
    ),
    (
        'f6000000-0000-4000-8000-000000000002',
        '61000000-0000-4000-8000-000000000001',
        'idea', 'This report should keep the contact email out of the digest.',
        false, false, '/programs/example', '0.0.1-beta.6',
        '{}'::jsonb, now() - interval '91 days'
    );

select ok(
    exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'feedback_reports'
          and column_name = 'digest_sent_at'
          and data_type = 'timestamp with time zone'
    ),
    'feedback reports track successful digest delivery separately from status'
);

with digest_functions(function_oid, label) as (
    values
      ('public.claim_feedback_digest(integer,integer)'::regprocedure::oid, 'claim digest'),
      ('public.begin_feedback_digest_delivery(uuid)'::regprocedure::oid, 'begin digest delivery'),
      ('public.complete_feedback_digest(uuid,text)'::regprocedure::oid, 'complete digest'),
      ('public.fail_feedback_digest(uuid,text)'::regprocedure::oid, 'record digest failure'),
      ('public.delete_expired_feedback(integer)'::regprocedure::oid, 'delete expired feedback')
)
select ok(
    has_function_privilege('service_role', digest_functions.function_oid, 'EXECUTE')
    and not has_function_privilege('authenticated', digest_functions.function_oid, 'EXECUTE')
    and not has_function_privilege('anon', digest_functions.function_oid, 'EXECUTE'),
    digest_functions.label || ' is service-role-only'
)
from digest_functions;

with digest_implementations(function_oid, label) as (
    values
      ('app_private.claim_feedback_digest_impl(integer,integer)'::regprocedure::oid, 'claim implementation'),
      ('app_private.begin_feedback_digest_delivery_impl(uuid)'::regprocedure::oid, 'begin delivery implementation'),
      ('app_private.complete_feedback_digest_impl(uuid,text)'::regprocedure::oid, 'completion implementation'),
      ('app_private.fail_feedback_digest_impl(uuid,text)'::regprocedure::oid, 'failure implementation'),
      ('app_private.delete_expired_feedback_impl(integer)'::regprocedure::oid, 'retention implementation')
)
select ok(
    procedure.prosecdef
    and array_to_string(
        coalesce(procedure.proconfig, array[]::text[]), ','
    ) like '%search_path=%'
    and has_function_privilege(
        'service_role', digest_implementations.function_oid, 'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated', digest_implementations.function_oid, 'EXECUTE'
    )
    and not has_function_privilege(
        'anon', digest_implementations.function_oid, 'EXECUTE'
    ),
    digest_implementations.label || ' is hardened and service-role-only'
)
from digest_implementations
join pg_proc as procedure on procedure.oid = digest_implementations.function_oid;

create temporary table test_feedback_digest_claim(payload jsonb);
grant insert, select on test_feedback_digest_claim to service_role;
set local role service_role;
insert into test_feedback_digest_claim
select public.claim_feedback_digest();
reset role;

select is(
    jsonb_array_length((select payload -> 'reports'
                        from test_feedback_digest_claim)),
    2,
    'the digest claims all previously unsent feedback in one stable batch'
);

set local role service_role;
select ok(
    public.begin_feedback_digest_delivery(
        (select (payload ->> 'batchId')::uuid
         from test_feedback_digest_claim)
    ),
    'a claimed batch is atomically marked as delivering before provider IO'
);
reset role;

select is(
    (select item ->> 'userEmail'
     from test_feedback_digest_claim,
     jsonb_array_elements(payload -> 'reports') as item
     where item ->> 'id' = 'f6000000-0000-4000-8000-000000000001'),
    'digest-user@example.test',
    'contact email is included only when the user grants contact permission'
);

select is(
    (select item ->> 'userEmail'
     from test_feedback_digest_claim,
     jsonb_array_elements(payload -> 'reports') as item
     where item ->> 'id' = 'f6000000-0000-4000-8000-000000000002'),
    null,
    'contact email is omitted when the user declines contact permission'
);

set local role service_role;
select is(
    public.complete_feedback_digest(
        (select (payload ->> 'batchId')::uuid
         from test_feedback_digest_claim),
        'resend-test-message-id'
    ),
    2,
    'completing a digest marks every claimed report as delivered'
);

select is(
    public.delete_expired_feedback(90),
    1,
    'the retention RPC deletes reports older than 90 days'
);
reset role;

select is(
    (select count(*) from public.feedback_reports
     where digest_sent_at is not null
       and digest_email_id = 'resend-test-message-id'),
    1::bigint,
    'fresh delivered feedback retains its provider delivery metadata'
);

insert into public.feedback_reports (
    id, user_id, category, message, blocked_user, may_contact,
    page_path, app_version, client_context, created_at
)
values (
    'f6000000-0000-4000-8000-000000000003',
    '61000000-0000-4000-8000-000000000001',
    'bug', 'This failed-delivery fixture is already beyond retention.',
    false, false, '/dashboard', '0.0.1-beta.6', '{}'::jsonb,
    now() - interval '91 days'
);

create temporary table test_failed_digest_claim(payload jsonb);
grant insert, select on test_failed_digest_claim to service_role;
set local role service_role;
insert into test_failed_digest_claim
select public.claim_feedback_digest();

select ok(
    public.begin_feedback_digest_delivery(
        (select (payload ->> 'batchId')::uuid from test_failed_digest_claim)
    ),
    'a retryable batch enters delivering state before the simulated request'
);

select is(
    public.fail_feedback_digest(
        (select (payload ->> 'batchId')::uuid from test_failed_digest_claim),
        'simulated provider outage'
    ),
    true,
    'a failed delivery remains as a retryable pending batch'
);

select is(
    public.delete_expired_feedback(90),
    1,
    'retention continues while a provider delivery is pending'
);

select is(
    public.claim_feedback_digest() ->> 'batchId',
    null,
    'cleanup removes a pending batch after all of its reports expire'
);
reset role;

set local role service_role;
select throws_ok(
    $$ select public.delete_expired_feedback(0) $$,
    '22023',
    'invalid_feedback_retention_days',
    'retention refuses unsafe durations'
);
reset role;

insert into public.feedback_reports (
    user_id, category, message, blocked_user, may_contact,
    page_path, app_version, client_context, created_at
)
select
    '61000000-0000-4000-8000-000000000001',
    'idea',
    format('Bounded feedback report number %s has enough detail.', item),
    false,
    false,
    '/dashboard',
    '0.0.1-beta.6',
    '{}'::jsonb,
    now() + pg_catalog.make_interval(secs => item)
from generate_series(1, 30) as item;

create temporary table test_bounded_digest_claim(payload jsonb);
grant insert, select on test_bounded_digest_claim to service_role;
set local role service_role;
insert into test_bounded_digest_claim
select public.claim_feedback_digest(10, 100000);
reset role;

select is(
    jsonb_array_length((select payload -> 'reports'
                        from test_bounded_digest_claim)),
    10,
    'digest candidate work and delivery remain bounded by the report limit'
);

select is(
    (select count(*)
     from public.feedback_reports
     where digest_sent_at is null and digest_batch_id is null),
    20::bigint,
    'reports beyond the batch limit remain available for a later delivery'
);

select * from finish();
rollback;
