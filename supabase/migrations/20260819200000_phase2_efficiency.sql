-- Phase 2 read-path efficiency.
-- Determine the completion-badge entitlement inside Postgres rather than
-- transferring every owned program and workout log to the application.

create or replace function public.lunar_completion_is_unlocked()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
    with owned_programs as (
        select p.id, p.payload
        from public.programs p
        where auth.uid() is not null
          and p.user_id = auth.uid()
    ),
    planned_sessions as (
        select
            p.id as program_id,
            session_item ->> 'id' as session_id
        from owned_programs p
        cross join lateral jsonb_array_elements(
            coalesce(p.payload #> '{program,weeks}', '[]'::jsonb)
        ) as weeks(week_item)
        cross join lateral jsonb_array_elements(
            coalesce(week_item -> 'sessions', '[]'::jsonb)
        ) as sessions(session_item)
        where session_item ->> 'kind' <> 'movement'
          and nullif(session_item ->> 'id', '') is not null
    )
    select coalesce(exists (
        select 1
        from owned_programs p
        where p.payload #>> '{questionnaireFormValues,programIcon}' =
              'lunar_completion'
           or (
                exists (
                    select 1 from planned_sessions ps
                    where ps.program_id = p.id
                )
                and not exists (
                    select 1
                    from planned_sessions ps
                    where ps.program_id = p.id
                      and coalesce((
                          select wl.status
                          from public.workout_logs wl
                          where wl.user_id = auth.uid()
                            and wl.program_id = ps.program_id
                            and wl.session_id = ps.session_id
                          order by wl.program_version desc, wl.updated_at desc
                          limit 1
                      ), '') <> 'completed'
                )
           )
    ), false);
$$;

revoke all on function public.lunar_completion_is_unlocked()
from public, anon, authenticated, service_role;
grant execute on function public.lunar_completion_is_unlocked()
to authenticated;

notify pgrst, 'reload schema';
