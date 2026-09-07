-- Let a user deliberately discard an accidentally started or stopped capture
-- without exposing direct table writes to the browser. Five-minute provider
-- buckets are shared health data and are intentionally preserved; a new
-- capture's later start time excludes them from the replacement workout.

create function public.fitness_reset_workout_session(
    p_user_id uuid,
    p_connection_id uuid,
    p_source_session_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
    v_session_id uuid;
begin
    if p_source_session_key is null
       or length(p_source_session_key) not between 1 and 256 then
        raise exception using
            errcode = '22023',
            message = 'The workout session cannot be reset.';
    end if;

    perform app_private.fitness_assert_connection(
        p_user_id,
        p_connection_id,
        false
    );

    select session.id
    into v_session_id
    from public.fitness_workout_sessions as session
    where session.connection_id = p_connection_id
      and session.user_id = p_user_id
      and session.source_session_key = p_source_session_key
    for update;

    if v_session_id is null then
        return false;
    end if;

    delete from public.fitness_hr_samples as sample
    where sample.connection_id = p_connection_id
      and sample.user_id = p_user_id
      and sample.source_session_key = p_source_session_key;

    delete from public.fitness_summaries as summary
    where summary.connection_id = p_connection_id
      and summary.user_id = p_user_id
      and summary.summary_type = 'workout'
      and summary.source_key = p_source_session_key;

    delete from public.fitness_workout_sessions as session
    where session.id = v_session_id
      and session.user_id = p_user_id;

    perform app_private.fitness_audit(
        p_connection_id,
        p_user_id,
        'workout_session_reset',
        'worker',
        jsonb_build_object(
            'sessionId', v_session_id,
            'sourceSessionKey', p_source_session_key
        )
    );

    return true;
end;
$$;

revoke all on function public.fitness_reset_workout_session(uuid, uuid, text)
from public, anon, authenticated;

grant execute on function public.fitness_reset_workout_session(uuid, uuid, text)
to service_role;
