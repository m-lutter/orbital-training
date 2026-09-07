-- Make the intentional feedback-only write surface explicit to both Postgres
-- and the Supabase security advisor. Direct table access remains denied; the
-- exposed RPC is an invoker-rights wrapper over a private, bounded definer.

create policy feedback_reports_deny_direct_access
on public.feedback_reports
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

create function app_private.submit_feedback_impl(
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
volatile
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

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_user_id::text, 840617523)
    );

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

revoke all on function app_private.submit_feedback_impl(
    text, text, boolean, boolean, text, uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function app_private.submit_feedback_impl(
    text, text, boolean, boolean, text, uuid, text, jsonb
) to authenticated;

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
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.submit_feedback_impl(
        p_category,
        p_message,
        p_blocked_user,
        p_may_contact,
        p_page_path,
        p_program_id,
        p_app_version,
        p_client_context
    );
$$;

revoke all on function public.submit_feedback(
    text, text, boolean, boolean, text, uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.submit_feedback(
    text, text, boolean, boolean, text, uuid, text, jsonb
) to authenticated;

notify pgrst, 'reload schema';
