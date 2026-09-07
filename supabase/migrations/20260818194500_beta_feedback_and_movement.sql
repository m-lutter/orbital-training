-- Open-beta feedback is intentionally small and text-only. Authenticated users
-- submit through a bounded RPC so the table cannot be filled by direct client
-- inserts that bypass rate, length, or ownership checks.

create table public.feedback_reports (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    program_id uuid references public.programs(id) on delete set null,
    category text not null
        check (category in ('bug', 'confusing', 'idea', 'other')),
    message text not null
        check (char_length(message) between 20 and 4000),
    blocked_user boolean not null default false,
    may_contact boolean not null default true,
    page_path text not null
        check (char_length(page_path) between 1 and 300),
    app_version text not null
        check (char_length(app_version) between 1 and 50),
    client_context jsonb not null default '{}'::jsonb
        check (jsonb_typeof(client_context) = 'object')
        check (pg_column_size(client_context) <= 8192),
    status text not null default 'new'
        check (status in ('new', 'reviewing', 'planned', 'resolved', 'closed')),
    created_at timestamptz not null default now(),
    resolved_at timestamptz
);

create index feedback_reports_user_created_idx
on public.feedback_reports(user_id, created_at desc);

create index feedback_reports_status_created_idx
on public.feedback_reports(status, created_at desc);

alter table public.feedback_reports enable row level security;

-- There are deliberately no client table policies. The submission function
-- below is the only authenticated write path; project administrators continue
-- to have normal dashboard/service-role access.
revoke all on public.feedback_reports from anon, authenticated;

create or replace function public.submit_feedback(
    p_category text,
    p_message text,
    p_blocked_user boolean,
    p_may_contact boolean,
    p_page_path text,
    p_program_id uuid default null,
    p_app_version text default 'unknown',
    p_client_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_message text := btrim(p_message);
    v_existing_id uuid;
    v_report_id uuid;
begin
    if v_user_id is null then
        raise exception 'authentication_required' using errcode = '42501';
    end if;
    if p_category not in ('bug', 'confusing', 'idea', 'other') then
        raise exception 'invalid_feedback_category' using errcode = '22023';
    end if;
    if char_length(v_message) < 20 or char_length(v_message) > 4000 then
        raise exception 'invalid_feedback_length' using errcode = '22023';
    end if;
    if char_length(p_page_path) < 1 or char_length(p_page_path) > 300 then
        raise exception 'invalid_feedback_page' using errcode = '22023';
    end if;
    if char_length(p_app_version) < 1 or char_length(p_app_version) > 50 then
        raise exception 'invalid_feedback_version' using errcode = '22023';
    end if;
    if jsonb_typeof(p_client_context) <> 'object'
       or pg_column_size(p_client_context) > 8192 then
        raise exception 'invalid_feedback_context' using errcode = '22023';
    end if;
    if p_program_id is not null and not exists (
        select 1
        from public.programs
        where id = p_program_id and user_id = v_user_id
    ) then
        raise exception 'feedback_program_not_owned' using errcode = '42501';
    end if;

    if (
        select count(*)
        from public.feedback_reports
        where user_id = v_user_id
          and created_at >= now() - interval '15 minutes'
    ) >= 5 or (
        select count(*)
        from public.feedback_reports
        where user_id = v_user_id
          and created_at >= now() - interval '24 hours'
    ) >= 20 then
        raise exception 'feedback_rate_limited' using errcode = 'P0001';
    end if;

    select id into v_existing_id
    from public.feedback_reports
    where user_id = v_user_id
      and category = p_category
      and message = v_message
      and page_path = p_page_path
      and created_at >= now() - interval '5 minutes'
    order by created_at desc
    limit 1;

    if v_existing_id is not null then
        return v_existing_id;
    end if;

    insert into public.feedback_reports (
        user_id,
        program_id,
        category,
        message,
        blocked_user,
        may_contact,
        page_path,
        app_version,
        client_context
    ) values (
        v_user_id,
        p_program_id,
        p_category,
        v_message,
        coalesce(p_blocked_user, false),
        coalesce(p_may_contact, true),
        p_page_path,
        p_app_version,
        p_client_context
    ) returning id into v_report_id;

    return v_report_id;
end;
$$;

revoke all on function public.submit_feedback(
    text, text, boolean, boolean, text, uuid, text, jsonb
) from public;
grant execute on function public.submit_feedback(
    text, text, boolean, boolean, text, uuid, text, jsonb
) to authenticated;

-- Movement check-ins belong to a workout observation but remain separate from
-- formal cardio. The JSON object is bounded by the server parser and can be
-- extended without rewriting prior workout rows.
alter table public.workout_logs
add column movement_log jsonb not null default '{}'::jsonb
    check (jsonb_typeof(movement_log) = 'object')
    check (pg_column_size(movement_log) <= 4096);

create or replace function public.workout_logging_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select jsonb_build_object(
        'ready', true,
        'workoutLogVersion', 2,
        'migration', '20260818194500_beta_feedback_and_movement'
    );
$$;

revoke all on function public.workout_logging_status() from public;
grant execute on function public.workout_logging_status() to authenticated;

notify pgrst, 'reload schema';

