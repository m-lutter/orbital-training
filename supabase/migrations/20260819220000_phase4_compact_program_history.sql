-- Phase 4 compact, backward-compatible program history.
--
-- programs.payload remains the single full current program used by every read
-- path. Older versions are either legacy full snapshots or reverse patches
-- which transform the next version back into that version. The current
-- program_versions row is an integrity anchor and no longer duplicates the
-- full programs.payload document.

alter table public.program_versions
add column storage_format text not null default 'full_v3';

alter table public.program_versions
add column reverse_patch jsonb;

alter table public.program_versions
add column payload_hash text;

update public.program_versions
set payload_hash = md5(payload::text)
where payload_hash is null and payload is not null;

create function app_private.prepare_program_version_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.payload is not null then
        new.payload_hash := md5(new.payload::text);
    end if;
    return new;
end;
$$;

revoke all on function app_private.prepare_program_version_storage()
from public, anon, authenticated, service_role;

create trigger program_versions_prepare_storage
before insert or update of payload on public.program_versions
for each row execute function app_private.prepare_program_version_storage();

alter table public.program_versions
alter column payload_hash set not null;

alter table public.program_versions
alter column payload drop not null;

-- Remove only exact duplicates of the live current payload. Any inconsistent
-- or legacy row is deliberately retained as a full snapshot for recovery.
update public.program_versions as version_row
set payload = null,
    reverse_patch = null,
    storage_format = 'current_anchor_v1'
from public.programs as program_row
where version_row.program_id = program_row.id
  and version_row.user_id = program_row.user_id
  and version_row.version_number::text =
      program_row.payload #>> '{program,version}'
  and version_row.payload = program_row.payload;

alter table public.program_versions
add constraint program_versions_storage_format_check
check (storage_format in (
    'full_v3', 'reverse_patch_v1', 'current_anchor_v1'
)) not valid;

alter table public.program_versions
add constraint program_versions_storage_shape_check
check (
    (
        storage_format = 'full_v3'
        and payload is not null
        and reverse_patch is null
        and jsonb_typeof(payload) = 'object'
    )
    or (
        storage_format = 'reverse_patch_v1'
        and payload is null
        and jsonb_typeof(reverse_patch) = 'array'
    )
    or (
        storage_format = 'current_anchor_v1'
        and payload is null
        and reverse_patch is null
    )
) not valid;

alter table public.program_versions
add constraint program_versions_payload_hash_check
check (payload_hash ~ '^[0-9a-f]{32}$') not valid;

alter table public.program_versions
add constraint program_versions_reverse_patch_size_check
check (
    reverse_patch is null or pg_column_size(reverse_patch) <= 262144
) not valid;

alter table public.program_versions
validate constraint program_versions_storage_format_check;
alter table public.program_versions
validate constraint program_versions_storage_shape_check;
alter table public.program_versions
validate constraint program_versions_payload_hash_check;
alter table public.program_versions
validate constraint program_versions_reverse_patch_size_check;

create function app_private.assert_program_reverse_patch(p_patch jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
    if p_patch is null then
        return;
    end if;
    if jsonb_typeof(p_patch) <> 'array' then
        raise exception 'invalid_or_oversized_program_reverse_patch'
            using errcode = '22023';
    end if;
    if pg_column_size(p_patch) > 262144
       or jsonb_array_length(p_patch) > 20000 then
        raise exception 'invalid_or_oversized_program_reverse_patch'
            using errcode = '22023';
    end if;
    if exists (
        select 1
        from jsonb_array_elements(p_patch) as operations(operation)
        where jsonb_typeof(operation) <> 'array'
    ) then
        raise exception 'invalid_or_oversized_program_reverse_patch'
            using errcode = '22023';
    end if;
    if exists (
        select 1
        from jsonb_array_elements(p_patch) as operations(operation)
        where jsonb_array_length(operation) not in (2, 3)
           or coalesce(operation ->> 0, '') not in ('0', '1')
           or (operation ->> 0 = '0' and jsonb_array_length(operation) <> 3)
           or (operation ->> 0 = '1' and jsonb_array_length(operation) <> 2)
           or jsonb_typeof(operation -> 1) <> 'array'
    ) then
        raise exception 'invalid_or_oversized_program_reverse_patch'
            using errcode = '22023';
    end if;
    if exists (
        select 1
        from jsonb_array_elements(p_patch) as operations(operation)
        where jsonb_array_length(operation -> 1) > 64
    ) then
        raise exception 'invalid_or_oversized_program_reverse_patch'
            using errcode = '22023';
    end if;
    if exists (
        select 1
        from jsonb_array_elements(p_patch) as operations(operation)
        cross join lateral jsonb_array_elements(
            operation -> 1
        ) as path_tokens(token)
        where jsonb_typeof(token) not in ('string', 'number')
           or (
               jsonb_typeof(token) = 'number'
               and token::text !~ '^[0-9]+$'
           )
           or (
               jsonb_typeof(token) = 'string'
               and token #>> '{}' in ('__proto__', 'constructor', 'prototype')
           )
    ) then
        raise exception 'invalid_or_oversized_program_reverse_patch'
            using errcode = '22023';
    end if;
end;
$$;

revoke all on function app_private.assert_program_reverse_patch(jsonb)
from public, anon, authenticated, service_role;

-- If an older application build changes the current payload, preserve the
-- outgoing anchor as a full snapshot before the update. The compact RPCs
-- replace that temporary snapshot with a reverse patch in the same transaction.
create function app_private.archive_current_program_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if old.payload is not distinct from new.payload then
        return new;
    end if;

    update public.program_versions
    set payload = old.payload,
        reverse_patch = null,
        storage_format = 'full_v3',
        payload_hash = md5(old.payload::text)
    where program_id = old.id
      and user_id = old.user_id
      and version_number::text = old.payload #>> '{program,version}'
      and storage_format = 'current_anchor_v1'
      and payload is null;

    return new;
end;
$$;

revoke all on function app_private.archive_current_program_version()
from public, anon, authenticated, service_role;

create trigger programs_archive_current_version
before update of payload on public.programs
for each row execute function app_private.archive_current_program_version();

create function app_private.compact_current_program_version(
    p_program_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_payload jsonb;
    v_version integer;
    v_affected integer;
begin
    select payload, (payload #>> '{program,version}')::integer
    into v_payload, v_version
    from public.programs
    where id = p_program_id and user_id = v_user_id
    for update;
    if not found then
        raise exception 'Program not found.' using errcode = 'P0002';
    end if;

    update public.program_versions
    set payload = null,
        reverse_patch = null,
        storage_format = 'current_anchor_v1',
        payload_hash = md5(v_payload::text)
    where program_id = p_program_id
      and user_id = v_user_id
      and version_number = v_version;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
        raise exception 'current_program_history_anchor_missing'
            using errcode = 'P0002';
    end if;
end;
$$;

revoke all on function app_private.compact_current_program_version(uuid)
from public, anon, authenticated, service_role;

create function app_private.compact_program_transition(
    p_program_id uuid,
    p_source_version integer,
    p_result_version integer,
    p_reverse_patch jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_current_payload jsonb;
    v_current_version integer;
    v_affected integer;
begin
    perform app_private.assert_program_reverse_patch(p_reverse_patch);

    select payload, (payload #>> '{program,version}')::integer
    into v_current_payload, v_current_version
    from public.programs
    where id = p_program_id and user_id = v_user_id
    for update;
    if not found then
        raise exception 'Program not found.' using errcode = 'P0002';
    end if;
    if v_current_version <> p_result_version
       or p_result_version <> p_source_version + 1 then
        raise exception 'program_history_transition_mismatch'
            using errcode = '40001';
    end if;

    if p_reverse_patch is not null then
        update public.program_versions
        set payload = null,
            reverse_patch = p_reverse_patch,
            storage_format = 'reverse_patch_v1'
        where program_id = p_program_id
          and user_id = v_user_id
          and version_number = p_source_version;
    else
        -- Oversized or unavailable patches intentionally retain the full
        -- outgoing snapshot archived by the compatibility trigger.
        update public.program_versions
        set reverse_patch = null,
            storage_format = 'full_v3'
        where program_id = p_program_id
          and user_id = v_user_id
          and version_number = p_source_version
          and payload is not null;
    end if;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
        raise exception 'source_program_history_version_missing'
            using errcode = 'P0002';
    end if;

    update public.program_versions
    set payload = null,
        reverse_patch = null,
        storage_format = 'current_anchor_v1',
        payload_hash = md5(v_current_payload::text)
    where program_id = p_program_id
      and user_id = v_user_id
      and version_number = p_result_version;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
        raise exception 'result_program_history_anchor_missing'
            using errcode = 'P0002';
    end if;
end;
$$;

revoke all on function app_private.compact_program_transition(
    uuid, integer, integer, jsonb
) from public, anon, authenticated, service_role;

create function app_private.create_program_with_initial_version_v4_impl(
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
    v_program_id uuid;
begin
    v_program_id := app_private.create_program_with_initial_version_impl(
        p_name, p_questionnaire_version, p_engine_version, p_policy_version,
        p_input_fingerprint, p_questionnaire, p_payload
    );
    perform app_private.compact_current_program_version(v_program_id);
    return v_program_id;
end;
$$;

create function app_private.replace_program_from_questionnaire_v4_impl(
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
begin
    perform app_private.replace_program_from_questionnaire_impl(
        p_program_id, p_name, p_questionnaire_version, p_engine_version,
        p_policy_version, p_input_fingerprint, p_questionnaire, p_payload
    );
    perform app_private.compact_current_program_version(p_program_id);
    return p_program_id;
end;
$$;

create function app_private.record_weekly_review_v4_impl(
    p_program_id uuid,
    p_source_program_version integer,
    p_week_number integer,
    p_decision text,
    p_state text,
    p_confidence text,
    p_metrics jsonb,
    p_result jsonb,
    p_new_payload jsonb default null,
    p_reverse_patch jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
    v_result_version integer;
begin
    if p_new_payload is null and p_reverse_patch is not null then
        raise exception 'program_reverse_patch_requires_new_payload'
            using errcode = '22023';
    end if;
    perform app_private.assert_program_reverse_patch(p_reverse_patch);
    v_result := app_private.record_weekly_review_impl(
        p_program_id, p_source_program_version, p_week_number, p_decision,
        p_state, p_confidence, p_metrics, p_result, p_new_payload
    );
    if p_new_payload is not null
       and coalesce((v_result ->> 'alreadyRecorded')::boolean, false) = false then
        v_result_version := (v_result ->> 'programVersion')::integer;
        perform app_private.compact_program_transition(
            p_program_id, p_source_program_version, v_result_version,
            p_reverse_patch
        );
    end if;
    return v_result;
end;
$$;

create function app_private.save_workout_log_v4_impl(
    p_program_id uuid,
    p_program_version integer,
    p_session_id text,
    p_week_number integer,
    p_session_sequence integer,
    p_status text,
    p_exercise_logs jsonb,
    p_cardio_log jsonb,
    p_movement_log jsonb,
    p_duration_minutes integer default null,
    p_miss_reason text default null,
    p_new_program_payload jsonb default null,
    p_reverse_patch jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
    v_result_version integer;
begin
    if p_new_program_payload is null and p_reverse_patch is not null then
        raise exception 'program_reverse_patch_requires_new_payload'
            using errcode = '22023';
    end if;
    perform app_private.assert_program_reverse_patch(p_reverse_patch);
    v_result := app_private.save_workout_log_impl(
        p_program_id, p_program_version, p_session_id, p_week_number,
        p_session_sequence, p_status, p_exercise_logs, p_cardio_log,
        p_movement_log, p_duration_minutes, p_miss_reason,
        p_new_program_payload
    );
    if p_new_program_payload is not null then
        v_result_version := (v_result ->> 'programVersion')::integer;
        perform app_private.compact_program_transition(
            p_program_id, p_program_version, v_result_version,
            p_reverse_patch
        );
    end if;
    return v_result;
end;
$$;

revoke all on function app_private.create_program_with_initial_version_v4_impl(
    text, integer, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function app_private.create_program_with_initial_version_v4_impl(
    text, integer, text, text, text, jsonb, jsonb
) to authenticated;

revoke all on function app_private.replace_program_from_questionnaire_v4_impl(
    uuid, text, integer, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function app_private.replace_program_from_questionnaire_v4_impl(
    uuid, text, integer, text, text, text, jsonb, jsonb
) to authenticated;

revoke all on function app_private.record_weekly_review_v4_impl(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function app_private.record_weekly_review_v4_impl(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb, jsonb
) to authenticated;

revoke all on function app_private.save_workout_log_v4_impl(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function app_private.save_workout_log_v4_impl(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb
) to authenticated;

create function public.create_program_with_initial_version_v4(
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
    select app_private.create_program_with_initial_version_v4_impl(
        p_name, p_questionnaire_version, p_engine_version, p_policy_version,
        p_input_fingerprint, p_questionnaire, p_payload
    );
$$;

create function public.replace_program_from_questionnaire_v4(
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
    select app_private.replace_program_from_questionnaire_v4_impl(
        p_program_id, p_name, p_questionnaire_version, p_engine_version,
        p_policy_version, p_input_fingerprint, p_questionnaire, p_payload
    );
$$;

create function public.record_weekly_review_v4(
    p_program_id uuid,
    p_source_program_version integer,
    p_week_number integer,
    p_decision text,
    p_state text,
    p_confidence text,
    p_metrics jsonb,
    p_result jsonb,
    p_new_payload jsonb default null,
    p_reverse_patch jsonb default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.record_weekly_review_v4_impl(
        p_program_id, p_source_program_version, p_week_number, p_decision,
        p_state, p_confidence, p_metrics, p_result, p_new_payload,
        p_reverse_patch
    );
$$;

create function public.save_workout_log_v4(
    p_program_id uuid,
    p_program_version integer,
    p_session_id text,
    p_week_number integer,
    p_session_sequence integer,
    p_status text,
    p_exercise_logs jsonb,
    p_cardio_log jsonb,
    p_movement_log jsonb,
    p_duration_minutes integer default null,
    p_miss_reason text default null,
    p_new_program_payload jsonb default null,
    p_reverse_patch jsonb default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.save_workout_log_v4_impl(
        p_program_id, p_program_version, p_session_id, p_week_number,
        p_session_sequence, p_status, p_exercise_logs, p_cardio_log,
        p_movement_log, p_duration_minutes, p_miss_reason,
        p_new_program_payload, p_reverse_patch
    );
$$;

revoke all on function public.create_program_with_initial_version_v4(
    text, integer, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_program_with_initial_version_v4(
    text, integer, text, text, text, jsonb, jsonb
) to authenticated;

revoke all on function public.replace_program_from_questionnaire_v4(
    uuid, text, integer, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_program_from_questionnaire_v4(
    uuid, text, integer, text, text, text, jsonb, jsonb
) to authenticated;

revoke all on function public.record_weekly_review_v4(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.record_weekly_review_v4(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb, jsonb
) to authenticated;

revoke all on function public.save_workout_log_v4(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.save_workout_log_v4(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb
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
        'compactHistoryVersion', 1,
        'migration', '20260819220000_phase4_compact_program_history'
    );
$$;

revoke all on function public.questionnaire_engine_status()
from public, anon, authenticated, service_role;
grant execute on function public.questionnaire_engine_status()
to authenticated;

notify pgrst, 'reload schema';
