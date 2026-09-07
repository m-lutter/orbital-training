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
    '81000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'single-flight@example.test', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.programs (id, user_id, name, payload)
values (
    'e8000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'Single-flight program',
    jsonb_build_object(
        'schemaVersion', 3,
        'engineVersion', 'test-engine',
        'policyVersion', 'test-policy',
        'inputSnapshot', jsonb_build_object('owner', 'single-flight'),
        'program', jsonb_build_object(
            'id', 'single-flight-program',
            'version', 1,
            'inputFingerprint', 'single-flight-fingerprint',
            'weeks', jsonb_build_array(jsonb_build_object(
                'weekNumber', 1,
                'sessions', jsonb_build_array(jsonb_build_object(
                    'id', 'single-flight-session',
                    'weekNumber', 1,
                    'sequence', 1,
                    'kind', 'lifting',
                    'exercises', '[]'::jsonb
                ))
            ))
        )
    )
);

insert into public.questionnaire_responses (
    id, user_id, program_id, version_number, questionnaire_version, response
)
values (
    'd8000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'e8000000-0000-4000-8000-000000000001',
    1, 3, '{}'::jsonb
);

insert into public.program_versions (
    user_id, program_id, questionnaire_response_id, version_number,
    engine_version, policy_version, input_fingerprint, payload
)
select
    user_id,
    id,
    'd8000000-0000-4000-8000-000000000001',
    1,
    'test-engine',
    'test-policy',
    'single-flight-fingerprint',
    payload
from public.programs
where id = 'e8000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '81000000-0000-4000-8000-000000000001',
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table single_flight_results (
    label text primary key,
    value jsonb not null
);
create temporary table single_flight_payload (value jsonb not null);

insert into single_flight_results (label, value)
values (
    'source-save',
    public.save_workout_log_v6(
        'e8000000-0000-4000-8000-000000000001',
        1, 'single-flight-session', 1, 1, 'in_progress',
        jsonb_build_array(jsonb_build_object(
            'prescriptionId', 'p1',
            'exerciseId', 'replacement-exercise'
        )),
        '{}'::jsonb, '{}'::jsonb,
        45, null, null, null, 'new'
    )
);

insert into single_flight_payload (value)
select jsonb_set(payload, '{program,version}', '2'::jsonb)
from public.programs
where id = 'e8000000-0000-4000-8000-000000000001';

insert into single_flight_results (label, value)
select
    'permanent-save',
    public.save_workout_log_v6(
        'e8000000-0000-4000-8000-000000000001',
        1, 'single-flight-session', 1, 1, 'in_progress',
        jsonb_build_array(jsonb_build_object(
            'prescriptionId', 'p1',
            'exerciseId', 'replacement-exercise'
        )),
        '{}'::jsonb, '{}'::jsonb,
        45, null, payload.value, null,
        (select value ->> 'updatedAt'
         from single_flight_results where label = 'source-save')
    )
from single_flight_payload as payload;

select is(
    (select value ->> 'ok'
     from single_flight_results where label = 'permanent-save'),
    'true',
    'a permanent substitution and its workout save atomically'
);

select is(
    (select value ->> 'programVersion'
     from single_flight_results where label = 'permanent-save'),
    '2',
    'the permanent substitution advances exactly one program version'
);

insert into single_flight_results (label, value)
select
    'permanent-replay',
    public.save_workout_log_v6(
        'e8000000-0000-4000-8000-000000000001',
        1, 'single-flight-session', 1, 1, 'in_progress',
        jsonb_build_array(jsonb_build_object(
            'prescriptionId', 'p1',
            'exerciseId', 'replacement-exercise'
        )),
        '{}'::jsonb, '{}'::jsonb,
        45, null, payload.value, null,
        (select value ->> 'updatedAt'
         from single_flight_results where label = 'source-save')
    )
from single_flight_payload as payload;

select is(
    (select value ->> 'duplicate'
     from single_flight_results where label = 'permanent-replay'),
    'true',
    'an exact permanent-substitution replay is an idempotent success'
);

select is(
    (
        select count(*)
        from public.program_versions
        where program_id = 'e8000000-0000-4000-8000-000000000001'
          and version_number = 2
    ),
    1::bigint,
    'an exact replay does not create another immutable program version'
);

select is(
    (
        select count(*)
        from public.workout_logs
        where program_id = 'e8000000-0000-4000-8000-000000000001'
          and program_version = 2
          and session_id = 'single-flight-session'
    ),
    1::bigint,
    'an exact replay does not create another result-version workout'
);

insert into single_flight_results (label, value)
select
    'differing-stale-replay',
    public.save_workout_log_v6(
        'e8000000-0000-4000-8000-000000000001',
        1, 'single-flight-session', 1, 1, 'completed',
        jsonb_build_array(jsonb_build_object(
            'prescriptionId', 'p1',
            'exerciseId', 'replacement-exercise'
        )),
        '{}'::jsonb, '{}'::jsonb,
        45, null, payload.value, null,
        (select value ->> 'updatedAt'
         from single_flight_results where label = 'source-save')
    )
from single_flight_payload as payload;

select is(
    (select value ->> 'conflict'
     from single_flight_results where label = 'differing-stale-replay'),
    'program_revision',
    'a stale differing post-substitution save returns a structured conflict'
);

select is(
    (
        select (payload #>> '{program,version}')::integer
        from public.programs
        where id = 'e8000000-0000-4000-8000-000000000001'
    ),
    2,
    'the differing stale request cannot create program version three'
);

select is(
    (
        select status
        from public.workout_logs
        where program_id = 'e8000000-0000-4000-8000-000000000001'
          and program_version = 2
          and session_id = 'single-flight-session'
    ),
    'in_progress',
    'the differing stale request cannot overwrite the saved workout'
);

insert into single_flight_results (label, value)
select
    'reloaded-completion',
    public.save_workout_log_v6(
        'e8000000-0000-4000-8000-000000000001',
        2, 'single-flight-session', 1, 1, 'completed',
        jsonb_build_array(jsonb_build_object(
            'prescriptionId', 'p1',
            'exerciseId', 'replacement-exercise'
        )),
        '{}'::jsonb, '{}'::jsonb,
        45, null, null, null,
        (select value ->> 'updatedAt'
         from single_flight_results where label = 'permanent-save')
    );

select is(
    (select value ->> 'ok'
     from single_flight_results where label = 'reloaded-completion'),
    'true',
    'a completion using the result version and revision saves normally'
);

select is(
    (
        select status
        from public.workout_logs
        where program_id = 'e8000000-0000-4000-8000-000000000001'
          and program_version = 2
          and session_id = 'single-flight-session'
    ),
    'completed',
    'the reloaded completion updates the one result-version workout'
);

select is(
    (
        select count(*)
        from public.program_versions
        where program_id = 'e8000000-0000-4000-8000-000000000001'
          and version_number > 2
    ),
    0::bigint,
    'the complete sequence never creates an unintended later version'
);

with bounded_functions(function_oid, expected_timeout, label) as (
    values
      (
        'public.workout_session_context(uuid,text)'::regprocedure::oid,
        array['statement_timeout=5s']::text[],
        'workout context'
      ),
      (
        'public.save_workout_log_v6(uuid,integer,text,integer,integer,text,jsonb,jsonb,jsonb,integer,text,jsonb,jsonb,text)'::regprocedure::oid,
        array['statement_timeout=5s', 'lock_timeout=1s']::text[],
        'workout save wrapper'
      ),
      (
        'app_private.save_workout_log_v6_impl(uuid,integer,text,integer,integer,text,jsonb,jsonb,jsonb,integer,text,jsonb,jsonb,text)'::regprocedure::oid,
        array['statement_timeout=5s', 'lock_timeout=1s']::text[],
        'workout save implementation'
      )
)
select ok(
    coalesce(procedure.proconfig, array[]::text[]) @> bounded_functions.expected_timeout,
    bounded_functions.label || ' has bounded statement/lock lifetime'
)
from bounded_functions
join pg_catalog.pg_proc as procedure
  on procedure.oid = bounded_functions.function_oid;

select * from finish();
rollback;
