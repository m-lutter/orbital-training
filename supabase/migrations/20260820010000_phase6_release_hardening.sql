-- Phase 6 release hardening.
--
-- Feedback submissions are serialized per user so concurrent requests cannot
-- race past the existing duplicate and rate-limit checks. Authenticated users
-- also gain explicit, narrowly scoped export and account-deletion RPCs. The
-- private implementations keep elevated operations out of the exposed schema.

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

    -- The transaction-scoped lock is unique to this user. It prevents two
    -- simultaneous requests from both observing the same pre-insert count.
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

revoke all on function public.submit_feedback(
    text, text, boolean, boolean, text, uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.submit_feedback(
    text, text, boolean, boolean, text, uuid, text, jsonb
) to authenticated;

create function app_private.export_my_feedback_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_feedback jsonb;
begin
    if v_user_id is null then
        raise exception 'authentication_required' using errcode = '42501';
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'id', report.id,
                'program_id', report.program_id,
                'category', report.category,
                'message', report.message,
                'blocked_user', report.blocked_user,
                'may_contact', report.may_contact,
                'page_path', report.page_path,
                'app_version', report.app_version,
                'client_context', report.client_context,
                'status', report.status,
                'created_at', report.created_at,
                'resolved_at', report.resolved_at
            ) order by report.created_at, report.id
        ),
        '[]'::jsonb
    ) into v_feedback
    from public.feedback_reports as report
    where report.user_id = v_user_id;

    return v_feedback;
end;
$$;

revoke all on function app_private.export_my_feedback_impl()
from public, anon, authenticated, service_role;
grant execute on function app_private.export_my_feedback_impl()
to authenticated;

create function public.export_my_feedback()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select app_private.export_my_feedback_impl();
$$;

revoke all on function public.export_my_feedback()
from public, anon, authenticated, service_role;
grant execute on function public.export_my_feedback()
to authenticated;

create function app_private.delete_my_account_impl()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'authentication_required' using errcode = '42501';
    end if;

    -- Every user-owned table references auth.users with ON DELETE CASCADE.
    -- feedback_reports.program_id uses SET NULL, but its user_id cascade still
    -- removes the report when the owning account is deleted.
    delete from auth.users where id = v_user_id;
    if not found then
        raise exception 'account_not_found' using errcode = 'P0002';
    end if;

    return true;
end;
$$;

revoke all on function app_private.delete_my_account_impl()
from public, anon, authenticated, service_role;
grant execute on function app_private.delete_my_account_impl()
to authenticated;

create function public.delete_my_account()
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.delete_my_account_impl();
$$;

revoke all on function public.delete_my_account()
from public, anon, authenticated, service_role;
grant execute on function public.delete_my_account()
to authenticated;

notify pgrst, 'reload schema';
