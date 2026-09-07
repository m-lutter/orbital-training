-- Read-only Supabase/Postgres memory-pressure triage.
-- Run in the Supabase SQL editor while an alert is active and again after the
-- workload has been quiet for 24 hours. The dashboard remains authoritative
-- for physical RAM, cache/buffers, swap, and Linux memory commitment.

begin;
set local transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '2s';

-- These settings define potential per-instance and per-operation allocation.
-- Work memory can be allocated more than once by one query plan and by every
-- concurrent backend, so do not raise it to address an alert.
select
    setting.name,
    setting.setting,
    setting.unit,
    setting.source
from pg_catalog.pg_settings as setting
where setting.name in (
    'max_connections',
    'shared_buffers',
    'work_mem',
    'maintenance_work_mem',
    'temp_buffers',
    'statement_timeout',
    'lock_timeout',
    'idle_in_transaction_session_timeout'
)
order by setting.name;

-- Connection count is the most actionable SQL-side memory proxy. Pay special
-- attention to active and idle-in-transaction sessions, not ordinary pooled
-- idle connections alone.
select
    activity.backend_type,
    activity.usename as database_role,
    nullif(activity.application_name, '') as application_name,
    activity.state,
    activity.wait_event_type,
    activity.wait_event,
    count(*) as connections,
    max(now() - activity.backend_start) as oldest_connection_age,
    max(now() - activity.xact_start)
        filter (where activity.xact_start is not null)
        as oldest_transaction_age
from pg_catalog.pg_stat_activity as activity
where activity.datname = current_database()
group by
    activity.backend_type,
    activity.usename,
    nullif(activity.application_name, ''),
    activity.state,
    activity.wait_event_type,
    activity.wait_event
order by connections desc, database_role, application_name;

-- Sessions needing immediate investigation. Long idle transactions retain
-- snapshots; blocked/long queries retain a connection and query working state.
select
    activity.pid,
    activity.usename as database_role,
    activity.application_name,
    activity.state,
    activity.wait_event_type,
    activity.wait_event,
    now() - activity.query_start as query_age,
    now() - activity.xact_start as transaction_age,
    pg_catalog.pg_blocking_pids(activity.pid) as blocked_by,
    left(regexp_replace(activity.query, '\s+', ' ', 'g'), 400)
        as normalized_query
from pg_catalog.pg_stat_activity as activity
where activity.datname = current_database()
  and activity.pid <> pg_backend_pid()
  and (
      activity.state in ('idle in transaction', 'idle in transaction (aborted)')
      or pg_catalog.cardinality(pg_catalog.pg_blocking_pids(activity.pid)) > 0
      or (
          activity.state = 'active'
          and activity.query_start < now() - interval '5 seconds'
      )
  )
order by coalesce(activity.xact_start, activity.query_start);

-- Temp-file growth indicates sorts/hashes that exceeded memory. Compare the
-- delta across equivalent quiet/peak windows instead of resetting statistics.
select
    now() as captured_at,
    database_stats.stats_reset,
    database_stats.numbackends as open_backends,
    database_stats.temp_files,
    database_stats.temp_bytes,
    pg_catalog.pg_size_pretty(database_stats.temp_bytes) as temporary_bytes,
    database_stats.deadlocks,
    database_stats.blks_read,
    database_stats.blks_hit,
    round(
        database_stats.blks_hit::numeric
        / greatest(database_stats.blks_hit + database_stats.blks_read, 1),
        4
    ) as cache_hit_ratio
from pg_catalog.pg_stat_database as database_stats
where database_stats.datname = current_database();

select
    statement.queryid,
    role.rolname as database_role,
    statement.calls,
    round(statement.total_exec_time::numeric, 2) as total_exec_ms,
    round(statement.mean_exec_time::numeric, 2) as mean_exec_ms,
    statement.temp_blks_read,
    statement.temp_blks_written,
    left(regexp_replace(statement.query, '\s+', ' ', 'g'), 400)
        as normalized_query
from extensions.pg_stat_statements as statement
join pg_catalog.pg_roles as role on role.oid = statement.userid
where statement.dbid = (
    select oid
    from pg_catalog.pg_database
    where datname = current_database()
)
  and (statement.temp_blks_read > 0 or statement.temp_blks_written > 0)
order by statement.temp_blks_written desc, statement.temp_blks_read desc
limit 25;

-- Remove unused extensions only after checking their owners and dependencies.
select
    namespace.nspname as extension_schema,
    extension.extname,
    extension.extversion
from pg_catalog.pg_extension as extension
join pg_catalog.pg_namespace as namespace
  on namespace.oid = extension.extnamespace
order by extension.extname;

rollback;
