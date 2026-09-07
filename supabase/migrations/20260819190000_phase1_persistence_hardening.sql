-- Phase 1 persistence contract.
--
-- 1. Bound every user-controlled JSON document at the database boundary.
-- 2. Make workout writes RPC-only, with ownership and prescription checks.
-- 3. Save a workout and any permanent substitution in one transaction.
-- 4. Preserve the existing public RPC signatures while placing size checks in
--    front of their privileged implementations.

alter table public.programs
add constraint programs_payload_size_check
check (pg_column_size(payload) <= 1048576) not valid;

alter table public.questionnaire_responses
add constraint questionnaire_responses_response_size_check
check (pg_column_size(response) <= 65536) not valid;

alter table public.program_versions
add constraint program_versions_payload_size_check
check (pg_column_size(payload) <= 1048576) not valid;

alter table public.workout_logs
add constraint workout_logs_exercise_logs_size_check
check (pg_column_size(exercise_logs) <= 131072) not valid;

alter table public.workout_logs
add constraint workout_logs_cardio_log_size_check
check (pg_column_size(cardio_log) <= 16384) not valid;

alter table public.weekly_reviews
add constraint weekly_reviews_metrics_size_check
check (pg_column_size(metrics) <= 65536) not valid;

alter table public.weekly_reviews
add constraint weekly_reviews_result_size_check
check (pg_column_size(result) <= 65536) not valid;

alter table public.programs validate constraint programs_payload_size_check;
alter table public.questionnaire_responses
validate constraint questionnaire_responses_response_size_check;
alter table public.program_versions
validate constraint program_versions_payload_size_check;
alter table public.workout_logs
validate constraint workout_logs_exercise_logs_size_check;
alter table public.workout_logs
validate constraint workout_logs_cardio_log_size_check;
alter table public.weekly_reviews
validate constraint weekly_reviews_metrics_size_check;
alter table public.weekly_reviews
validate constraint weekly_reviews_result_size_check;

create or replace function app_private.assert_json_size(
    p_value jsonb,
    p_maximum_bytes integer,
    p_error_message text
)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
    if p_value is null or pg_column_size(p_value) > p_maximum_bytes then
        raise exception '%', p_error_message using errcode = '22023';
    end if;
end;
$$;

revoke all on function app_private.assert_json_size(jsonb, integer, text)
from public, anon, authenticated, service_role;

-- Retain the audited implementations under private, non-callable names. The
-- replacement implementations below validate size before entering them.
alter function app_private.create_program_with_initial_version_impl(
    text, integer, text, text, text, jsonb, jsonb
) rename to create_program_with_initial_version_unchecked;

alter function app_private.replace_program_from_questionnaire_impl(
    uuid, text, integer, text, text, text, jsonb, jsonb
) rename to replace_program_from_questionnaire_unchecked;

alter function app_private.record_program_substitution_impl(
    uuid, integer, jsonb
) rename to record_program_substitution_unchecked;

alter function app_private.record_weekly_review_impl(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb
) rename to record_weekly_review_unchecked;

revoke all on function app_private.create_program_with_initial_version_unchecked(
    text, integer, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function app_private.replace_program_from_questionnaire_unchecked(
    uuid, text, integer, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function app_private.record_program_substitution_unchecked(
    uuid, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function app_private.record_weekly_review_unchecked(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;

create function app_private.create_program_with_initial_version_impl(
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
    perform app_private.assert_json_size(
        p_questionnaire, 65536, 'questionnaire_payload_too_large'
    );
    perform app_private.assert_json_size(
        p_payload, 1048576, 'program_payload_too_large'
    );
    return app_private.create_program_with_initial_version_unchecked(
        p_name,
        p_questionnaire_version,
        p_engine_version,
        p_policy_version,
        p_input_fingerprint,
        p_questionnaire,
        p_payload
    );
end;
$$;

create function app_private.replace_program_from_questionnaire_impl(
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
    perform app_private.assert_json_size(
        p_questionnaire, 65536, 'questionnaire_payload_too_large'
    );
    perform app_private.assert_json_size(
        p_payload, 1048576, 'program_payload_too_large'
    );
    return app_private.replace_program_from_questionnaire_unchecked(
        p_program_id,
        p_name,
        p_questionnaire_version,
        p_engine_version,
        p_policy_version,
        p_input_fingerprint,
        p_questionnaire,
        p_payload
    );
end;
$$;

create function app_private.record_program_substitution_impl(
    p_program_id uuid,
    p_source_program_version integer,
    p_new_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform app_private.assert_json_size(
        p_new_payload, 1048576, 'program_payload_too_large'
    );
    return app_private.record_program_substitution_unchecked(
        p_program_id,
        p_source_program_version,
        p_new_payload
    );
end;
$$;

create function app_private.record_weekly_review_impl(
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
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform app_private.assert_json_size(
        p_metrics, 65536, 'weekly_review_metrics_too_large'
    );
    perform app_private.assert_json_size(
        p_result, 65536, 'weekly_review_result_too_large'
    );
    if p_new_payload is not null then
        perform app_private.assert_json_size(
            p_new_payload, 1048576, 'program_payload_too_large'
        );
    end if;
    return app_private.record_weekly_review_unchecked(
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
end;
$$;

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

revoke all on function app_private.record_weekly_review_impl(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function app_private.record_weekly_review_impl(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb
) to authenticated;

-- Recreate the invoker wrappers so their stored dependencies resolve to the
-- new validated implementations rather than the renamed functions.
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
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.create_program_with_initial_version_impl(
        p_name, p_questionnaire_version, p_engine_version, p_policy_version,
        p_input_fingerprint, p_questionnaire, p_payload
    );
$$;

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
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.replace_program_from_questionnaire_impl(
        p_program_id, p_name, p_questionnaire_version, p_engine_version,
        p_policy_version, p_input_fingerprint, p_questionnaire, p_payload
    );
$$;

create or replace function public.record_program_substitution(
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
        p_program_id, p_source_program_version, p_new_payload
    );
$$;

create or replace function public.record_weekly_review(
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
        p_program_id, p_source_program_version, p_week_number, p_decision,
        p_state, p_confidence, p_metrics, p_result, p_new_payload
    );
$$;

-- Direct writes are intentionally removed. RLS remains defense-in-depth for
-- reads and for owner-only cascading deletion through programs.
revoke insert, update, delete on public.workout_logs from authenticated;
grant select on public.workout_logs to authenticated;

-- A permanent substitution must accompany the workout observation that
-- caused it. Older clients can no longer call the split substitution RPC.
revoke execute on function public.record_program_substitution(
    uuid, integer, jsonb
) from authenticated;

create function app_private.save_workout_log_impl(
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
    p_new_program_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_program_payload jsonb;
    v_log_id uuid;
    v_result_version integer := p_program_version;
    v_is_planned_session boolean;
    v_is_daily_movement boolean := p_session_id ~
        '^daily-movement:[0-9]{4}-[0-9]{2}-[0-9]{2}$';
    v_substitution_result jsonb;
begin
    if v_user_id is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;
    if p_program_version < 1
       or p_week_number < 1
       or p_session_sequence < 1
       or char_length(p_session_id) not between 1 and 200 then
        raise exception 'invalid_workout_identity' using errcode = '22023';
    end if;
    if p_status not in ('in_progress', 'completed', 'partial', 'skipped') then
        raise exception 'invalid_workout_status' using errcode = '22023';
    end if;
    if p_miss_reason is not null and p_miss_reason not in (
        'time', 'schedule', 'travel', 'too_hard', 'soreness', 'pain',
        'equipment', 'preference', 'unknown'
    ) then
        raise exception 'invalid_workout_miss_reason' using errcode = '22023';
    end if;
    if p_status in ('partial', 'skipped') and p_miss_reason is null then
        raise exception 'unfinished_workout_reason_required'
            using errcode = '22023';
    end if;
    if p_duration_minutes is not null
       and p_duration_minutes not between 0 and 1440 then
        raise exception 'invalid_workout_duration' using errcode = '22023';
    end if;
    if jsonb_typeof(p_exercise_logs) <> 'array'
       or jsonb_array_length(p_exercise_logs) > 100 then
        raise exception 'invalid_exercise_logs' using errcode = '22023';
    end if;
    if jsonb_typeof(p_cardio_log) <> 'object'
       or jsonb_typeof(p_movement_log) <> 'object' then
        raise exception 'invalid_cardio_or_movement_log' using errcode = '22023';
    end if;
    perform app_private.assert_json_size(
        p_exercise_logs, 131072, 'exercise_logs_too_large'
    );
    perform app_private.assert_json_size(
        p_cardio_log, 16384, 'cardio_log_too_large'
    );
    perform app_private.assert_json_size(
        p_movement_log, 4096, 'movement_log_too_large'
    );
    if p_new_program_payload is not null then
        perform app_private.assert_json_size(
            p_new_program_payload, 1048576, 'program_payload_too_large'
        );
    end if;

    select payload into v_program_payload
    from public.programs
    where id = p_program_id and user_id = v_user_id
    for update;
    if not found then
        raise exception 'Program not found.' using errcode = 'P0002';
    end if;
    if coalesce((v_program_payload #>> '{program,version}')::integer, 0)
       <> p_program_version then
        raise exception 'The program changed before the workout was saved. Reload and try again.'
            using errcode = '40001';
    end if;

    select exists (
        select 1
        from jsonb_array_elements(
            coalesce(v_program_payload #> '{program,weeks}', '[]'::jsonb)
        ) as weeks(week_item)
        cross join lateral jsonb_array_elements(
            coalesce(week_item -> 'sessions', '[]'::jsonb)
        ) as sessions(session_item)
        where (week_item ->> 'weekNumber')::integer = p_week_number
          and session_item ->> 'id' = p_session_id
          and (session_item ->> 'sequence')::integer = p_session_sequence
    ) into v_is_planned_session;

    if v_is_daily_movement then
        select exists (
            select 1
            from jsonb_array_elements(
                coalesce(v_program_payload #> '{program,weeks}', '[]'::jsonb)
            ) as weeks(week_item)
            cross join lateral jsonb_array_elements(
                coalesce(week_item -> 'sessions', '[]'::jsonb)
            ) as sessions(session_item)
            where (week_item ->> 'weekNumber')::integer = p_week_number
              and session_item ->> 'kind' = 'movement'
        ) into v_is_planned_session;
        if p_exercise_logs <> '[]'::jsonb or p_cardio_log <> '{}'::jsonb then
            raise exception 'daily_movement_cannot_store_workout_data'
                using errcode = '22023';
        end if;
    end if;

    if not v_is_planned_session then
        raise exception 'workout_session_not_in_current_program'
            using errcode = '22023';
    end if;
    if exists (
        select 1 from public.weekly_reviews
        where program_id = p_program_id
          and user_id = v_user_id
          and week_number = p_week_number
    ) then
        raise exception 'A reviewed workout log cannot be changed.'
            using errcode = '55000';
    end if;

    if p_new_program_payload is not null then
        v_substitution_result :=
            app_private.record_program_substitution_impl(
                p_program_id,
                p_program_version,
                p_new_program_payload
            );
        v_result_version :=
            (v_substitution_result ->> 'programVersion')::integer;
    end if;

    insert into public.workout_logs (
        user_id,
        program_id,
        program_version,
        session_id,
        week_number,
        session_sequence,
        status,
        exercise_logs,
        cardio_log,
        movement_log,
        duration_minutes,
        miss_reason,
        completed_at
    ) values (
        v_user_id,
        p_program_id,
        v_result_version,
        p_session_id,
        p_week_number,
        p_session_sequence,
        p_status,
        p_exercise_logs,
        p_cardio_log,
        p_movement_log,
        p_duration_minutes,
        p_miss_reason,
        case when p_status = 'in_progress' then null else now() end
    )
    on conflict (program_id, program_version, session_id) do update
    set status = excluded.status,
        exercise_logs = excluded.exercise_logs,
        cardio_log = excluded.cardio_log,
        movement_log = excluded.movement_log,
        duration_minutes = excluded.duration_minutes,
        miss_reason = excluded.miss_reason,
        completed_at = excluded.completed_at
    returning id into v_log_id;

    return jsonb_build_object(
        'workoutLogId', v_log_id,
        'programVersion', v_result_version
    );
end;
$$;

revoke all on function app_private.save_workout_log_impl(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function app_private.save_workout_log_impl(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb
) to authenticated;

create function public.save_workout_log(
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
    p_new_program_payload jsonb default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.save_workout_log_impl(
        p_program_id,
        p_program_version,
        p_session_id,
        p_week_number,
        p_session_sequence,
        p_status,
        p_exercise_logs,
        p_cardio_log,
        p_movement_log,
        p_duration_minutes,
        p_miss_reason,
        p_new_program_payload
    );
$$;

revoke all on function public.save_workout_log(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.save_workout_log(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb
) to authenticated;

-- Restore deliberate grants after CREATE OR REPLACE operations.
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

revoke all on function public.record_weekly_review(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.record_weekly_review(
    uuid, integer, integer, text, text, text, jsonb, jsonb, jsonb
) to authenticated;

create or replace function public.workout_logging_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select jsonb_build_object(
        'ready', true,
        'workoutLogVersion', 3,
        'migration', '20260819190000_phase1_persistence_hardening'
    );
$$;

revoke all on function public.workout_logging_status()
from public, anon, authenticated, service_role;
grant execute on function public.workout_logging_status() to authenticated;

notify pgrst, 'reload schema';
