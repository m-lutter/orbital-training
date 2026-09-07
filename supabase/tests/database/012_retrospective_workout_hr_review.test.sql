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
        'a1200000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'review-hr-a@example.test', '',
        now(), '{}'::jsonb, '{}'::jsonb, now(), now()
    ),
    (
        '00000000-0000-0000-8000-000000000000',
        'b1200000-0000-4000-8000-000000000002',
        'authenticated', 'authenticated', 'review-hr-b@example.test', '',
        now(), '{}'::jsonb, '{}'::jsonb, now(), now()
    );

insert into public.fitness_connections (
    id, user_id, provider, status, scopes, consent_version, last_synced_at
)
values
    (
        'a1210000-0000-4000-8000-000000000001',
        'a1200000-0000-4000-8000-000000000001',
        'google_health', 'active', array['fitness.read'], '1', now()
    ),
    (
        'b1210000-0000-4000-8000-000000000002',
        'b1200000-0000-4000-8000-000000000002',
        'google_health', 'active', array['fitness.read'], '1', now()
    );

insert into public.fitness_workout_summaries (
    connection_id, user_id, source_workout_id, workout_type,
    started_at, ended_at, average_heart_rate, maximum_heart_rate
)
values
    (
        'a1210000-0000-4000-8000-000000000001',
        'a1200000-0000-4000-8000-000000000001',
        'review-a', 'strength_training',
        '2026-08-25 15:00:00+00', '2026-08-25 16:00:00+00', 126, 158
    ),
    (
        'b1210000-0000-4000-8000-000000000002',
        'b1200000-0000-4000-8000-000000000002',
        'review-b', 'strength_training',
        '2026-08-25 15:00:00+00', '2026-08-25 16:00:00+00', 130, 165
    );

insert into public.fitness_hr_5m (
    connection_id, user_id, bucket_start, minimum_bpm, maximum_bpm,
    average_bpm, sample_count, source
)
values
    (
        'a1210000-0000-4000-8000-000000000001',
        'a1200000-0000-4000-8000-000000000001',
        '2026-08-25 15:00:00+00', 100, 145, 122, 20, 'provider'
    ),
    (
        'a1210000-0000-4000-8000-000000000001',
        'a1200000-0000-4000-8000-000000000001',
        '2026-08-25 16:05:00+00', 90, 110, 100, 20, 'provider'
    ),
    (
        'b1210000-0000-4000-8000-000000000002',
        'b1200000-0000-4000-8000-000000000002',
        '2026-08-25 15:00:00+00', 105, 150, 128, 20, 'provider'
    );

select has_index(
    'public',
    'fitness_hr_5m',
    'fitness_hr_5m_pkey',
    'review bucket reads use the connection-and-time primary-key index'
);

set local role authenticated;
select set_config(
    'request.jwt.claim.sub',
    'a1200000-0000-4000-8000-000000000001',
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
    (select count(*) from public.fitness_workout_summaries),
    1::bigint,
    'the review can read only its own provider workout summary'
);

select is(
    (
        select count(*)
        from public.fitness_hr_5m
        where connection_id = 'a1210000-0000-4000-8000-000000000001'
          and bucket_start >= '2026-08-25 15:00:00+00'::timestamptz
          and bucket_start < '2026-08-25 16:00:00+00'::timestamptz
    ),
    1::bigint,
    'a bounded workout interval excludes unrelated buckets'
);

select is(
    (select count(*) from public.fitness_hr_5m),
    2::bigint,
    'aggregate RLS excludes another user while preserving the owner history'
);

select ok(
    not has_table_privilege(
        'authenticated', 'public.fitness_hr_samples', 'SELECT'
    ),
    'the weekly review cannot read detailed heart-rate samples'
);

select * from finish();
rollback;
