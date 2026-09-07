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
        '31000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'persistence-a@example.test', '',
        now(), '{}'::jsonb, '{}'::jsonb, now(), now()
    ),
    (
        '00000000-0000-0000-0000-000000000000',
        '32000000-0000-4000-8000-000000000002',
        'authenticated', 'authenticated', 'persistence-b@example.test', '',
        now(), '{}'::jsonb, '{}'::jsonb, now(), now()
    );

insert into public.programs (id, user_id, name, payload)
values
    (
        'c1000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        'Atomic program A',
        jsonb_build_object(
            'schemaVersion', 3,
            'engineVersion', '0.11.0',
            'policyVersion', 'test-policy',
            'inputSnapshot', jsonb_build_object('owner', 'a'),
            'program', jsonb_build_object(
                'id', 'program-a',
                'version', 1,
                'inputFingerprint', 'fingerprint-a',
                'weeks', jsonb_build_array(
                    jsonb_build_object(
                        'weekNumber', 1,
                        'sessions', jsonb_build_array(
                            jsonb_build_object(
                                'id', 'session-a-1',
                                'sequence', 1,
                                'kind', 'lifting'
                            ),
                            jsonb_build_object(
                                'id', 'session-a-2',
                                'sequence', 2,
                                'kind', 'lifting'
                            ),
                            jsonb_build_object(
                                'id', 'movement-week-1',
                                'sequence', 3,
                                'kind', 'movement'
                            )
                        )
                    )
                )
            )
        )
    ),
    (
        'c2000000-0000-4000-8000-000000000002',
        '32000000-0000-4000-8000-000000000002',
        'Program B',
        jsonb_build_object(
            'schemaVersion', 3,
            'engineVersion', '0.11.0',
            'policyVersion', 'test-policy',
            'inputSnapshot', jsonb_build_object('owner', 'b'),
            'program', jsonb_build_object(
                'id', 'program-b',
                'version', 1,
                'inputFingerprint', 'fingerprint-b',
                'weeks', '[]'::jsonb
            )
        )
    );

insert into public.questionnaire_responses (
    id, user_id, program_id, version_number, questionnaire_version, response
)
values (
    'd1000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    1, 3, '{}'::jsonb
);

insert into public.program_versions (
    user_id, program_id, questionnaire_response_id, version_number,
    engine_version, policy_version, input_fingerprint, payload
)
select
    user_id,
    id,
    'd1000000-0000-4000-8000-000000000001',
    1,
    '0.11.0',
    'test-policy',
    'fingerprint-a',
    payload
from public.programs
where id = 'c1000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '31000000-0000-4000-8000-000000000001',
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
    $$ select public.create_program_with_initial_version(
        'Oversized program',
        3,
        '0.11.0',
        'test-policy',
        'oversized-fingerprint',
        '{}'::jsonb,
        jsonb_build_object(
            'schemaVersion', 3,
            'blob', repeat('x', 1050000)
        )
    ) $$,
    '22023',
    'program_payload_too_large',
    'oversized generated programs are rejected before insertion'
);

select throws_ok(
    $$ select public.save_workout_log(
        'c2000000-0000-4000-8000-000000000002',
        1, 'session-b', 1, 1, 'in_progress',
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        null, null, null
    ) $$,
    'P0002',
    'Program not found.',
    'a user cannot write a workout to another user program'
);

select throws_ok(
    $$ select public.save_workout_log(
        'c1000000-0000-4000-8000-000000000001',
        1, 'session-a-1', 1, 1, 'in_progress',
        jsonb_build_array(jsonb_build_object('blob', repeat('x', 132000))),
        '{}'::jsonb, '{}'::jsonb,
        null, null, null
    ) $$,
    '22023',
    'exercise_logs_too_large',
    'oversized exercise logs are rejected by the RPC'
);

select throws_ok(
    $$ select public.save_workout_log(
        'c1000000-0000-4000-8000-000000000001',
        1, 'session-a-2', 1, 2, 'completed',
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        30, null,
        jsonb_set(
            (select payload from public.programs
             where id = 'c1000000-0000-4000-8000-000000000001'),
            '{program,version}', '9'::jsonb
        )
    ) $$,
    '22023',
    'Invalid substituted program payload.',
    'an invalid substitution aborts the whole workout transaction'
);

select is(
    (
        select count(*) from public.workout_logs
        where program_id = 'c1000000-0000-4000-8000-000000000001'
          and session_id = 'session-a-2'
    ),
    0::bigint,
    'failed substitution leaves no partial workout row'
);

select lives_ok(
    $$ select public.save_workout_log(
        'c1000000-0000-4000-8000-000000000001',
        1, 'session-a-1', 1, 1, 'completed',
        jsonb_build_array(jsonb_build_object(
            'prescriptionId', 'p1',
            'sets', jsonb_build_array(jsonb_build_object(
                'setNumber', 1, 'reps', 5, 'completed', true
            ))
        )),
        '{}'::jsonb, '{}'::jsonb,
        40, null,
        jsonb_set(
            (select payload from public.programs
             where id = 'c1000000-0000-4000-8000-000000000001'),
            '{program,version}', '2'::jsonb
        )
    ) $$,
    'workout and permanent substitution commit together'
);

select is(
    (
        select (payload #>> '{program,version}')::integer
        from public.programs
        where id = 'c1000000-0000-4000-8000-000000000001'
    ),
    2,
    'the atomic write advances the current program version'
);

select is(
    (
        select count(*) from public.program_versions
        where program_id = 'c1000000-0000-4000-8000-000000000001'
          and version_number = 2
    ),
    1::bigint,
    'the atomic write records one immutable replacement version'
);

select is(
    (
        select count(*) from public.workout_logs
        where program_id = 'c1000000-0000-4000-8000-000000000001'
          and session_id = 'session-a-1'
          and program_version = 2
          and status = 'completed'
    ),
    1::bigint,
    'the atomic write records the completed workout'
);

select is(
    public.lunar_completion_is_unlocked(),
    false,
    'one completed session does not unlock a two-session program badge'
);

select lives_ok(
    $$ select public.save_workout_log(
        'c1000000-0000-4000-8000-000000000001',
        2, 'session-a-2', 1, 2, 'completed',
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        30, null, null
    ) $$,
    'the final planned workout can be completed'
);

select is(
    public.lunar_completion_is_unlocked(),
    true,
    'all planned workouts completed unlocks the lunar badge'
);

select * from finish();
rollback;
