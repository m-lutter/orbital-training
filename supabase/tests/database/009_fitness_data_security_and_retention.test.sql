begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
)
values
    (
        '00000000-0000-0000-0000-000000000000',
        '91000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'fitness-a@example.test', '',
        now(), '{}'::jsonb, '{}'::jsonb, now(), now()
    ),
    (
        '00000000-0000-0000-0000-000000000000',
        '92000000-0000-4000-8000-000000000002',
        'authenticated', 'authenticated', 'fitness-b@example.test', '',
        now(), '{}'::jsonb, '{}'::jsonb, now(), now()
    );

insert into public.fitness_connections (
    id, user_id, provider, status, scopes, consent_version, metadata
)
values
    (
        '91100000-0000-4000-8000-000000000001',
        '91000000-0000-4000-8000-000000000001',
        'google_health', 'active', array['fitness.read'], '1', '{}'::jsonb
    ),
    (
        '92200000-0000-4000-8000-000000000002',
        '92000000-0000-4000-8000-000000000002',
        'whoop', 'active', array['read:workout'], '1', '{}'::jsonb
    );

insert into public.fitness_workout_sessions (
    id, connection_id, user_id, source_session_key, workout_type,
    started_at, ended_at, duration_seconds
)
values (
    '91300000-0000-4000-8000-000000000001',
    '91100000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'orbital:test-workout', 'strength_training',
    now() - interval '2 hours', now() - interval '1 hour', 3600
);

insert into public.fitness_hr_samples (
    connection_id, user_id, sampled_at, bpm, source_record_id,
    source_session_key, ingested_at, expires_at
)
values
    (
        '91100000-0000-4000-8000-000000000001',
        '91000000-0000-4000-8000-000000000001',
        now() - interval '110 minutes', 121, 'matching-sample',
        'orbital:test-workout', now(), now() + interval '7 days'
    ),
    (
        '91100000-0000-4000-8000-000000000001',
        '91000000-0000-4000-8000-000000000001',
        now() - interval '100 minutes', 130, 'provider-sample',
        null, now(), now() + interval '7 days'
    ),
    (
        '91100000-0000-4000-8000-000000000001',
        '91000000-0000-4000-8000-000000000001',
        now() - interval '90 minutes', 141, 'different-workout',
        'orbital:other-workout', now(), now() + interval '7 days'
    ),
    (
        '91100000-0000-4000-8000-000000000001',
        '91000000-0000-4000-8000-000000000001',
        now() - interval '8 days', 70, 'expired-sample', null,
        now() - interval '8 days', now() - interval '1 minute'
    );

insert into public.fitness_hr_5m (
    connection_id, user_id, bucket_start, minimum_bpm, maximum_bpm,
    average_bpm, sample_count, source
)
values
    (
        '91100000-0000-4000-8000-000000000001',
        '91000000-0000-4000-8000-000000000001',
        to_timestamp(
            floor(extract(epoch from now() - interval '105 minutes') / 300) * 300
        ),
        120, 135, 127.5, 10, 'raw'
    ),
    (
        '91100000-0000-4000-8000-000000000001',
        '91000000-0000-4000-8000-000000000001',
        to_timestamp(
            floor(extract(epoch from now() - interval '401 days') / 300) * 300
        ),
        60, 80, 70, 12, 'raw'
    );

insert into app_private.fitness_audit_events (
    connection_id, user_id, event_type, actor_type, details, occurred_at
)
values
    (
        '91100000-0000-4000-8000-000000000001',
        '91000000-0000-4000-8000-000000000001',
        'old_test_event', 'system', '{}'::jsonb, now() - interval '366 days'
    ),
    (
        '91100000-0000-4000-8000-000000000001',
        '91000000-0000-4000-8000-000000000001',
        'fresh_test_event', 'system', '{}'::jsonb, now()
    );

insert into app_private.fitness_sync_leases (
    connection_id, purpose, lease_token, lease_expires_at,
    last_claimed_at, updated_at
)
values (
    '91100000-0000-4000-8000-000000000001',
    'background', '91400000-0000-4000-8000-000000000001',
    now() - interval '2 days', now() - interval '3 days', now() - interval '2 days'
);

with expected(table_name) as (
    values
        ('fitness_connections'),
        ('fitness_daily_metrics'),
        ('fitness_workout_sessions'),
        ('fitness_hr_samples'),
        ('fitness_hr_5m'),
        ('fitness_workout_summaries'),
        ('fitness_summaries'),
        ('fitness_consent_events')
)
select ok(
    coalesce((
        select relation.relrowsecurity
        from pg_class as relation
        join pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = expected.table_name
    ), false),
    format('RLS is enabled on public.%I', expected.table_name)
)
from expected;

select ok(
    not has_table_privilege(
        'authenticated', 'public.fitness_hr_samples', 'SELECT'
    )
    and not has_table_privilege(
        'anon', 'public.fitness_hr_samples', 'SELECT'
    )
    and has_table_privilege(
        'authenticated', 'public.fitness_hr_5m', 'SELECT'
    ),
    'raw heart-rate samples stay server-only while five-minute buckets are readable'
);

with service_functions(function_oid, label) as (
    values
        (
            'public.fitness_get_workout_raw_detail(uuid,uuid,integer)'::regprocedure::oid,
            'raw workout detail'
        ),
        (
            'public.fitness_run_retention(integer,integer,integer)'::regprocedure::oid,
            'fitness retention'
        ),
        (
            'public.fitness_refresh_connection_tokens(uuid,uuid,integer,text,text,text,timestamptz,text[],text)'::regprocedure::oid,
            'non-reactivating token refresh'
        )
)
select ok(
    procedure.prosecdef
    and array_to_string(
        coalesce(procedure.proconfig, array[]::text[]), ','
    ) like '%search_path=%'
    and has_function_privilege(
        'service_role', service_functions.function_oid, 'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated', service_functions.function_oid, 'EXECUTE'
    )
    and not has_function_privilege(
        'anon', service_functions.function_oid, 'EXECUTE'
    ),
    service_functions.label || ' is hardened and service-role-only'
)
from service_functions
join pg_proc as procedure on procedure.oid = service_functions.function_oid;

create temporary table test_fitness_raw_detail(payload jsonb);
grant insert, select on test_fitness_raw_detail to service_role;

set local role service_role;
insert into test_fitness_raw_detail
select public.fitness_get_workout_raw_detail(
    '91000000-0000-4000-8000-000000000001',
    '91300000-0000-4000-8000-000000000001',
    5000
);
reset role;

select is(
    jsonb_array_length((select payload -> 'samples' from test_fitness_raw_detail)),
    2,
    'the raw workout projection includes matching and provider-unscoped samples only'
);

select is(
    jsonb_array_length((select payload -> 'buckets' from test_fitness_raw_detail)),
    1,
    'the raw workout projection includes the bounded five-minute plot data'
);

select is(
    (select (payload #>> '{rawSummary,sampleCount}')::integer
     from test_fitness_raw_detail),
    2,
    'workout statistics include every retained matching raw sample'
);

set local role service_role;
select is(
    public.fitness_get_workout_raw_detail(
        '92000000-0000-4000-8000-000000000002',
        '91300000-0000-4000-8000-000000000001',
        5000
    ),
    null::jsonb,
    'the service projection still requires matching user ownership'
);

select throws_ok(
    $$ select public.fitness_get_workout_raw_detail(
        '91000000-0000-4000-8000-000000000001',
        '91300000-0000-4000-8000-000000000001',
        5001
    ) $$,
    '22023',
    'The workout sample limit is invalid.',
    'the detailed workout response cannot exceed its hard sample cap'
);

select throws_ok(
    $$ select public.fitness_get_workout_raw_detail(
        '91000000-0000-4000-8000-000000000001',
        '91300000-0000-4000-8000-000000000001',
        null
    ) $$,
    '22023',
    'The workout sample limit is invalid.',
    'a null detail limit cannot disable the hard sample cap'
);
reset role;

set local role service_role;
select throws_ok(
    $$ select public.fitness_upsert_daily_metrics(
        '91000000-0000-4000-8000-000000000001',
        '91100000-0000-4000-8000-000000000001',
        '[]'::jsonb,
        2
    ) $$,
    '22023',
    'The fitness connection is unavailable.',
    'a stale connection generation cannot write normalized health data'
);
reset role;

create temporary table test_fitness_retention(payload jsonb);
grant insert, select on test_fitness_retention to service_role;

set local role service_role;
insert into test_fitness_retention
select public.fitness_run_retention(7, 365, 20000);
reset role;

select is(
    (select (payload ->> 'rawSamplesDeleted')::integer
     from test_fitness_retention),
    1,
    'retention deletes expired raw heart-rate samples'
);

select is(
    (select (payload ->> 'heartRateBucketsDeleted')::integer
     from test_fitness_retention),
    1,
    'retention deletes only long-expired five-minute buckets'
);

select is(
    (select (payload ->> 'auditEventsDeleted')::integer
     from test_fitness_retention),
    1,
    'retention deletes private fitness audit events after 365 days'
);

select is(
    (select (payload ->> 'staleLeasesCleared')::integer
     from test_fitness_retention),
    1,
    'retention clears abandoned sync leases'
);

select is(
    (select count(*) from public.fitness_hr_samples
     where connection_id = '91100000-0000-4000-8000-000000000001'),
    3::bigint,
    'unexpired workout samples remain available during the short retention window'
);

select is(
    (select count(*) from app_private.fitness_audit_events
     where event_type = 'fresh_test_event'),
    1::bigint,
    'fresh private audit history is retained'
);

set local role service_role;
select throws_ok(
    $$ select public.fitness_run_retention(0, 365, 20000) $$,
    '22023',
    'The retention parameters are invalid.',
    'retention refuses an unsafe raw-sample duration'
);

select throws_ok(
    $$ select public.fitness_run_retention(7, 365, null) $$,
    '22023',
    'The retention parameters are invalid.',
    'a null batch limit cannot turn bounded retention into an unbounded delete'
);

select throws_ok(
    $$ select public.fitness_claim_sync_lease(null, null, 120) $$,
    '22023',
    'The sync claim parameters are invalid.',
    'a null sync-claim limit cannot become an unbounded provider claim'
);
reset role;

select is(
    (select count(*) from cron.job
     where jobname = 'orbital-fitness-retention-hourly'),
    1::bigint,
    'exactly one named hourly fitness-retention job is scheduled'
);

select ok(
    exists (
        select 1
        from cron.job
        where jobname = 'orbital-fitness-retention-hourly'
          and schedule = '23 * * * *'
          and command = 'select public.fitness_run_retention(7, 365, 20000);'
    ),
    'the hourly job drains the seven-day raw and 365-day audit policy in bounded batches'
);

select has_index(
    'public',
    'fitness_hr_5m',
    'fitness_hr_5m_retention_idx',
    'bucket retention has a leading-time index'
);

update public.fitness_connections
set generation = generation + 1
where id = '91100000-0000-4000-8000-000000000001';

select is(
    (select count(*) from public.fitness_hr_samples
     where connection_id = '91100000-0000-4000-8000-000000000001'),
    0::bigint,
    'a new connection generation cannot inherit prior health data'
);

create temporary table test_device_connection(id uuid);
grant insert, select on test_device_connection to service_role;

set local role service_role;
insert into test_device_connection
select public.fitness_register_device_connection(
    '92000000-0000-4000-8000-000000000002',
    'health_connect',
    'test-device-key-1234567890',
    array['read:steps'],
    '1',
    '{}'::jsonb
);
select public.fitness_register_device_connection(
    '92000000-0000-4000-8000-000000000002',
    'health_connect',
    'test-device-key-1234567890',
    array['read:steps'],
    '1',
    '{}'::jsonb
);
select public.fitness_register_device_connection(
    '92000000-0000-4000-8000-000000000002',
    'health_connect',
    'test-device-key-1234567890',
    array['read:heart_rate', 'read:steps'],
    '1',
    '{}'::jsonb
);
select public.fitness_register_device_connection(
    '92000000-0000-4000-8000-000000000002',
    'health_connect',
    'test-device-key-1234567890',
    array['read:steps', 'read:heart_rate'],
    '1',
    '{}'::jsonb
);
select public.fitness_register_device_connection(
    '92000000-0000-4000-8000-000000000002',
    'health_connect',
    'test-device-key-1234567890',
    array['read:steps'],
    '1',
    '{}'::jsonb
);
select public.fitness_register_device_connection(
    '92000000-0000-4000-8000-000000000002',
    'health_connect',
    'test-device-key-1234567890',
    array['read:heart_rate', 'read:steps'],
    '1',
    '{}'::jsonb
);
reset role;

select is(
    (select count(*) from public.fitness_consent_events
     where user_id = '92000000-0000-4000-8000-000000000002'
       and event_type = 'granted'),
    1::bigint,
    'retrying an unchanged native grant keeps one idempotent consent event'
);

select is(
    (select count(*) from public.fitness_consent_events
     where user_id = '92000000-0000-4000-8000-000000000002'
       and event_type = 'scopes_changed'),
    3::bigint,
    'every A-to-B-to-A-to-B permission transition remains in consent history'
);

select is(
    (select scopes from public.fitness_connections
     where id = (select id from test_device_connection limit 1)),
    array['read:heart_rate', 'read:steps']::text[],
    'permission scopes are sorted and deduplicated before comparison and storage'
);

set local role service_role;
select public.fitness_register_device_connection(
    '92000000-0000-4000-8000-000000000002',
    'health_connect',
    'test-device-key-1234567890',
    array['read:heart_rate', 'read:steps'],
    '2',
    '{}'::jsonb
);
select public.fitness_register_device_connection(
    '92000000-0000-4000-8000-000000000002',
    'health_connect',
    'test-device-key-1234567890',
    array['read:heart_rate', 'read:steps'],
    '2',
    '{}'::jsonb
);
select public.fitness_register_device_connection(
    '92000000-0000-4000-8000-000000000002',
    'health_connect',
    'test-device-key-1234567890',
    array['read:heart_rate', 'read:steps'],
    '1',
    '{}'::jsonb
);
select public.fitness_register_device_connection(
    '92000000-0000-4000-8000-000000000002',
    'health_connect',
    'test-device-key-1234567890',
    array['read:heart_rate', 'read:steps'],
    '2',
    '{}'::jsonb
);
reset role;

select is(
    (select count(*) from public.fitness_consent_events
     where user_id = '92000000-0000-4000-8000-000000000002'
       and event_type = 'consent_version_changed'),
    3::bigint,
    'every version-1-to-2-to-1-to-2 consent transition remains in history'
);

select is(
    (select consent_version from public.fitness_connections
     where id = (select id from test_device_connection limit 1)),
    '2',
    'the active connection retains the latest consent version'
);

set local role service_role;
select public.fitness_disconnect_provider(
    '92000000-0000-4000-8000-000000000002',
    (select id from test_device_connection limit 1),
    false
);
reset role;

update public.fitness_consent_events
set occurred_at = '2000-01-01 00:00:00+00'::timestamptz
where user_id = '92000000-0000-4000-8000-000000000002'
  and event_type = 'revoked';

set local role service_role;
select public.fitness_disconnect_provider(
    '92000000-0000-4000-8000-000000000002',
    (select id from test_device_connection limit 1),
    true
);
reset role;

select is(
    (select details ->> 'healthDataDeleted'
     from public.fitness_consent_events
     where user_id = '92000000-0000-4000-8000-000000000002'
       and event_type = 'revoked'),
    'true',
    'a later delete request upgrades the existing revocation audit event'
);

select is(
    (select occurred_at
     from public.fitness_consent_events
     where user_id = '92000000-0000-4000-8000-000000000002'
       and event_type = 'revoked'),
    '2000-01-01 00:00:00+00'::timestamptz,
    'upgrading to deletion preserves the original revocation time'
);

select ok(
    (select details ->> 'healthDataDeletedAt'
     from public.fitness_consent_events
     where user_id = '92000000-0000-4000-8000-000000000002'
       and event_type = 'revoked') is not null,
    'the first deletion request records when provider data was deleted'
);

update public.fitness_consent_events
set details = jsonb_set(
    details,
    '{healthDataDeletedAt}',
    to_jsonb('2001-01-01T00:00:00Z'::text)
)
where user_id = '92000000-0000-4000-8000-000000000002'
  and event_type = 'revoked';

set local role service_role;
select public.fitness_disconnect_provider(
    '92000000-0000-4000-8000-000000000002',
    (select id from test_device_connection limit 1),
    true
);
reset role;

select is(
    (select details ->> 'healthDataDeletedAt'
     from public.fitness_consent_events
     where user_id = '92000000-0000-4000-8000-000000000002'
       and event_type = 'revoked'),
    '2001-01-01T00:00:00Z',
    'retrying deletion does not rewrite its audit timestamp'
);

select * from finish();
rollback;
