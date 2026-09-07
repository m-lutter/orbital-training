-- Bound workout-save concurrency and make expected optimistic conflicts cheap.
--
-- The previous v6 wrapper delegated conflicts to v5, where they were raised as
-- PostgreSQL errors after waiting on a blocking advisory lock. A stale client
-- could therefore create a lock queue and a high-volume database error stream.
-- This implementation returns normal JSON for expected conflicts, recognizes
-- exact replays, and never waits behind another save for the same workout.

create function app_private.save_workout_log_v6_impl(
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
    p_reverse_patch jsonb default null,
    p_expected_revision text default 'new'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_current_payload jsonb;
    v_current_program_version integer;
    v_expected_updated_at timestamptz;
    v_existing public.workout_logs%rowtype;
    v_result_row public.workout_logs%rowtype;
    v_existing_matches boolean := false;
    v_result_matches boolean := false;
    v_revision_matches boolean := false;
    v_result jsonb;
begin
    if v_user_id is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;

    if p_expected_revision is null
       or char_length(p_expected_revision) not between 1 and 64 then
        raise exception 'invalid_workout_revision' using errcode = '22023';
    end if;
    if p_expected_revision <> 'new' then
        begin
            v_expected_updated_at := p_expected_revision::timestamptz;
        exception when others then
            raise exception 'invalid_workout_revision'
                using errcode = '22023';
        end;
    end if;

    -- Do not let duplicate clicks consume connections while waiting in an
    -- advisory-lock queue. The first request owns the transaction-scoped lock;
    -- concurrent duplicates receive a normal, non-retryable conflict result.
    if not pg_catalog.pg_try_advisory_xact_lock(
        pg_catalog.hashtextextended(
            p_program_id::text || ':' || p_session_id,
            20260824
        )
    ) then
        return jsonb_build_object(
            'ok', false,
            'conflict', 'save_in_progress',
            'retryable', false
        );
    end if;

    -- The definer implementation is required for FOR UPDATE because direct
    -- table writes are intentionally unavailable to authenticated clients.
    -- Ownership is checked explicitly before any row or payload is returned.
    select
        program.payload,
        (program.payload #>> '{program,version}')::integer
    into v_current_payload, v_current_program_version
    from public.programs as program
    where program.id = p_program_id
      and program.user_id = v_user_id
    for update;
    if not found then
        raise exception 'Program not found.' using errcode = 'P0002';
    end if;

    select workout.* into v_existing
    from public.workout_logs as workout
    where workout.program_id = p_program_id
      and workout.program_version = p_program_version
      and workout.session_id = p_session_id
      and workout.user_id = v_user_id;

    v_existing_matches := v_existing.id is not null
        and v_existing.week_number is not distinct from p_week_number
        and v_existing.session_sequence is not distinct from p_session_sequence
        and v_existing.status is not distinct from p_status
        and v_existing.exercise_logs is not distinct from p_exercise_logs
        and v_existing.cardio_log is not distinct from p_cardio_log
        and v_existing.movement_log is not distinct from p_movement_log
        and v_existing.duration_minutes is not distinct from p_duration_minutes
        and v_existing.miss_reason is not distinct from p_miss_reason;

    if v_current_program_version = p_program_version then
        -- An exact replay cannot overwrite newer information. Treat it as an
        -- idempotent success even if the caller still says "new" or carries an
        -- older revision, provided no program transition remains to be made.
        if p_new_program_payload is null
           and p_reverse_patch is null
           and v_existing_matches then
            return jsonb_build_object(
                'ok', true,
                'workoutLogId', v_existing.id,
                'programVersion', v_existing.program_version,
                'updatedAt', v_existing.updated_at,
                'unchanged', true,
                'duplicate', true
            );
        end if;

        v_revision_matches :=
            (p_expected_revision = 'new' and v_existing.id is null)
            or (
                p_expected_revision <> 'new'
                and v_existing.id is not null
                and v_existing.updated_at = v_expected_updated_at
            );
        if not v_revision_matches then
            return jsonb_build_object(
                'ok', false,
                'conflict', 'workout_revision',
                'retryable', false,
                'currentProgramVersion', v_current_program_version,
                'currentRevision', v_existing.updated_at
            );
        end if;
    else
        -- A permanent substitution advances the program and stores the
        -- triggering workout at the result version in one transaction. An
        -- identical replay of that transaction is already satisfied and must
        -- not create another program version.
        select workout.* into v_result_row
        from public.workout_logs as workout
        where workout.program_id = p_program_id
          and workout.program_version = v_current_program_version
          and workout.session_id = p_session_id
          and workout.user_id = v_user_id;

        v_result_matches := v_result_row.id is not null
            and v_result_row.week_number is not distinct from p_week_number
            and v_result_row.session_sequence is not distinct from
                p_session_sequence
            and v_result_row.status is not distinct from p_status
            and v_result_row.exercise_logs is not distinct from p_exercise_logs
            and v_result_row.cardio_log is not distinct from p_cardio_log
            and v_result_row.movement_log is not distinct from p_movement_log
            and v_result_row.duration_minutes is not distinct from
                p_duration_minutes
            and v_result_row.miss_reason is not distinct from p_miss_reason;

        if p_new_program_payload is not null
           and v_current_program_version = p_program_version + 1
           and v_current_payload is not distinct from p_new_program_payload
           and v_result_matches then
            return jsonb_build_object(
                'ok', true,
                'workoutLogId', v_result_row.id,
                'programVersion', v_result_row.program_version,
                'updatedAt', v_result_row.updated_at,
                'unchanged', true,
                'duplicate', true
            );
        end if;

        return jsonb_build_object(
            'ok', false,
            'conflict', 'program_revision',
            'retryable', false,
            'currentProgramVersion', v_current_program_version,
            'currentRevision', v_result_row.updated_at
        );
    end if;

    v_result := app_private.save_workout_log_v4_impl(
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
        p_new_program_payload,
        p_reverse_patch
    );

    select workout.* into v_result_row
    from public.workout_logs as workout
    where workout.program_id = p_program_id
      and workout.program_version = (v_result ->> 'programVersion')::integer
      and workout.session_id = p_session_id
      and workout.user_id = v_user_id;
    if not found then
        raise exception 'workout_save_result_missing' using errcode = 'P0002';
    end if;

    return v_result || jsonb_build_object(
        'ok', true,
        'updatedAt', v_result_row.updated_at,
        'unchanged', false
    );
end;
$$;

revoke all on function app_private.save_workout_log_v6_impl(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function app_private.save_workout_log_v6_impl(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb, text
) to authenticated;

create or replace function public.save_workout_log_v6(
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
    p_reverse_patch jsonb default null,
    p_expected_revision text default 'new'
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.save_workout_log_v6_impl(
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
        p_new_program_payload,
        p_reverse_patch,
        p_expected_revision
    );
$$;

revoke all on function public.save_workout_log_v6(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_workout_log_v6(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb, text
) to authenticated;

-- v5's blocking/error-raising implementation remains in the migration history
-- but is no longer an authenticated API surface.
revoke execute on function public.save_workout_log_v5(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb, text
) from authenticated;

notify pgrst, 'reload schema';
