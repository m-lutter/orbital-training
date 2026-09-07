begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Every user-owned table must have RLS before it is reachable through the API.
with expected(table_name) as (
    values
        ('profiles'),
        ('programs'),
        ('questionnaire_responses'),
        ('program_versions'),
        ('workout_logs'),
        ('weekly_reviews'),
        ('feedback_reports')
)
select ok(
    coalesce((
        select c.relrowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = expected.table_name
    ), false),
    format('RLS is enabled on public.%I', expected.table_name)
)
from expected;

with expected(table_name) as (
    values
        ('profiles'),
        ('programs'),
        ('questionnaire_responses'),
        ('program_versions'),
        ('workout_logs'),
        ('weekly_reviews')
)
select ok(
    exists (
        select 1
        from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = expected.table_name
          and 'authenticated' = any (p.roles)
    ),
    format('public.%I has an authenticated RLS policy', expected.table_name)
)
from expected;

-- Public RPCs remain invoker-rights entry points. The elevated implementation
-- stays in app_private with a fixed search_path and no anonymous execution.
with wrappers(function_oid, label) as (
    values
      ('public.create_program_with_initial_version(text,integer,text,text,text,jsonb,jsonb)'::regprocedure::oid, 'create program'),
      ('public.replace_program_from_questionnaire(uuid,text,integer,text,text,text,jsonb,jsonb)'::regprocedure::oid, 'replace program'),
      ('public.record_program_substitution(uuid,integer,jsonb)'::regprocedure::oid, 'record substitution'),
      ('public.save_workout_log(uuid,integer,text,integer,integer,text,jsonb,jsonb,jsonb,integer,text,jsonb)'::regprocedure::oid, 'save workout'),
      ('public.record_weekly_review(uuid,integer,integer,text,text,text,jsonb,jsonb,jsonb)'::regprocedure::oid, 'record weekly review'),
      ('public.submit_feedback(text,text,boolean,boolean,text,uuid,text,jsonb)'::regprocedure::oid, 'submit feedback')
)
select ok(not p.prosecdef, wrappers.label || ' wrapper is SECURITY INVOKER')
from wrappers
join pg_proc p on p.oid = wrappers.function_oid;

with wrappers(function_oid, label) as (
    values
      ('public.create_program_with_initial_version(text,integer,text,text,text,jsonb,jsonb)'::regprocedure::oid, 'create program'),
      ('public.replace_program_from_questionnaire(uuid,text,integer,text,text,text,jsonb,jsonb)'::regprocedure::oid, 'replace program'),
      ('public.save_workout_log(uuid,integer,text,integer,integer,text,jsonb,jsonb,jsonb,integer,text,jsonb)'::regprocedure::oid, 'save workout'),
      ('public.record_weekly_review(uuid,integer,integer,text,text,text,jsonb,jsonb,jsonb)'::regprocedure::oid, 'record weekly review')
)
select ok(
    has_function_privilege('authenticated', wrappers.function_oid, 'EXECUTE')
    and not has_function_privilege('anon', wrappers.function_oid, 'EXECUTE'),
    wrappers.label || ' wrapper is authenticated-only'
)
from wrappers;

with wrappers(function_oid, label) as (
    values
      ('public.create_program_with_initial_version_v4(text,integer,text,text,text,jsonb,jsonb)'::regprocedure::oid, 'compact create program'),
      ('public.replace_program_from_questionnaire_v4(uuid,text,integer,text,text,text,jsonb,jsonb)'::regprocedure::oid, 'compact replace program'),
      ('public.save_workout_log_v4(uuid,integer,text,integer,integer,text,jsonb,jsonb,jsonb,integer,text,jsonb,jsonb)'::regprocedure::oid, 'compact save workout'),
      ('public.record_weekly_review_v4(uuid,integer,integer,text,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure::oid, 'compact weekly review'),
      ('public.save_workout_log_v6(uuid,integer,text,integer,integer,text,jsonb,jsonb,jsonb,integer,text,jsonb,jsonb,text)'::regprocedure::oid, 'single-flight workout save'),
      ('public.workout_session_context(uuid,text)'::regprocedure::oid, 'workout session projection'),
      ('public.dashboard_program_context(uuid)'::regprocedure::oid, 'dashboard program projection'),
      ('public.dashboard_program_context_v2(uuid)'::regprocedure::oid, 'compact dashboard program projection')
)
select ok(
    not p.prosecdef
    and has_function_privilege('authenticated', wrappers.function_oid, 'EXECUTE')
    and not has_function_privilege('anon', wrappers.function_oid, 'EXECUTE'),
    wrappers.label || ' is an authenticated SECURITY INVOKER wrapper'
)
from wrappers
join pg_proc p on p.oid = wrappers.function_oid;

select ok(
    not has_function_privilege(
        'authenticated',
        'public.save_workout_log_v5(uuid,integer,text,integer,integer,text,jsonb,jsonb,jsonb,integer,text,jsonb,jsonb,text)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'anon',
        'public.save_workout_log_v5(uuid,integer,text,integer,integer,text,jsonb,jsonb,jsonb,integer,text,jsonb,jsonb,text)',
        'EXECUTE'
    ),
    'the blocking v5 workout save is retired from the client API'
);

with implementations(function_oid, label) as (
    values
      ('app_private.create_program_with_initial_version_impl(text,integer,text,text,text,jsonb,jsonb)'::regprocedure::oid, 'create program implementation'),
      ('app_private.replace_program_from_questionnaire_impl(uuid,text,integer,text,text,text,jsonb,jsonb)'::regprocedure::oid, 'replace program implementation'),
      ('app_private.record_program_substitution_impl(uuid,integer,jsonb)'::regprocedure::oid, 'record substitution implementation'),
      ('app_private.save_workout_log_impl(uuid,integer,text,integer,integer,text,jsonb,jsonb,jsonb,integer,text,jsonb)'::regprocedure::oid, 'save workout implementation'),
      ('app_private.record_weekly_review_impl(uuid,integer,integer,text,text,text,jsonb,jsonb,jsonb)'::regprocedure::oid, 'record weekly review implementation')
)
select ok(
    p.prosecdef
    and array_to_string(coalesce(p.proconfig, array[]::text[]), ',') like '%search_path=%'
    and not has_function_privilege('anon', implementations.function_oid, 'EXECUTE'),
    implementations.label || ' is hardened in app_private'
)
from implementations
join pg_proc p on p.oid = implementations.function_oid;

with implementations(function_oid, label) as (
    values
      ('app_private.create_program_with_initial_version_v4_impl(text,integer,text,text,text,jsonb,jsonb)'::regprocedure::oid, 'compact create implementation'),
      ('app_private.replace_program_from_questionnaire_v4_impl(uuid,text,integer,text,text,text,jsonb,jsonb)'::regprocedure::oid, 'compact replace implementation'),
      ('app_private.save_workout_log_v4_impl(uuid,integer,text,integer,integer,text,jsonb,jsonb,jsonb,integer,text,jsonb,jsonb)'::regprocedure::oid, 'compact workout implementation'),
      ('app_private.record_weekly_review_v4_impl(uuid,integer,integer,text,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure::oid, 'compact review implementation'),
      ('app_private.save_workout_log_v6_impl(uuid,integer,text,integer,integer,text,jsonb,jsonb,jsonb,integer,text,jsonb,jsonb,text)'::regprocedure::oid, 'single-flight workout implementation'),
      ('app_private.submit_feedback_impl(text,text,boolean,boolean,text,uuid,text,jsonb)'::regprocedure::oid, 'submit feedback implementation')
)
select ok(
    p.prosecdef
    and array_to_string(coalesce(p.proconfig, array[]::text[]), ',') like '%search_path=%'
    and not has_function_privilege('anon', implementations.function_oid, 'EXECUTE'),
    implementations.label || ' is hardened in app_private'
)
from implementations
join pg_proc p on p.oid = implementations.function_oid;

select ok(
    not has_table_privilege('anon', 'public.programs', 'SELECT'),
    'anonymous users cannot read programs'
);
select ok(
    not has_table_privilege('authenticated', 'public.programs', 'INSERT')
    and not has_table_privilege('authenticated', 'public.programs', 'UPDATE'),
    'authenticated users cannot bypass versioned program RPCs'
);
select ok(
    has_table_privilege('authenticated', 'public.workout_logs', 'SELECT')
    and not has_table_privilege('authenticated', 'public.workout_logs', 'INSERT')
    and not has_table_privilege('authenticated', 'public.workout_logs', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.workout_logs', 'DELETE'),
    'workout logs are readable but all client writes are RPC-only'
);
select ok(
    not has_function_privilege(
        'authenticated',
        'public.record_program_substitution(uuid,integer,jsonb)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated',
        'app_private.record_program_substitution_impl(uuid,integer,jsonb)',
        'EXECUTE'
    ),
    'permanent substitutions cannot bypass the atomic workout RPC'
);
select ok(
    not has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
    and not has_function_privilege(
        'authenticated',
        'public.protect_reviewed_workout_log()',
        'EXECUTE'
    ),
    'trigger-only functions are not API-callable'
);

select ok(
    has_function_privilege(
        'authenticated',
        'public.submit_feedback(text,text,boolean,boolean,text,uuid,text,jsonb)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'anon',
        'public.submit_feedback(text,text,boolean,boolean,text,uuid,text,jsonb)',
        'EXECUTE'
    )
    and not has_table_privilege(
        'authenticated', 'public.feedback_reports', 'INSERT'
    )
    and not has_table_privilege(
        'authenticated', 'public.feedback_reports', 'SELECT'
    ),
    'feedback is authenticated, RPC-only, and not client-readable'
);

select ok(
    exists (
        select 1
        from pg_policies as policy
        where policy.schemaname = 'public'
          and policy.tablename = 'feedback_reports'
          and policy.policyname = 'feedback_reports_deny_direct_access'
          and policy.cmd = 'ALL'
          and 'anon' = any (policy.roles)
          and 'authenticated' = any (policy.roles)
          and policy.qual = 'false'
          and policy.with_check = 'false'
    ),
    'feedback reports have an explicit deny-all client policy'
);

select ok(
    not (
        select p.prosecdef
        from pg_proc p
        where p.oid = 'public.lunar_completion_is_unlocked()'::regprocedure
    )
    and has_function_privilege(
        'authenticated',
        'public.lunar_completion_is_unlocked()',
        'EXECUTE'
    )
    and not has_function_privilege(
        'anon',
        'public.lunar_completion_is_unlocked()',
        'EXECUTE'
    ),
    'completion-badge entitlement is an authenticated invoker-rights read'
);

with wrappers(function_oid, label) as (
    values
      ('public.export_my_feedback()'::regprocedure::oid, 'account feedback export'),
      ('public.delete_my_account()'::regprocedure::oid, 'account deletion')
)
select ok(
    not p.prosecdef
    and has_function_privilege(
        'authenticated', wrappers.function_oid, 'EXECUTE'
    )
    and not has_function_privilege('anon', wrappers.function_oid, 'EXECUTE'),
    wrappers.label || ' is an authenticated SECURITY INVOKER wrapper'
)
from wrappers
join pg_proc p on p.oid = wrappers.function_oid;

with implementations(function_oid, label) as (
    values
      ('app_private.export_my_feedback_impl()'::regprocedure::oid, 'account feedback export implementation'),
      ('app_private.delete_my_account_impl()'::regprocedure::oid, 'account deletion implementation')
)
select ok(
    p.prosecdef
    and array_to_string(coalesce(p.proconfig, array[]::text[]), ',')
        like '%search_path=%'
    and not has_function_privilege(
        'anon', implementations.function_oid, 'EXECUTE'
    ),
    implementations.label || ' is hardened in app_private'
)
from implementations
join pg_proc p on p.oid = implementations.function_oid;

select ok(
    position(
        'pg_advisory_xact_lock' in pg_get_functiondef(
            'app_private.submit_feedback_impl(text,text,boolean,boolean,text,uuid,text,jsonb)'::regprocedure
        )
    ) > 0,
    'feedback rate and duplicate checks are serialized per authenticated user'
);

select ok(
    exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'workout_logs'
          and column_name = 'movement_log'
          and data_type = 'jsonb'
    ),
    'workout logs include the bounded movement check-in object'
);

with expected(constraint_name) as (
    values
      ('programs_payload_size_check'),
      ('questionnaire_responses_response_size_check'),
      ('program_versions_payload_size_check'),
      ('workout_logs_exercise_logs_size_check'),
      ('workout_logs_cardio_log_size_check'),
      ('weekly_reviews_metrics_size_check'),
      ('weekly_reviews_result_size_check')
)
select ok(
    exists (
        select 1 from pg_constraint
        where conname = expected.constraint_name and convalidated
    ),
    expected.constraint_name || ' is present and validated'
)
from expected;

with expected(constraint_name) as (
    values
      ('program_versions_storage_format_check'),
      ('program_versions_storage_shape_check'),
      ('program_versions_payload_hash_check'),
      ('program_versions_reverse_patch_size_check')
)
select ok(
    exists (
        select 1 from pg_constraint
        where conname = expected.constraint_name and convalidated
    ),
    expected.constraint_name || ' is present and validated'
)
from expected;

select * from finish();
rollback;
