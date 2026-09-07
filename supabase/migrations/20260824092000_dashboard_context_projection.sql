-- The dashboard previously fetched the current payload, workout logs, and
-- reviewed weeks in three Data API requests. Return the same owner-scoped,
-- bounded program context in one request.

create function public.dashboard_program_context(p_program_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
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
                    'exercise_logs', workout.exercise_logs,
                    'cardio_log', workout.cardio_log,
                    'movement_log', workout.movement_log,
                    'duration_minutes', workout.duration_minutes,
                    'miss_reason', workout.miss_reason,
                    'started_at', workout.started_at,
                    'completed_at', workout.completed_at,
                    'updated_at', workout.updated_at
                ) order by workout.week_number,
                           workout.session_sequence,
                           workout.program_version
            )
            from public.workout_logs as workout
            where workout.program_id = program.id
              and workout.user_id = auth.uid()
        ), '[]'::jsonb),
        'reviewedWeeks', coalesce((
            select jsonb_agg(
                review.week_number order by review.week_number
            )
            from public.weekly_reviews as review
            where review.program_id = program.id
              and review.user_id = auth.uid()
        ), '[]'::jsonb)
    )
    from public.programs as program
    where program.id = p_program_id
      and program.user_id = auth.uid();
$$;

revoke all on function public.dashboard_program_context(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.dashboard_program_context(uuid)
to authenticated;

notify pgrst, 'reload schema';
