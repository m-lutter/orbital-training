-- Read-only Phase 4 storage and integrity report. Run in the Supabase SQL
-- editor after migration 20260819220000 and after the matching app deploy.

select
    storage_format,
    count(*) as version_rows,
    pg_size_pretty(sum(coalesce(pg_column_size(payload), 0))) as payload_bytes,
    pg_size_pretty(sum(coalesce(pg_column_size(reverse_patch), 0))) as patch_bytes
from public.program_versions
group by storage_format
order by storage_format;

with live as (
    select
        count(*) as programs,
        coalesce(sum(pg_column_size(payload)), 0) as payload_bytes
    from public.programs
), history as (
    select coalesce(sum(
        coalesce(pg_column_size(payload), 0)
        + coalesce(pg_column_size(reverse_patch), 0)
    ), 0) as history_bytes
    from public.program_versions
)
select
    live.programs,
    pg_size_pretty(live.payload_bytes) as live_payload_bytes,
    pg_size_pretty(history.history_bytes) as durable_history_bytes,
    pg_size_pretty(
        live.payload_bytes + history.history_bytes
    ) as combined_program_and_history_bytes
from live cross join history;

-- Expected after the matching app has created or changed every listed current
-- program: zero rows. A full_v3 current row is safe and normally means an
-- older app build wrote it; the next compact write will normalize it.
select
    program_row.id,
    program_row.name,
    program_row.payload #>> '{program,version}' as current_version,
    version_row.storage_format,
    version_row.payload is not null as has_duplicate_current_payload
from public.programs program_row
left join public.program_versions version_row
    on version_row.program_id = program_row.id
   and version_row.version_number::text =
       program_row.payload #>> '{program,version}'
where version_row.id is null
   or version_row.storage_format <> 'current_anchor_v1'
   or version_row.payload is not null;

-- Expected: zero rows. This checks hashes wherever the full value is locally
-- available. Reverse-patch reconstruction is covered by application tests.
select
    version_row.program_id,
    version_row.version_number,
    version_row.storage_format,
    'hash_mismatch' as issue
from public.program_versions version_row
where version_row.payload is not null
  and version_row.payload_hash <> md5(version_row.payload::text)
union all
select
    version_row.program_id,
    version_row.version_number,
    version_row.storage_format,
    'current_anchor_hash_mismatch' as issue
from public.program_versions version_row
join public.programs program_row on program_row.id = version_row.program_id
where version_row.storage_format = 'current_anchor_v1'
  and version_row.version_number::text =
      program_row.payload #>> '{program,version}'
  and version_row.payload_hash <> md5(program_row.payload::text);
