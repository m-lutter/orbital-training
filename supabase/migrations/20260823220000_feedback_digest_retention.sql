-- Daily administrator feedback digest and bounded feedback retention.
--
-- The browser remains unable to read feedback rows. A service-role-only RPC
-- claims one stable batch at a time so retries reuse the same provider
-- idempotency key and overlapping scheduled requests cannot create two emails.

alter table public.feedback_reports
add column digest_batch_id uuid,
add column digest_sent_at timestamptz,
add column digest_email_id text
    check (
        digest_email_id is null
        or char_length(digest_email_id) between 1 and 200
    );

create index feedback_reports_pending_digest_idx
on public.feedback_reports(created_at, id)
where digest_sent_at is null;

create table app_private.feedback_digest_batches (
    id uuid primary key default gen_random_uuid(),
    status text not null default 'pending'
        check (status in ('pending', 'sent')),
    report_count integer not null default 0
        check (report_count >= 0),
    attempt_count integer not null default 0
        check (attempt_count >= 0),
    last_error text,
    provider_email_id text,
    created_at timestamptz not null default now(),
    sent_at timestamptz
);

revoke all on app_private.feedback_digest_batches
from public, anon, authenticated, service_role;

create function app_private.feedback_digest_payload(p_batch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'batchId', batch.id,
        'reports', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', report.id,
                    'userId', report.user_id,
                    'userEmail', case
                        when report.may_contact then app_user.email
                        else null
                    end,
                    'programId', report.program_id,
                    'category', report.category,
                    'message', report.message,
                    'blockedUser', report.blocked_user,
                    'mayContact', report.may_contact,
                    'pagePath', report.page_path,
                    'appVersion', report.app_version,
                    'clientContext', report.client_context,
                    'status', report.status,
                    'createdAt', report.created_at
                ) order by report.created_at, report.id
            )
            from public.feedback_reports as report
            left join auth.users as app_user on app_user.id = report.user_id
            where report.digest_batch_id = batch.id
              and report.digest_sent_at is null
        ), '[]'::jsonb)
    )
    from app_private.feedback_digest_batches as batch
    where batch.id = p_batch_id;
$$;

create function app_private.claim_feedback_digest_impl()
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
    perform pg_catalog.pg_advisory_xact_lock(731947205, 20260823);

    select batch.id into v_batch_id
    from app_private.feedback_digest_batches as batch
    where batch.status = 'pending'
    order by batch.created_at, batch.id
    limit 1
    for update;

    if v_batch_id is null then
        insert into app_private.feedback_digest_batches default values
        returning id into v_batch_id;

        update public.feedback_reports
        set digest_batch_id = v_batch_id
        where digest_sent_at is null
          and digest_batch_id is null;
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

create function public.claim_feedback_digest()
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.claim_feedback_digest_impl();
$$;

create function app_private.complete_feedback_digest_impl(
    p_batch_id uuid,
    p_provider_email_id text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_affected integer;
    v_provider_email_id text := btrim(p_provider_email_id);
begin
    if v_provider_email_id is null
       or char_length(v_provider_email_id) < 1
       or char_length(v_provider_email_id) > 200 then
        raise exception 'invalid_feedback_digest_email_id'
            using errcode = '22023';
    end if;

    update public.feedback_reports
    set digest_sent_at = coalesce(digest_sent_at, now()),
        digest_email_id = coalesce(digest_email_id, v_provider_email_id)
    where digest_batch_id = p_batch_id
      and digest_sent_at is null;
    get diagnostics v_affected = row_count;

    update app_private.feedback_digest_batches
    set status = 'sent',
        provider_email_id = coalesce(provider_email_id, v_provider_email_id),
        sent_at = coalesce(sent_at, now()),
        attempt_count = attempt_count + 1,
        last_error = null
    where id = p_batch_id
      and status = 'pending';

    if not found and not exists (
        select 1
        from app_private.feedback_digest_batches
        where id = p_batch_id and status = 'sent'
    ) then
        raise exception 'feedback_digest_batch_not_found'
            using errcode = 'P0002';
    end if;

    return v_affected;
end;
$$;

create function public.complete_feedback_digest(
    p_batch_id uuid,
    p_provider_email_id text
)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.complete_feedback_digest_impl(
        p_batch_id,
        p_provider_email_id
    );
$$;

create function app_private.fail_feedback_digest_impl(
    p_batch_id uuid,
    p_error text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    update app_private.feedback_digest_batches
    set attempt_count = attempt_count + 1,
        last_error = left(coalesce(p_error, 'unknown delivery error'), 1000)
    where id = p_batch_id
      and status = 'pending';
    return found;
end;
$$;

create function public.fail_feedback_digest(
    p_batch_id uuid,
    p_error text
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.fail_feedback_digest_impl(p_batch_id, p_error);
$$;

create function app_private.delete_expired_feedback_impl(
    p_retention_days integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_deleted integer;
begin
    if p_retention_days is null
       or p_retention_days < 1
       or p_retention_days > 3650 then
        raise exception 'invalid_feedback_retention_days'
            using errcode = '22023';
    end if;

    delete from public.feedback_reports
    where created_at < now() - pg_catalog.make_interval(days => p_retention_days);
    get diagnostics v_deleted = row_count;

    delete from app_private.feedback_digest_batches as batch
    where batch.status = 'sent'
      and batch.sent_at < now() - pg_catalog.make_interval(days => p_retention_days)
      and not exists (
          select 1
          from public.feedback_reports as report
          where report.digest_batch_id = batch.id
      );

    return v_deleted;
end;
$$;

create function public.delete_expired_feedback(p_retention_days integer)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.delete_expired_feedback_impl(p_retention_days);
$$;

revoke all on function app_private.feedback_digest_payload(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.claim_feedback_digest_impl()
from public, anon, authenticated, service_role;
revoke all on function app_private.complete_feedback_digest_impl(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function app_private.fail_feedback_digest_impl(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function app_private.delete_expired_feedback_impl(integer)
from public, anon, authenticated, service_role;
revoke all on function public.claim_feedback_digest()
from public, anon, authenticated, service_role;
revoke all on function public.complete_feedback_digest(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.fail_feedback_digest(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.delete_expired_feedback(integer)
from public, anon, authenticated, service_role;

grant execute on function app_private.feedback_digest_payload(uuid)
to service_role;
grant execute on function app_private.claim_feedback_digest_impl()
to service_role;
grant execute on function app_private.complete_feedback_digest_impl(uuid, text)
to service_role;
grant execute on function app_private.fail_feedback_digest_impl(uuid, text)
to service_role;
grant execute on function app_private.delete_expired_feedback_impl(integer)
to service_role;
grant execute on function public.claim_feedback_digest()
to service_role;
grant execute on function public.complete_feedback_digest(uuid, text)
to service_role;
grant execute on function public.fail_feedback_digest(uuid, text)
to service_role;
grant execute on function public.delete_expired_feedback(integer)
to service_role;

notify pgrst, 'reload schema';
