-- Questionnaire v3 adds clearer input semantics while preserving existing
-- questionnaire v2 snapshots. This migration also exposes a read-only health
-- check so the app can distinguish a missing migration from a failed save.

create or replace function public.create_program_with_initial_version(
    p_name text,
    p_questionnaire_version integer,
    p_engine_version text,
    p_policy_version text,
    p_input_fingerprint text,
    p_questionnaire jsonb,
    p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_program_id uuid;
    v_response_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;

    if p_name is null
       or char_length(btrim(p_name)) < 1
       or char_length(btrim(p_name)) > 100 then
        raise exception 'Program name must contain 1 to 100 characters.' using errcode = '22023';
    end if;

    if p_questionnaire_version not in (2, 3) then
        raise exception 'Unsupported questionnaire version.' using errcode = '22023';
    end if;

    if jsonb_typeof(p_questionnaire) <> 'object'
       or jsonb_typeof(p_payload) <> 'object'
       or p_payload ->> 'schemaVersion' <> '3' then
        raise exception 'Invalid questionnaire or program payload.' using errcode = '22023';
    end if;

    if coalesce(char_length(p_engine_version), 0) < 1
       or coalesce(char_length(p_policy_version), 0) < 1
       or coalesce(char_length(p_input_fingerprint), 0) < 1 then
        raise exception 'Version metadata is required.' using errcode = '22023';
    end if;

    insert into public.programs (user_id, name, payload)
    values (v_user_id, btrim(p_name), p_payload)
    returning id into v_program_id;

    insert into public.questionnaire_responses (
        user_id,
        program_id,
        version_number,
        questionnaire_version,
        response
    )
    values (
        v_user_id,
        v_program_id,
        1,
        p_questionnaire_version,
        p_questionnaire
    )
    returning id into v_response_id;

    insert into public.program_versions (
        user_id,
        program_id,
        questionnaire_response_id,
        version_number,
        engine_version,
        policy_version,
        input_fingerprint,
        payload
    )
    values (
        v_user_id,
        v_program_id,
        v_response_id,
        1,
        p_engine_version,
        p_policy_version,
        p_input_fingerprint,
        p_payload
    );

    return v_program_id;
end;
$$;

revoke all on function public.create_program_with_initial_version(
    text,
    integer,
    text,
    text,
    text,
    jsonb,
    jsonb
) from public;

grant execute on function public.create_program_with_initial_version(
    text,
    integer,
    text,
    text,
    text,
    jsonb,
    jsonb
) to authenticated;

create or replace function public.questionnaire_engine_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select jsonb_build_object(
        'ready', true,
        'questionnaireVersion', 3,
        'programSchemaVersion', 3,
        'migration', '20260807060000_questionnaire_v3_readiness'
    );
$$;

revoke all on function public.questionnaire_engine_status() from public;
grant execute on function public.questionnaire_engine_status() to authenticated;

-- Prompt PostgREST to refresh function metadata promptly after deployment.
notify pgrst, 'reload schema';
