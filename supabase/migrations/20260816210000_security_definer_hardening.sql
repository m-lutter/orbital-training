-- Harden SECURITY DEFINER functions reported by the Supabase Security Advisor.
--
-- Trigger functions must never be callable through the Data API. Application
-- RPCs still need elevated, transactional implementations because ordinary
-- authenticated users intentionally cannot write immutable program history
-- directly. Their public entry points are therefore SECURITY INVOKER wrappers;
-- the SECURITY DEFINER implementations live in a schema that is not exposed by
-- PostgREST.

create schema if not exists app_private;

revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

-- Trigger-only functions continue to run through their existing triggers.
-- PostgreSQL does not require API roles to retain direct EXECUTE access for an
-- already-created trigger to invoke its trigger function.
revoke all on function public.handle_new_user()
from public, anon, authenticated, service_role;

revoke all on function public.protect_reviewed_workout_log()
from public, anon, authenticated, service_role;

-- rls_auto_enable is an optional event-trigger helper recommended by Supabase.
-- It is not present in every environment, so revoke access only when it exists.
do $$
begin
    if to_regprocedure('public.rls_auto_enable()') is not null then
        execute
            'revoke all on function public.rls_auto_enable() '
            'from public, anon, authenticated, service_role';
    end if;
end;
$$;

-- Move the privileged implementations out of the exposed public schema.
alter function public.create_program_with_initial_version(
    text, integer, text, text, text, jsonb, jsonb
) set schema app_private;
alter function app_private.create_program_with_initial_version(
    text, integer, text, text, text, jsonb, jsonb
) rename to create_program_with_initial_version_impl;

alter function public.replace_program_from_questionnaire(
    uuid, text, integer, text, text, text, jsonb, jsonb
) set schema app_private;
alter function app_private.replace_program_from_questionnaire(
    uuid, text, integer, text, text, text, jsonb, jsonb
) rename to replace_program_from_questionnaire_impl;

alter function public.record_program_substitution(uuid, integer, jsonb)
set schema app_private;
alter function app_private.record_program_substitution(uuid, integer, jsonb)
rename to record_program_substitution_impl;

alter function public.record_weekly_review(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb
) set schema app_private;
alter function app_private.record_weekly_review(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb
) rename to record_weekly_review_impl;

-- Remove privileges retained from the former public functions, then grant only
-- the access needed by the authenticated SECURITY INVOKER wrappers below.
revoke all on function app_private.create_program_with_initial_version_impl(
    text, integer, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function app_private.create_program_with_initial_version_impl(
    text, integer, text, text, text, jsonb, jsonb
) to authenticated;

revoke all on function app_private.replace_program_from_questionnaire_impl(
    uuid, text, integer, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function app_private.replace_program_from_questionnaire_impl(
    uuid, text, integer, text, text, text, jsonb, jsonb
) to authenticated;

revoke all on function app_private.record_program_substitution_impl(
    uuid, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function app_private.record_program_substitution_impl(
    uuid, integer, jsonb
) to authenticated;

revoke all on function app_private.record_weekly_review_impl(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function app_private.record_weekly_review_impl(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb
) to authenticated;

-- Public RPC wrappers preserve the API used by supabase-js without possessing
-- owner privileges themselves. Authentication and ownership are also checked
-- again inside every private implementation.
create function public.create_program_with_initial_version(
    p_name text,
    p_questionnaire_version integer,
    p_engine_version text,
    p_policy_version text,
    p_input_fingerprint text,
    p_questionnaire jsonb,
    p_payload jsonb
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.create_program_with_initial_version_impl(
        p_name,
        p_questionnaire_version,
        p_engine_version,
        p_policy_version,
        p_input_fingerprint,
        p_questionnaire,
        p_payload
    );
$$;

create function public.replace_program_from_questionnaire(
    p_program_id uuid,
    p_name text,
    p_questionnaire_version integer,
    p_engine_version text,
    p_policy_version text,
    p_input_fingerprint text,
    p_questionnaire jsonb,
    p_payload jsonb
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.replace_program_from_questionnaire_impl(
        p_program_id,
        p_name,
        p_questionnaire_version,
        p_engine_version,
        p_policy_version,
        p_input_fingerprint,
        p_questionnaire,
        p_payload
    );
$$;

create function public.record_program_substitution(
    p_program_id uuid,
    p_source_program_version integer,
    p_new_payload jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.record_program_substitution_impl(
        p_program_id,
        p_source_program_version,
        p_new_payload
    );
$$;

create function public.record_weekly_review(
    p_program_id uuid,
    p_source_program_version integer,
    p_week_number integer,
    p_decision text,
    p_state text,
    p_confidence text,
    p_metrics jsonb,
    p_result jsonb,
    p_new_payload jsonb default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.record_weekly_review_impl(
        p_program_id,
        p_source_program_version,
        p_week_number,
        p_decision,
        p_state,
        p_confidence,
        p_metrics,
        p_result,
        p_new_payload
    );
$$;

-- Supabase can apply explicit default grants to new public functions. Revoke
-- every API role first, then opt the authenticated role back in deliberately.
revoke all on function public.create_program_with_initial_version(
    text, integer, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_program_with_initial_version(
    text, integer, text, text, text, jsonb, jsonb
) to authenticated;

revoke all on function public.replace_program_from_questionnaire(
    uuid, text, integer, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_program_from_questionnaire(
    uuid, text, integer, text, text, text, jsonb, jsonb
) to authenticated;

revoke all on function public.record_program_substitution(uuid, integer, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.record_program_substitution(uuid, integer, jsonb)
to authenticated;

revoke all on function public.record_weekly_review(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.record_weekly_review(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb
) to authenticated;

notify pgrst, 'reload schema';
