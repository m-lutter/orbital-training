-- Reduce request amplification and repeated JSON work observed during the
-- August 2026 Supabase CPU incident.
--
-- The production database is small, so the dominant risk is query frequency.
-- These changes make the common chronology/latest-row paths index-aligned,
-- materialize program sessions once per context request, keep dashboard log
-- projections compact, suppress identical workout writes, and bound digest
-- candidate sizing before applying window functions.

drop index if exists public.workout_logs_program_order_idx;
create index workout_logs_program_chronology_idx
on public.workout_logs(
    program_id,
    week_number,
    session_sequence,
    program_version desc
);

-- The unique workout key already starts with program_id. Reuse the separate
-- program-only index budget for latest-per-session reads. Deliberately leave
-- mutable updated_at out so ordinary saves do not rewrite this index.
drop index if exists public.workout_logs_program_id_idx;
create index workout_logs_program_session_latest_idx
on public.workout_logs(
    program_id,
    session_id,
    program_version desc
);

-- Support parent-row deletion without scanning child tables. These foreign
-- keys are not covered by their tables' existing program/user indexes.
create index if not exists program_versions_questionnaire_response_id_idx
on public.program_versions(questionnaire_response_id);

create index if not exists feedback_reports_program_id_idx
on public.feedback_reports(program_id)
where program_id is not null;

drop index if exists public.feedback_reports_pending_digest_idx;
create index feedback_reports_pending_digest_batch_idx
on public.feedback_reports(digest_batch_id, created_at, id)
where digest_sent_at is null;

-- Expand the program's weeks/sessions once. The earlier implementation used
-- three independent jsonb_array_elements trees for the selected session,
-- movement target, and first formal session.
create or replace function public.workout_session_context(
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
    with owned_program as materialized (
        select
            program.id,
            program.name,
            (program.payload #>> '{program,version}')::integer
                as program_version,
            program.payload #>> '{inputSnapshot,history,effortReporting}'
                as effort_reporting,
            program.payload #>> '{inputSnapshot,history,effortFamiliarity}'
                as effort_familiarity,
            program.payload #>> '{program,loadSettings,units}' as units,
            program.payload
        from public.programs as program
        where program.id = p_program_id
          and program.user_id = (select auth.uid())
    ), sessions as materialized (
        select
            program.id as program_id,
            program.name as program_name,
            program.program_version,
            program.effort_reporting,
            program.effort_familiarity,
            program.units,
            (week.week_item ->> 'weekNumber')::integer as week_number,
            session.session_item
        from owned_program as program
        cross join lateral jsonb_array_elements(
            coalesce(program.payload #> '{program,weeks}', '[]'::jsonb)
        ) as week(week_item)
        cross join lateral jsonb_array_elements(
            coalesce(week.week_item -> 'sessions', '[]'::jsonb)
        ) as session(session_item)
    ), selected as (
        select session.*
        from sessions as session
        where session.session_item ->> 'id' = p_session_id
          and session.session_item ->> 'kind' <> 'movement'
        limit 1
    )
    select jsonb_build_object(
        'programId', selected.program_id,
        'programName', selected.program_name,
        'programVersion', selected.program_version,
        'session', selected.session_item,
        'effortReporting', selected.effort_reporting,
        'effortFamiliarity', selected.effort_familiarity,
        'units', selected.units,
        'movementTarget', (
            select movement.session_item -> 'movementTarget'
            from sessions as movement
            where movement.week_number = selected.week_number
              and movement.session_item ->> 'kind' = 'movement'
            limit 1
        ),
        'firstFormalSessionId', (
            select formal.session_item ->> 'id'
            from sessions as formal
            where formal.session_item ->> 'kind' <> 'movement'
            order by formal.week_number,
                     (formal.session_item ->> 'sequence')::integer
            limit 1
        )
    ) into v_context
    from selected;

    if v_context is not null
       and pg_catalog.octet_length(v_context::text) > 51200 then
        raise exception 'workout_session_context_too_large'
            using errcode = '54000';
    end if;
    return v_context;
end;
$$;

-- Dashboard decisions need the current program plus only the latest status
-- metadata for each session. Exercise/cardio/movement JSON belongs on workout
-- and review screens, not in this frequently loaded projection.
create function public.dashboard_program_context_v2(p_program_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    with owned_program as materialized (
        select program.id, program.payload
        from public.programs as program
        where program.id = p_program_id
          and program.user_id = (select auth.uid())
    ), latest_logs as materialized (
        select distinct on (workout.session_id)
            workout.id,
            workout.program_id,
            workout.program_version,
            workout.session_id,
            workout.week_number,
            workout.session_sequence,
            workout.status,
            workout.started_at,
            workout.completed_at,
            workout.updated_at
        from public.workout_logs as workout
        join owned_program as program on program.id = workout.program_id
        where workout.user_id = (select auth.uid())
        order by workout.session_id,
                 workout.program_version desc
    )
    select jsonb_build_object(
        'payload', program.payload,
        'logs', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', workout.id,
                    'program_id', workout.program_id,
                    'program_version', workout.program_version,
                    'session_id', workout.session_id,
                    'week_number', workout.week_number,
                    'session_sequence', workout.session_sequence,
                    'status', workout.status,
                    'exercise_logs', '[]'::jsonb,
                    'cardio_log', '{}'::jsonb,
                    'movement_log', '{}'::jsonb,
                    'duration_minutes', null,
                    'miss_reason', null,
                    'started_at', workout.started_at,
                    'completed_at', workout.completed_at,
                    'updated_at', workout.updated_at
                ) order by workout.week_number,
                           workout.session_sequence,
                           workout.program_version
            )
            from latest_logs as workout
        ), '[]'::jsonb),
        'reviewedWeeks', coalesce((
            select jsonb_agg(
                review.week_number order by review.week_number
            )
            from public.weekly_reviews as review
            where review.program_id = program.id
              and review.user_id = (select auth.uid())
        ), '[]'::jsonb)
    )
    from owned_program as program;
$$;

revoke all on function public.dashboard_program_context_v2(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.dashboard_program_context_v2(uuid)
to authenticated;

-- Keep v5's ownership, planned-session, review-freeze, and optimistic-locking
-- checks. The v6 wrapper only returns early when an authenticated user submits
-- an identical, revision-matched row without a program transition.
create function public.save_workout_log_v6(
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
    v_existing public.workout_logs%rowtype;
    v_expected_revision timestamptz;
begin
    if p_new_program_payload is null and p_reverse_patch is null then
        select workout.* into v_existing
        from public.workout_logs as workout
        where workout.program_id = p_program_id
          and workout.program_version = p_program_version
          and workout.session_id = p_session_id
          and workout.user_id = (select auth.uid());

        if found and p_expected_revision <> 'new' then
            if p_expected_revision is null
               or char_length(p_expected_revision) not between 1 and 64 then
                raise exception 'invalid_workout_revision'
                    using errcode = '22023';
            end if;
            begin
                v_expected_revision := p_expected_revision::timestamptz;
            exception when others then
                raise exception 'invalid_workout_revision'
                    using errcode = '22023';
            end;

            if v_existing.updated_at = v_expected_revision
               and v_existing.week_number = p_week_number
               and v_existing.session_sequence = p_session_sequence
               and v_existing.status = p_status
               and v_existing.exercise_logs = p_exercise_logs
               and v_existing.cardio_log = p_cardio_log
               and v_existing.movement_log = p_movement_log
               and v_existing.duration_minutes is not distinct from
                   p_duration_minutes
               and v_existing.miss_reason is not distinct from p_miss_reason
            then
                return jsonb_build_object(
                    'workoutLogId', v_existing.id,
                    'programVersion', v_existing.program_version,
                    'updatedAt', v_existing.updated_at,
                    'unchanged', true
                );
            end if;
        end if;
    end if;

    return public.save_workout_log_v5(
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
end;
$$;

revoke all on function public.save_workout_log_v6(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_workout_log_v6(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb, text
) to authenticated;

create or replace function app_private.claim_feedback_digest_impl(
    p_max_reports integer default 25,
    p_max_source_bytes integer default 100000
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_batch_id uuid;
    v_report_count integer;
begin
    if p_max_reports is null or p_max_reports not between 1 and 100
       or p_max_source_bytes is null
       or p_max_source_bytes not between 10000 and 1000000 then
        raise exception 'invalid_feedback_digest_limits'
            using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(731947205, 20260824);

    select batch.id into v_batch_id
    from app_private.feedback_digest_batches as batch
    where batch.status = 'pending'
    order by batch.created_at, batch.id
    limit 1
    for update;

    if v_batch_id is null then
        insert into app_private.feedback_digest_batches default values
        returning id into v_batch_id;

        with candidates as materialized (
            select
                report.id,
                report.created_at,
                pg_catalog.octet_length(report.message)
                    + pg_catalog.octet_length(report.page_path)
                    + pg_catalog.octet_length(report.app_version)
                    + pg_catalog.octet_length(report.client_context::text)
                    + 512 as source_bytes
            from public.feedback_reports as report
            where report.digest_sent_at is null
              and report.digest_batch_id is null
            order by report.created_at, report.id
            limit p_max_reports
        ), sized as (
            select
                candidate.id,
                row_number() over (
                    order by candidate.created_at, candidate.id
                ) as row_number,
                sum(candidate.source_bytes) over (
                    order by candidate.created_at, candidate.id
                ) as cumulative_bytes
            from candidates as candidate
        ), selected as (
            select sized.id
            from sized
            where sized.cumulative_bytes <= p_max_source_bytes
               or sized.row_number = 1
        )
        update public.feedback_reports as report
        set digest_batch_id = v_batch_id
        from selected
        where report.id = selected.id;
        get diagnostics v_report_count = row_count;

        if v_report_count = 0 then
            delete from app_private.feedback_digest_batches
            where id = v_batch_id;
            return jsonb_build_object('batchId', null, 'reports', '[]'::jsonb);
        end if;

        update app_private.feedback_digest_batches
        set report_count = v_report_count
        where id = v_batch_id;
    end if;

    return app_private.feedback_digest_payload(v_batch_id);
end;
$$;

notify pgrst, 'reload schema';
