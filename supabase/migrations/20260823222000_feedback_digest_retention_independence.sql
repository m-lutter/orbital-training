-- Retention must continue even while the email provider is unavailable. If
-- every report in a pending batch has crossed the retention boundary, remove
-- the now-empty batch so later feedback can be claimed normally.

create or replace function app_private.delete_expired_feedback_impl(
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
    where not exists (
        select 1
        from public.feedback_reports as report
        where report.digest_batch_id = batch.id
    );

    return v_deleted;
end;
$$;

revoke all on function app_private.delete_expired_feedback_impl(integer)
from public, anon, authenticated, service_role;
grant execute on function app_private.delete_expired_feedback_impl(integer)
to service_role;
