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
    '41000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'history-a@example.test', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

create temporary table phase4_program_ids (
    compact_id uuid,
    legacy_id uuid
);

grant select, insert, update on phase4_program_ids to authenticated;

create function public.test_phase4_payload(p_version integer)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
    select jsonb_build_object(
        'schemaVersion', 3,
        'questionnaireVersion', 3,
        'engineVersion', '0.11.0',
        'policyVersion', 'phase4-test-policy',
        'inputSnapshot', jsonb_build_object('owner', 'history-a'),
        'program', jsonb_build_object(
            'id', 'phase4-program',
            'version', p_version,
            'inputFingerprint', 'phase4-fingerprint',
            'weeks', jsonb_build_array(
                jsonb_build_object(
                    'weekNumber', 1,
                    'sessions', jsonb_build_array(
                        jsonb_build_object(
                            'id', 'history-session-1',
                            'sequence', 1,
                            'kind', 'lifting'
                        ),
                        jsonb_build_object(
                            'id', 'history-session-2',
                            'sequence', 2,
                            'kind', 'lifting'
                        )
                    )
                )
            )
        )
    );
$$;

grant execute on function public.test_phase4_payload(integer)
to authenticated;

set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    '41000000-0000-4000-8000-000000000001',
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into phase4_program_ids (compact_id)
values (public.create_program_with_initial_version_v4(
    'Compact history program',
    3,
    '0.11.0',
    'phase4-test-policy',
    'phase4-fingerprint',
    '{}'::jsonb,
    public.test_phase4_payload(1)
));

select is(
    (
        select storage_format
        from public.program_versions
        where program_id = (select compact_id from phase4_program_ids)
          and version_number = 1
    ),
    'current_anchor_v1',
    'new compact programs store an anchor instead of a duplicate payload'
);

select is(
    (
        select payload
        from public.program_versions
        where program_id = (select compact_id from phase4_program_ids)
          and version_number = 1
    ),
    null::jsonb,
    'the current history anchor has no full payload copy'
);

select is(
    (
        select version_row.payload_hash
        from public.program_versions version_row
        join public.programs program_row on program_row.id = version_row.program_id
        where version_row.program_id =
              (select compact_id from phase4_program_ids)
          and version_row.version_number = 1
    ),
    (
        select md5(payload::text)
        from public.programs
        where id = (select compact_id from phase4_program_ids)
    ),
    'the current anchor fingerprints the full live payload'
);

select lives_ok(
    $$ select public.save_workout_log_v4(
        (select compact_id from phase4_program_ids),
        1, 'history-session-1', 1, 1, 'completed',
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        30, null,
        public.test_phase4_payload(2),
        '[[0,["program","version"],1]]'::jsonb
    ) $$,
    'a compact substitution stores atomically with its workout'
);

select results_eq(
    $$
        select version_number, storage_format, payload is null
        from public.program_versions
        where program_id = (select compact_id from phase4_program_ids)
        order by version_number
    $$,
    $$ values
        (1, 'reverse_patch_v1'::text, true),
        (2, 'current_anchor_v1'::text, true)
    $$,
    'the outgoing version becomes a reverse patch and the result an anchor'
);

select is(
    (
        select reverse_patch
        from public.program_versions
        where program_id = (select compact_id from phase4_program_ids)
          and version_number = 1
    ),
    '[[0,["program","version"],1]]'::jsonb,
    'the reverse patch remains available to reconstruct version one'
);

-- Simulate an older deployed application after the migration. It knows only
-- the original RPC and therefore cannot send a reverse patch.
select lives_ok(
    $$ select public.save_workout_log(
        (select compact_id from phase4_program_ids),
        2, 'history-session-2', 1, 2, 'completed',
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        30, null, public.test_phase4_payload(3)
    ) $$,
    'the legacy workout RPC remains safe after compact-history migration'
);

select results_eq(
    $$
        select version_number, storage_format, payload is not null
        from public.program_versions
        where program_id = (select compact_id from phase4_program_ids)
          and version_number in (2, 3)
        order by version_number
    $$,
    $$ values
        (2, 'full_v3'::text, true),
        (3, 'full_v3'::text, true)
    $$,
    'an older client retains recoverable full source and current versions'
);

select lives_ok(
    $$ select public.save_workout_log_v4(
        (select compact_id from phase4_program_ids),
        3, 'history-session-1', 1, 1, 'completed',
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        30, null, public.test_phase4_payload(4),
        '[[0,["program","version"],3]]'::jsonb
    ) $$,
    'a compact client resumes a history created by an older client'
);

select results_eq(
    $$
        select version_number, storage_format
        from public.program_versions
        where program_id = (select compact_id from phase4_program_ids)
          and version_number in (2, 3, 4)
        order by version_number
    $$,
    $$ values
        (2, 'full_v3'::text),
        (3, 'reverse_patch_v1'::text),
        (4, 'current_anchor_v1'::text)
    $$,
    'mixed full and reverse-patch history remains well formed'
);

-- Null patch is the intentional fallback when a patch would not be compact.
select lives_ok(
    $$ select public.save_workout_log_v4(
        (select compact_id from phase4_program_ids),
        4, 'history-session-2', 1, 2, 'completed',
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        30, null, public.test_phase4_payload(5), null
    ) $$,
    'the full-snapshot fallback preserves a save with no compact patch'
);

select is(
    (
        select storage_format
        from public.program_versions
        where program_id = (select compact_id from phase4_program_ids)
          and version_number = 4
    ),
    'full_v3',
    'the fallback retains exactly one recoverable outgoing full snapshot'
);

select throws_ok(
    $$ select public.save_workout_log_v4(
        (select compact_id from phase4_program_ids),
        5, 'history-session-1', 1, 1, 'completed',
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        30, null, public.test_phase4_payload(6), '{}'::jsonb
    ) $$,
    '22023',
    'invalid_or_oversized_program_reverse_patch',
    'malformed history is rejected before any workout or version is written'
);

select is(
    (
        select (payload #>> '{program,version}')::integer
        from public.programs
        where id = (select compact_id from phase4_program_ids)
    ),
    5,
    'a rejected patch leaves the current program unchanged'
);

select lives_ok(
    $$ select public.record_weekly_review_v4(
        (select compact_id from phase4_program_ids),
        5, 1, 'applied', 'on_track', 'high',
        '{}'::jsonb, '{}'::jsonb,
        public.test_phase4_payload(6),
        '[[0,["program","version"],5]]'::jsonb
    ) $$,
    'weekly adaptation uses the same compact transition contract'
);

select results_eq(
    $$
        select version_number, storage_format
        from public.program_versions
        where program_id = (select compact_id from phase4_program_ids)
          and version_number in (5, 6)
        order by version_number
    $$,
    $$ values
        (5, 'reverse_patch_v1'::text),
        (6, 'current_anchor_v1'::text)
    $$,
    'weekly adaptation archives its source and anchors its result'
);

select lives_ok(
    $$ select public.replace_program_from_questionnaire_v4(
        (select compact_id from phase4_program_ids),
        'Rebuilt compact program',
        3,
        '0.11.0',
        'phase4-test-policy',
        'phase4-fingerprint',
        '{}'::jsonb,
        public.test_phase4_payload(1)
    ) $$,
    'questionnaire rebuild returns a compact version-one anchor'
);

select results_eq(
    $$
        select version_number, storage_format, payload is null
        from public.program_versions
        where program_id = (select compact_id from phase4_program_ids)
    $$,
    $$ values (1, 'current_anchor_v1'::text, true) $$,
    'rebuild removes obsolete history and avoids a new duplicate payload'
);

select is(
    (
        select count(*)
        from public.workout_logs
        where program_id = (select compact_id from phase4_program_ids)
    ) + (
        select count(*)
        from public.weekly_reviews
        where program_id = (select compact_id from phase4_program_ids)
    ),
    0::bigint,
    'rebuild still clears progress and review history atomically'
);

update phase4_program_ids
set legacy_id = public.create_program_with_initial_version(
    'Legacy create program',
    3,
    '0.11.0',
    'phase4-test-policy',
    'phase4-fingerprint',
    '{}'::jsonb,
    public.test_phase4_payload(1)
);

select results_eq(
    $$
        select storage_format, payload is not null
        from public.program_versions
        where program_id = (
            select legacy_id from phase4_program_ids where legacy_id is not null
        )
    $$,
    $$ values ('full_v3'::text, true) $$,
    'the pre-migration create RPC remains deploy-order compatible'
);

select is(
    public.questionnaire_engine_status() ->> 'compactHistoryVersion',
    '1',
    'readiness reports the compact history contract'
);

select * from finish();
rollback;
