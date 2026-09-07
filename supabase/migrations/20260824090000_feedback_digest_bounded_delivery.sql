-- Keep digest emails and Edge Function memory bounded. A batch is marked as
-- delivering before the provider request so a crash after Resend accepts the
-- message cannot cause an automatic duplicate after its 24-hour idempotency
-- window. Operational diagnostics surface any such uncertain batch.

alter table app_private.feedback_digest_batches
drop constraint feedback_digest_batches_status_check;

alter table app_private.feedback_digest_batches
add constraint feedback_digest_batches_status_check
check (status in ('pending', 'delivering', 'sent'));

alter table app_private.feedback_digest_batches
add column delivery_started_at timestamptz;

drop function public.claim_feedback_digest();
drop function app_private.claim_feedback_digest_impl();

create function app_private.claim_feedback_digest_impl(
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

        with sized as (
            select report.id,
                   row_number() over (
                       order by report.created_at, report.id
                   ) as row_number,
                   sum(
                       pg_catalog.octet_length(report.message)
                       + pg_catalog.octet_length(report.page_path)
                       + pg_catalog.octet_length(report.app_version)
                       + pg_catalog.octet_length(report.client_context::text)
                       + 512
                   ) over (
                       order by report.created_at, report.id
                   ) as cumulative_bytes
            from public.feedback_reports as report
            where report.digest_sent_at is null
              and report.digest_batch_id is null
        ), selected as (
            select sized.id
            from sized
            where sized.row_number <= p_max_reports
              and (
                  sized.cumulative_bytes <= p_max_source_bytes
                  or sized.row_number = 1
              )
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

create function public.claim_feedback_digest(
    p_max_reports integer default 25,
    p_max_source_bytes integer default 100000
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.claim_feedback_digest_impl(
        p_max_reports,
        p_max_source_bytes
    );
$$;

create function app_private.begin_feedback_digest_delivery_impl(
    p_batch_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    update app_private.feedback_digest_batches
    set status = 'delivering',
        delivery_started_at = now(),
        attempt_count = attempt_count + 1,
        last_error = null
    where id = p_batch_id
      and status = 'pending';
    return found;
end;
$$;

create function public.begin_feedback_digest_delivery(p_batch_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
    select app_private.begin_feedback_digest_delivery_impl(p_batch_id);
$$;

create or replace function app_private.complete_feedback_digest_impl(
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

    if not exists (
        select 1
        from app_private.feedback_digest_batches
        where id = p_batch_id and status in ('delivering', 'sent')
    ) then
        raise exception 'feedback_digest_batch_not_delivering'
            using errcode = '55000';
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
        last_error = null
    where id = p_batch_id
      and status = 'delivering';

    return v_affected;
end;
$$;

create or replace function app_private.fail_feedback_digest_impl(
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
    set status = 'pending',
        delivery_started_at = null,
        last_error = left(coalesce(p_error, 'unknown delivery error'), 1000)
    where id = p_batch_id
      and status = 'delivering';
    return found;
end;
$$;

revoke all on function app_private.claim_feedback_digest_impl(integer, integer)
from public, anon, authenticated, service_role;
revoke all on function public.claim_feedback_digest(integer, integer)
from public, anon, authenticated, service_role;
revoke all on function app_private.begin_feedback_digest_delivery_impl(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.begin_feedback_digest_delivery(uuid)
from public, anon, authenticated, service_role;

grant execute on function app_private.claim_feedback_digest_impl(integer, integer)
to service_role;
grant execute on function public.claim_feedback_digest(integer, integer)
to service_role;
grant execute on function app_private.begin_feedback_digest_delivery_impl(uuid)
to service_role;
grant execute on function public.begin_feedback_digest_delivery(uuid)
to service_role;

notify pgrst, 'reload schema';
