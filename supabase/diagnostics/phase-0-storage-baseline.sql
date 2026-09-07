-- Phase 0 production storage baseline.
--
-- This is a read-only diagnostic, not a migration. Run the whole file in the
-- Supabase SQL editor against the environment you want to measure. It returns
-- one result table so the editor does not leave you looking only at the final
-- pg_stat_statements check. It scans application tables, so run it off-peak
-- once the database becomes large.

begin transaction read only;
set local statement_timeout = '30s';

with
app_tables(table_name) as (
    values
        ('profiles'),
        ('programs'),
        ('questionnaire_responses'),
        ('program_versions'),
        ('workout_logs'),
        ('weekly_reviews'),
        ('feedback_reports')
),
relation_metrics as (
    select
        table_name,
        pg_relation_size(format('public.%I', table_name)::regclass) as table_bytes,
        pg_indexes_size(format('public.%I', table_name)::regclass) as index_bytes,
        pg_total_relation_size(format('public.%I', table_name)::regclass) as total_bytes
    from app_tables
),
payload_sizes as (
    select 'programs.payload' as field, pg_column_size(payload)::bigint as bytes
    from public.programs
    union all
    select 'questionnaire_responses.response', pg_column_size(response)::bigint
    from public.questionnaire_responses
    union all
    select 'program_versions.payload', pg_column_size(payload)::bigint
    from public.program_versions
    union all
    select
        'workout_logs.exercise_logs+cardio_log',
        (pg_column_size(exercise_logs) + pg_column_size(cardio_log))::bigint
    from public.workout_logs
    union all
    select
        'weekly_reviews.metrics+result',
        (pg_column_size(metrics) + pg_column_size(result))::bigint
    from public.weekly_reviews
    union all
    select 'feedback_reports.client_context', pg_column_size(client_context)::bigint
    from public.feedback_reports
),
payload_metrics as (
    select
        field,
        count(*)::bigint as rows,
        round(avg(bytes))::bigint as average_bytes,
        (percentile_cont(0.95) within group (order by bytes))::bigint as p95_bytes,
        max(bytes) as maximum_bytes,
        sum(bytes) as total_logical_bytes
    from payload_sizes
    group by field
),
per_program_versions as (
    select
        program_id,
        count(*)::bigint as versions,
        sum(pg_column_size(payload))::bigint as payload_bytes
    from public.program_versions
    group by program_id
),
version_metrics as (
    select
        count(*)::bigint as programs_with_versions,
        coalesce(round(avg(versions), 2), 0) as average_versions_per_program,
        coalesce(max(versions), 0) as maximum_versions_per_program,
        coalesce(round(avg(payload_bytes))::bigint, 0) as average_version_bytes_per_program,
        coalesce(
            (percentile_cont(0.95) within group (order by payload_bytes))::bigint,
            0
        ) as p95_version_bytes_per_program,
        coalesce(max(payload_bytes), 0) as maximum_version_bytes_per_program,
        coalesce(sum(payload_bytes), 0) as total_version_payload_bytes
    from per_program_versions
),
table_activity as (
    select
        relname as table_name,
        n_live_tup as estimated_live_rows,
        seq_scan,
        seq_tup_read,
        idx_scan,
        n_tup_ins,
        n_tup_upd,
        n_tup_del
    from pg_stat_user_tables
    where schemaname = 'public'
      and relname in (select table_name from app_tables)
),
index_activity as (
    select
        relname as table_name,
        indexrelname as index_name,
        idx_scan,
        pg_relation_size(indexrelid) as index_bytes
    from pg_stat_user_indexes
    where schemaname = 'public'
      and relname in (select table_name from app_tables)
),
combined as (
    select
        '01_relation_size'::text as section,
        table_name::text as metric,
        jsonb_build_object(
            'table_bytes', table_bytes,
            'table_size', pg_size_pretty(table_bytes),
            'index_bytes', index_bytes,
            'index_size', pg_size_pretty(index_bytes),
            'total_bytes', total_bytes,
            'total_size', pg_size_pretty(total_bytes)
        ) as details
    from relation_metrics

    union all

    select
        '02_json_payload_size',
        field,
        jsonb_build_object(
            'rows', rows,
            'average_bytes', average_bytes,
            'p95_bytes', p95_bytes,
            'maximum_bytes', maximum_bytes,
            'total_logical_bytes', total_logical_bytes
        )
    from payload_metrics

    union all

    select
        '03_version_amplification',
        'all_programs',
        to_jsonb(version_metrics)
    from version_metrics

    union all

    select
        '04_table_activity',
        table_name,
        jsonb_build_object(
            'estimated_live_rows', estimated_live_rows,
            'sequential_scans', seq_scan,
            'sequential_rows_read', seq_tup_read,
            'index_scans', idx_scan,
            'rows_inserted', n_tup_ins,
            'rows_updated', n_tup_upd,
            'rows_deleted', n_tup_del
        )
    from table_activity

    union all

    select
        '05_index_activity',
        table_name || '.' || index_name,
        jsonb_build_object(
            'index_scans', idx_scan,
            'index_bytes', index_bytes,
            'index_size', pg_size_pretty(index_bytes)
        )
    from index_activity

    union all

    select
        '06_extension',
        'pg_stat_statements',
        jsonb_build_object(
            'enabled', exists (
                select 1
                from pg_extension
                where extname = 'pg_stat_statements'
            )
        )
)
select section, metric, details
from combined
order by section, metric;

commit;
