-- Autosaves need one session, not the complete 200-500 KiB program payload.
-- This projection keeps the Worker response below 50 KiB and the v5 save
-- wrapper prevents two open tabs from silently overwriting newer entries.

create function public.workout_session_context(
    p_program_id uuid,
    p_session_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_context jsonb;
begin
    select jsonb_build_object(
        'programId', program.id,
        'programName', program.name,
        'programVersion',
            (program.payload #>> '{program,version}')::integer,
        'session', selected.session_item,
        'effortReporting',
            program.payload #>> '{inputSnapshot,history,effortReporting}',
        'effortFamiliarity',
            program.payload #>> '{inputSnapshot,history,effortFamiliarity}',
        'units', program.payload #>> '{program,loadSettings,units}',
        'movementTarget', (
            select movement.session_item -> 'movementTarget'
            from jsonb_array_elements(
                coalesce(program.payload #> '{program,weeks}', '[]'::jsonb)
            ) as movement_week(week_item)
            cross join lateral jsonb_array_elements(
                coalesce(movement_week.week_item -> 'sessions', '[]'::jsonb)
            ) as movement(session_item)
            where (movement_week.week_item ->> 'weekNumber')::integer =
                    (selected.session_item ->> 'weekNumber')::integer
              and movement.session_item ->> 'kind' = 'movement'
            limit 1
        ),
        'firstFormalSessionId', (
            select formal.session_item ->> 'id'
            from jsonb_array_elements(
                coalesce(program.payload #> '{program,weeks}', '[]'::jsonb)
            ) as formal_week(week_item)
            cross join lateral jsonb_array_elements(
                coalesce(formal_week.week_item -> 'sessions', '[]'::jsonb)
            ) as formal(session_item)
            where formal.session_item ->> 'kind' <> 'movement'
            order by (formal_week.week_item ->> 'weekNumber')::integer,
                     (formal.session_item ->> 'sequence')::integer
            limit 1
        )
    ) into v_context
    from public.programs as program
    cross join lateral (
        select session.session_item
        from jsonb_array_elements(
            coalesce(program.payload #> '{program,weeks}', '[]'::jsonb)
        ) as week(week_item)
        cross join lateral jsonb_array_elements(
            coalesce(week.week_item -> 'sessions', '[]'::jsonb)
        ) as session(session_item)
        where session.session_item ->> 'id' = p_session_id
          and session.session_item ->> 'kind' <> 'movement'
        limit 1
    ) as selected
    where program.id = p_program_id
      and program.user_id = auth.uid();

    if v_context is not null
       and pg_catalog.octet_length(v_context::text) > 51200 then
        raise exception 'workout_session_context_too_large'
            using errcode = '54000';
    end if;
    return v_context;
end;
$$;

create function public.save_workout_log_v5(
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
security invoker
set search_path = ''
as $$
declare
    v_current_updated_at timestamptz;
    v_expected_updated_at timestamptz;
    v_result jsonb;
    v_result_updated_at timestamptz;
begin
    if p_expected_revision is null
       or char_length(p_expected_revision) not between 1 and 64 then
        raise exception 'invalid_workout_revision' using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            p_program_id::text || ':' || p_session_id,
            20260824
        )
    );

    select workout.updated_at into v_current_updated_at
    from public.workout_logs as workout
    where workout.program_id = p_program_id
      and workout.program_version = p_program_version
      and workout.session_id = p_session_id
      and workout.user_id = auth.uid();

    if p_expected_revision = 'new' then
        if v_current_updated_at is not null then
            raise exception 'workout_log_changed_reload_required'
                using errcode = '40001';
        end if;
    else
        begin
            v_expected_updated_at := p_expected_revision::timestamptz;
        exception when others then
            raise exception 'invalid_workout_revision'
                using errcode = '22023';
        end;
        if v_current_updated_at is null
           or v_current_updated_at <> v_expected_updated_at then
            raise exception 'workout_log_changed_reload_required'
                using errcode = '40001';
        end if;
    end if;

    v_result := app_private.save_workout_log_v4_impl(
        p_program_id, p_program_version, p_session_id, p_week_number,
        p_session_sequence, p_status, p_exercise_logs, p_cardio_log,
        p_movement_log, p_duration_minutes, p_miss_reason,
        p_new_program_payload, p_reverse_patch
    );

    select workout.updated_at into v_result_updated_at
    from public.workout_logs as workout
    where workout.program_id = p_program_id
      and workout.program_version = (v_result ->> 'programVersion')::integer
      and workout.session_id = p_session_id
      and workout.user_id = auth.uid();

    return v_result || jsonb_build_object(
        'updatedAt', v_result_updated_at
    );
end;
$$;

revoke all on function public.workout_session_context(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.save_workout_log_v5(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb, text
) from public, anon, authenticated, service_role;

grant execute on function public.workout_session_context(uuid, text)
to authenticated;
grant execute on function public.save_workout_log_v5(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb, text
) to authenticated;

notify pgrst, 'reload schema';
