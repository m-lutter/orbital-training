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
    '71000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'projection@example.test', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.programs (id, user_id, name, payload)
values (
    'e7000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    'Projection program',
    jsonb_build_object(
        'schemaVersion', 3,
        'inputSnapshot', jsonb_build_object(
            'history', jsonb_build_object(
                'effortReporting', 'auto',
                'effortFamiliarity', 'basic'
            )
        ),
        'program', jsonb_build_object(
            'version', 1,
            'loadSettings', jsonb_build_object('units', 'lb'),
            'weeks', jsonb_build_array(jsonb_build_object(
                'weekNumber', 1,
                'sessions', jsonb_build_array(
                    jsonb_build_object(
                        'id', 'projection-session',
                        'weekNumber', 1,
                        'sequence', 1,
                        'kind', 'lifting',
                        'exercises', '[]'::jsonb
                    ),
                    jsonb_build_object(
                        'id', 'projection-movement',
                        'weekNumber', 1,
                        'sequence', 2,
                        'kind', 'movement',
                        'movementTarget', jsonb_build_object(
                            'steps', 7000,
                            'explanation', 'Test target'
                        )
                    )
                )
            ))
        )
    )
);

set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '71000000-0000-4000-8000-000000000001',
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
    public.workout_session_context(
        'e7000000-0000-4000-8000-000000000001',
        'projection-session'
    ) ->> 'firstFormalSessionId',
    'projection-session',
    'the projection returns only the requested workout context'
);

select is(
    public.workout_session_context(
        'e7000000-0000-4000-8000-000000000001',
        'projection-session'
    ) #>> '{movementTarget,steps}',
    '7000',
    'the projection carries the relevant movement target'
);

select ok(
    octet_length(public.workout_session_context(
        'e7000000-0000-4000-8000-000000000001',
        'projection-session'
    )::text) < 51200,
    'the workout context remains below the 50 KiB response ceiling'
);

create temporary table test_workout_revision(value text);
insert into test_workout_revision
select public.save_workout_log_v6(
    'e7000000-0000-4000-8000-000000000001',
    1, 'projection-session', 1, 1, 'in_progress',
    '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
    null, null, null, null, 'new'
) ->> 'updatedAt';

select is(
    public.save_workout_log_v6(
        'e7000000-0000-4000-8000-000000000001',
        1, 'projection-session', 1, 1, 'in_progress',
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        null, null, null, null, 'new'
    ) ->> 'unchanged',
    'true',
    'an identical stale new-tab save is an idempotent success'
);

select is(
    (
        select count(*)
        from public.workout_logs
        where program_id = 'e7000000-0000-4000-8000-000000000001'
          and session_id = 'projection-session'
    ),
    1::bigint,
    'an identical stale replay does not write another workout row'
);

select is(
    public.save_workout_log_v6(
        'e7000000-0000-4000-8000-000000000001',
        1, 'projection-session', 1, 1, 'completed',
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        null, null, null, null, 'new'
    ) ->> 'conflict',
    'workout_revision',
    'a stale differing save returns a structured revision conflict'
);

select is(
    (
        select status
        from public.workout_logs
        where program_id = 'e7000000-0000-4000-8000-000000000001'
          and program_version = 1
          and session_id = 'projection-session'
    ),
    'in_progress',
    'a structured revision conflict leaves the stored workout unchanged'
);

select lives_ok(
    format(
        $save$ select public.save_workout_log_v6(
            'e7000000-0000-4000-8000-000000000001',
            1, 'projection-session', 1, 1, 'in_progress',
            '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
            null, null, null, null, %L
        ) $save$,
        (select value from test_workout_revision)
    ),
    'the matching revision can safely reuse an identical workout'
);

select is(
    public.save_workout_log_v6(
        'e7000000-0000-4000-8000-000000000001',
        1, 'projection-session', 1, 1, 'in_progress',
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        null, null, null, null,
        (select value from test_workout_revision)
    ) ->> 'unchanged',
    'true',
    'an identical revision-matched save is returned without another write'
);

select is(
    jsonb_array_length(public.dashboard_program_context(
        'e7000000-0000-4000-8000-000000000001'
    ) -> 'logs'),
    1,
    'the dashboard projection consolidates the current program log'
);

select is(
    jsonb_array_length(public.dashboard_program_context_v2(
        'e7000000-0000-4000-8000-000000000001'
    ) -> 'logs'),
    1,
    'the compact dashboard projection returns one latest log per session'
);

select is(
    public.dashboard_program_context_v2(
        'e7000000-0000-4000-8000-000000000001'
    ) #> '{logs,0,exercise_logs}',
    '[]'::jsonb,
    'the compact dashboard projection omits detailed exercise history'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_indexes
        where schemaname = 'public'
          and indexname = 'workout_logs_program_chronology_idx'
          and indexdef like '%(program_id, week_number, session_sequence, program_version DESC)%'
    ),
    'the workout chronology index matches the frequent read order'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_indexes
        where schemaname = 'public'
          and indexname = 'workout_logs_program_session_latest_idx'
          and indexdef like '%(program_id, session_id, program_version DESC)%'
    ),
    'the latest-session index supports version collapse without indexing mutable timestamps'
);

select ok(
    position(
        'pg_try_advisory_xact_lock' in pg_get_functiondef(
            'app_private.save_workout_log_v6_impl(uuid,integer,text,integer,integer,text,jsonb,jsonb,jsonb,integer,text,jsonb,jsonb,text)'::regprocedure
        )
    ) > 0,
    'the v6 implementation rejects concurrent saves without a lock queue'
);

select ok(
    position(
        'save_workout_log_v5' in pg_get_functiondef(
            'public.save_workout_log_v6(uuid,integer,text,integer,integer,text,jsonb,jsonb,jsonb,integer,text,jsonb,jsonb,text)'::regprocedure
        )
    ) = 0,
    'the public v6 wrapper is independent of the retired v5 function'
);

select * from finish();
rollback;
