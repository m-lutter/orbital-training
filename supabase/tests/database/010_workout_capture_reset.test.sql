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
    '93000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'fitness-reset@example.test', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.fitness_connections (
    id, user_id, provider, status, scopes, consent_version, metadata
)
values (
    '93300000-0000-4000-8000-000000000003',
    '93000000-0000-4000-8000-000000000003',
    'google_health', 'active', array['fitness.read'], '1', '{}'::jsonb
);

insert into public.fitness_workout_sessions (
    id, connection_id, user_id, source_session_key, workout_type, started_at
)
values (
    '93400000-0000-4000-8000-000000000003',
    '93300000-0000-4000-8000-000000000003',
    '93000000-0000-4000-8000-000000000003',
    '93000000-0000-4000-8000-000000000003:week-1-lifting-1',
    'strength_training', now() - interval '10 minutes'
);

insert into public.fitness_hr_samples (
    connection_id, user_id, sampled_at, bpm, source_session_key, expires_at
)
values (
    '93300000-0000-4000-8000-000000000003',
    '93000000-0000-4000-8000-000000000003',
    now() - interval '5 minutes', 125,
    '93000000-0000-4000-8000-000000000003:week-1-lifting-1',
    now() + interval '7 days'
);

insert into public.fitness_summaries (
    connection_id, user_id, summary_type, source_key,
    period_start, period_end, metrics
)
values (
    '93300000-0000-4000-8000-000000000003',
    '93000000-0000-4000-8000-000000000003',
    'workout',
    '93000000-0000-4000-8000-000000000003:week-1-lifting-1',
    now() - interval '10 minutes', now(), '{}'::jsonb
);

select ok(
    has_function_privilege(
        'service_role',
        'public.fitness_reset_workout_session(uuid,uuid,text)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated',
        'public.fitness_reset_workout_session(uuid,uuid,text)',
        'EXECUTE'
    ),
    'capture reset is service-role-only'
);

create temporary table test_reset_result(value boolean);
grant insert, select on test_reset_result to service_role;

set local role service_role;
insert into test_reset_result
select public.fitness_reset_workout_session(
    '93000000-0000-4000-8000-000000000003',
    '93300000-0000-4000-8000-000000000003',
    '93000000-0000-4000-8000-000000000003:week-1-lifting-1'
);
reset role;

select is((select value from test_reset_result), true, 'reset succeeds');
select is(
    (select count(*) from public.fitness_workout_sessions
     where id = '93400000-0000-4000-8000-000000000003'),
    0::bigint,
    'reset removes the capture session'
);
select is(
    (select count(*) from public.fitness_hr_samples
     where source_session_key =
        '93000000-0000-4000-8000-000000000003:week-1-lifting-1'),
    0::bigint,
    'reset removes raw samples assigned to the discarded capture'
);
select is(
    (select count(*) from public.fitness_summaries
     where source_key =
        '93000000-0000-4000-8000-000000000003:week-1-lifting-1'),
    0::bigint,
    'reset removes the discarded capture summary'
);
select is(
    (select count(*) from app_private.fitness_audit_events
     where event_type = 'workout_session_reset'
       and user_id = '93000000-0000-4000-8000-000000000003'),
    1::bigint,
    'reset records a private audit event'
);

set local role service_role;
insert into test_reset_result
select public.fitness_reset_workout_session(
    '93000000-0000-4000-8000-000000000003',
    '93300000-0000-4000-8000-000000000003',
    '93000000-0000-4000-8000-000000000003:week-1-lifting-1'
);
reset role;

select is(
    (select value from test_reset_result order by ctid desc limit 1),
    false,
    'retrying reset is idempotent'
);

select * from finish();
rollback;
