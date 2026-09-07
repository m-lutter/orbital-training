-- Read-only Supabase/Postgres CPU triage.
-- Run in the Supabase SQL editor during or immediately after an alert.
-- Save aggregate output with the incident record. Do not reset statistics
-- until the baseline has been preserved and the alert window is understood.

begin;
set local transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '2s';

select
    now() as captured_at,
    stats.stats_reset,
    now() - stats.stats_reset as statistics_window,
    stats.numbackends as open_backends,
    stats.xact_commit,
    stats.xact_rollback,
    stats.blks_read,
    stats.blks_hit,
    round(
        stats.blks_hit::numeric
        / greatest(stats.blks_hit + stats.blks_read, 1),
        4
    ) as table_cache_hit_ratio,
    stats.temp_files,
    pg_size_pretty(stats.temp_bytes) as temporary_bytes,
    stats.deadlocks
from pg_catalog.pg_stat_database as stats
where stats.datname = current_database();

-- Cumulative database time: optimize high-total-time application statements
-- before isolated slow statements. Query text is normalized by the extension.
select
    statement.queryid,
    role.rolname as database_role,
    statement.calls,
    round(statement.total_exec_time::numeric, 2) as total_exec_ms,
    round(statement.mean_exec_time::numeric, 2) as mean_exec_ms,
    statement.rows,
    statement.shared_blks_hit,
    statement.shared_blks_read,
    statement.temp_blks_read,
    statement.temp_blks_written,
    left(regexp_replace(statement.query, '\s+', ' ', 'g'), 500)
        as normalized_query
from extensions.pg_stat_statements as statement
join pg_catalog.pg_roles as role on role.oid = statement.userid
where statement.dbid = (
    select oid from pg_catalog.pg_database where datname = current_database()
)
order by statement.total_exec_time desc
limit 25;

-- High call counts reveal polling, preloading, retry loops, health-check
-- mistakes, and direct API abuse even when each individual query is fast.
select
    statement.queryid,
    role.rolname as database_role,
    statement.calls,
    round(statement.total_exec_time::numeric, 2) as total_exec_ms,
    round(statement.mean_exec_time::numeric, 4) as mean_exec_ms,
    left(regexp_replace(statement.query, '\s+', ' ', 'g'), 300)
        as normalized_query
from extensions.pg_stat_statements as statement
join pg_catalog.pg_roles as role on role.oid = statement.userid
where statement.dbid = (
    select oid from pg_catalog.pg_database where datname = current_database()
)
order by statement.calls desc
limit 25;

select
    activity.usename,
    activity.application_name,
    activity.client_addr,
    activity.state,
    activity.wait_event_type,
    activity.wait_event,
    now() - activity.query_start as query_age,
    now() - activity.xact_start as transaction_age,
    left(regexp_replace(activity.query, '\s+', ' ', 'g'), 300) as query
from pg_catalog.pg_stat_activity as activity
where activity.datname = current_database()
  and activity.pid <> pg_backend_pid()
  and activity.state <> 'idle'
order by activity.query_start;

select
    activity.usename,
    activity.application_name,
    activity.state,
    count(*) as connections,
    count(*) filter (where activity.wait_event is not null) as waiting
from pg_catalog.pg_stat_activity as activity
where activity.datname = current_database()
group by activity.usename, activity.application_name, activity.state
order by connections desc;

select
    table_stats.relname as table_name,
    table_stats.n_live_tup as estimated_live_rows,
    table_stats.n_dead_tup as estimated_dead_rows,
    table_stats.seq_scan,
    table_stats.idx_scan,
    table_stats.n_tup_ins,
    table_stats.n_tup_upd,
    table_stats.n_tup_del,
    table_stats.n_tup_hot_upd,
    table_stats.last_autovacuum,
    table_stats.last_autoanalyze,
    pg_size_pretty(pg_total_relation_size(table_stats.relid)) as total_size
from pg_catalog.pg_stat_user_tables as table_stats
where table_stats.schemaname in ('public', 'app_private')
order by pg_total_relation_size(table_stats.relid) desc;

select
    index_stats.schemaname,
    index_stats.relname as table_name,
    index_stats.indexrelname as index_name,
    index_stats.idx_scan,
    index_stats.idx_tup_read,
    index_stats.idx_tup_fetch,
    pg_size_pretty(pg_relation_size(index_stats.indexrelid)) as index_size
from pg_catalog.pg_stat_user_indexes as index_stats
where index_stats.schemaname in ('public', 'app_private')
order by index_stats.idx_scan desc, index_stats.indexrelname;

-- pg_cron is optional and its schema may not exist. If this returns true,
-- inspect Integrations -> Cron in the Dashboard. Do not copy cron.command into
-- an incident record because it can contain headers or credentials.
select
    to_regclass('cron.job') is not null as cron_installed,
    to_regclass('cron.job_run_details') is not null
        as cron_run_history_available;

select
    date_trunc('day', app_user.created_at) as signup_day,
    count(*) as signups
from auth.users as app_user
where app_user.created_at >= now() - interval '30 days'
group by signup_day
order by signup_day desc;

rollback;
