-- Transactional program rebuilding and permanent exercise substitutions.
-- Rebuilding intentionally removes prior logs/reviews because the questionnaire
-- may produce a completely different schedule. Substitutions preserve history
-- and create the next immutable program version.

create or replace function public.replace_program_from_questionnaire(
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
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_response_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;
    if p_name is null or char_length(btrim(p_name)) not between 1 and 100 then
        raise exception 'Program name must contain 1 to 100 characters.' using errcode = '22023';
    end if;
    if p_questionnaire_version <> 3
       or jsonb_typeof(p_questionnaire) <> 'object'
       or jsonb_typeof(p_payload) <> 'object'
       or p_payload ->> 'schemaVersion' <> '3'
       or (p_payload #>> '{program,version}')::integer <> 1 then
        raise exception 'Invalid questionnaire or rebuilt program payload.' using errcode = '22023';
    end if;

    perform 1 from public.programs
    where id = p_program_id and user_id = v_user_id
    for update;
    if not found then
        raise exception 'Program not found.' using errcode = 'P0002';
    end if;

    -- Reviews are removed before workout logs because reviewed history is
    -- protected by a trigger in the adaptation migration.
    delete from public.weekly_reviews
    where program_id = p_program_id and user_id = v_user_id;
    delete from public.workout_logs
    where program_id = p_program_id and user_id = v_user_id;
    delete from public.program_versions
    where program_id = p_program_id and user_id = v_user_id;
    delete from public.questionnaire_responses
    where program_id = p_program_id and user_id = v_user_id;

    update public.programs
    set name = btrim(p_name), payload = p_payload
    where id = p_program_id and user_id = v_user_id;

    insert into public.questionnaire_responses (
        user_id, program_id, version_number, questionnaire_version, response
    ) values (
        v_user_id, p_program_id, 1, p_questionnaire_version, p_questionnaire
    ) returning id into v_response_id;

    insert into public.program_versions (
        user_id,
        program_id,
        questionnaire_response_id,
        version_number,
        engine_version,
        policy_version,
        input_fingerprint,
        payload
    ) values (
        v_user_id,
        p_program_id,
        v_response_id,
        1,
        p_engine_version,
        p_policy_version,
        p_input_fingerprint,
        p_payload
    );

    return p_program_id;
end;
$$;

revoke all on function public.replace_program_from_questionnaire(
    uuid, text, integer, text, text, text, jsonb, jsonb
) from public;
grant execute on function public.replace_program_from_questionnaire(
    uuid, text, integer, text, text, text, jsonb, jsonb
) to authenticated;

create or replace function public.record_program_substitution(
    p_program_id uuid,
    p_source_program_version integer,
    p_new_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_current_payload jsonb;
    v_questionnaire_response_id uuid;
    v_new_version integer := p_source_program_version + 1;
begin
    if v_user_id is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;
    if p_source_program_version < 1
       or jsonb_typeof(p_new_payload) <> 'object'
       or p_new_payload ->> 'schemaVersion' <> '3'
       or (p_new_payload #>> '{program,version}')::integer <> v_new_version then
        raise exception 'Invalid substituted program payload.' using errcode = '22023';
    end if;

    select payload into v_current_payload
    from public.programs
    where id = p_program_id and user_id = v_user_id
    for update;
    if not found then
        raise exception 'Program not found.' using errcode = 'P0002';
    end if;
    if (v_current_payload #>> '{program,version}')::integer <> p_source_program_version then
        raise exception 'The program changed before the substitution was saved. Reload and try again.'
            using errcode = '40001';
    end if;
    if p_new_payload -> 'inputSnapshot' <> v_current_payload -> 'inputSnapshot'
       or p_new_payload #>> '{program,id}' <> v_current_payload #>> '{program,id}' then
        raise exception 'A substitution cannot replace the questionnaire or program identity.'
            using errcode = '22023';
    end if;

    select questionnaire_response_id into v_questionnaire_response_id
    from public.program_versions
    where program_id = p_program_id
      and user_id = v_user_id
      and version_number = p_source_program_version;
    if v_questionnaire_response_id is null then
        raise exception 'The source program version was not found.' using errcode = 'P0002';
    end if;

    insert into public.program_versions (
        user_id,
        program_id,
        questionnaire_response_id,
        version_number,
        engine_version,
        policy_version,
        input_fingerprint,
        payload
    ) values (
        v_user_id,
        p_program_id,
        v_questionnaire_response_id,
        v_new_version,
        p_new_payload ->> 'engineVersion',
        p_new_payload ->> 'policyVersion',
        p_new_payload #>> '{program,inputFingerprint}',
        p_new_payload
    );

    update public.programs
    set payload = p_new_payload
    where id = p_program_id and user_id = v_user_id;

    return jsonb_build_object('programVersion', v_new_version);
end;
$$;

revoke all on function public.record_program_substitution(uuid, integer, jsonb)
from public;
grant execute on function public.record_program_substitution(uuid, integer, jsonb)
to authenticated;

notify pgrst, 'reload schema';
