-- Phase 6 read-only operational checks.
-- Run in the Supabase SQL editor. This script returns metadata and aggregate
-- counts only; it does not return workout content or modify any rows.

select
    table_name,
    pg_size_pretty(pg_total_relation_size(format('public.%I', table_name)))
        as total_size,
    pg_total_relation_size(format('public.%I', table_name)) as total_bytes
from (values
    ('profiles'),
    ('programs'),
    ('questionnaire_responses'),
    ('program_versions'),
    ('workout_logs'),
    ('weekly_reviews'),
    ('feedback_reports')
) as owned_tables(table_name)
order by total_bytes desc;

select 'profiles' as table_name, count(*) as rows from public.profiles
union all
select 'programs', count(*) from public.programs
union all
select 'questionnaire_responses', count(*)
from public.questionnaire_responses
union all
select 'program_versions', count(*) from public.program_versions
union all
select 'workout_logs', count(*) from public.workout_logs
union all
select 'weekly_reviews', count(*) from public.weekly_reviews
union all
select 'feedback_reports', count(*) from public.feedback_reports
order by table_name;

select
    storage_format,
    count(*) as versions,
    pg_size_pretty(sum(
        coalesce(pg_column_size(payload), 0)
        + coalesce(pg_column_size(reverse_patch), 0)
    )) as stored_history_size
from public.program_versions
group by storage_format
order by storage_format;

select
    count(*) as programs,
    pg_size_pretty(avg(pg_column_size(payload))::bigint)
        as average_program_payload,
    pg_size_pretty(max(pg_column_size(payload))) as largest_program_payload,
    count(*) filter (where pg_column_size(payload) > 524288)
        as programs_over_512_kib
from public.programs;

select
    pg_size_pretty(coalesce(sum(pg_column_size(version.payload)), 0))
        as full_snapshot_bytes,
    pg_size_pretty(coalesce(sum(pg_column_size(version.reverse_patch)), 0))
        as reverse_patch_bytes,
    round(
        coalesce(sum(pg_column_size(version.payload)), 0)::numeric
        / greatest(
            coalesce(sum(pg_column_size(version.reverse_patch)), 0),
            1
        ),
        2
    ) as snapshot_to_patch_ratio
from public.program_versions as version;

select
    count(*) as planned_workout_sessions,
    pg_size_pretty(avg(pg_column_size(session.session_item))::bigint)
        as average_session_projection,
    pg_size_pretty(max(pg_column_size(session.session_item)))
        as largest_session_projection,
    count(*) filter (where pg_column_size(session.session_item) > 51200)
        as sessions_over_50_kib
from public.programs as program
cross join lateral jsonb_array_elements(
    coalesce(program.payload #> '{program,weeks}', '[]'::jsonb)
) as week(week_item)
cross join lateral jsonb_array_elements(
    coalesce(week.week_item -> 'sessions', '[]'::jsonb)
) as session(session_item)
where session.session_item ->> 'kind' <> 'movement';

select
    relname as table_name,
    seq_scan,
    idx_scan,
    n_live_tup as estimated_live_rows,
    n_dead_tup as estimated_dead_rows,
    last_analyze,
    last_autoanalyze
from pg_catalog.pg_stat_user_tables
where schemaname = 'public'
  and relname in (
      'programs', 'program_versions', 'workout_logs', 'weekly_reviews',
      'feedback_reports'
  )
order by relname;

select
    status,
    count(*) as reports,
    count(*) filter (
        where created_at < now() - interval '180 days'
    ) as older_than_180_days
from public.feedback_reports
group by status
order by status;

select
    count(*) filter (where resolved_at is null) as unresolved_reports,
    count(*) filter (where digest_sent_at is null) as not_yet_emailed,
    min(created_at) filter (
        where digest_sent_at is null
    ) as oldest_not_yet_emailed_at,
    count(*) filter (
        where status = 'closed'
          and created_at < now() - interval '90 days'
    ) as closed_reports_beyond_retention_window
from public.feedback_reports;

select
    status,
    count(*) as digest_batches,
    max(created_at) as latest_batch_created_at,
    max(sent_at) as latest_batch_sent_at,
    max(last_error) filter (where status = 'pending') as latest_pending_error,
    count(*) filter (
        where status = 'delivering'
          and delivery_started_at < now() - interval '2 hours'
    ) as delivery_uncertain_over_2_hours
from app_private.feedback_digest_batches
group by status
order by status;
