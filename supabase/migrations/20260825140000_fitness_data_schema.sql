-- Provider-neutral fitness data storage. OAuth/device transport is intentionally
-- outside this migration; only normalized, bounded records reach public tables.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
-- Existing authenticated public wrappers resolve their separately revoked
-- app_private implementations at function startup. USAGE reveals no rows and
-- grants no EXECUTE privilege, but removing it breaks those hardened wrappers.
grant usage on schema app_private to authenticated;

create table public.fitness_connections (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    provider text not null,
    status text not null default 'active',
    scopes text[] not null default '{}'::text[],
    consent_version text not null,
    device_key_hash text,
    connected_at timestamptz not null default now(),
    disconnected_at timestamptz,
    last_synced_at timestamptz,
    last_error_code text,
    generation integer not null default 1,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint fitness_connections_owner_key unique (id, user_id),
    constraint fitness_connections_provider_key unique (user_id, provider),
    constraint fitness_connections_provider_format check (
        provider = lower(provider)
        and provider ~ '^[a-z][a-z0-9_]{1,31}$'
    ),
    constraint fitness_connections_status_check check (
        status in ('active', 'error', 'disconnected')
    ),
    constraint fitness_connections_scope_limit check (
        cardinality(scopes) <= 32
        and array_position(scopes, null) is null
        and pg_column_size(scopes) <= 4096
    ),
    constraint fitness_connections_consent_version_limit check (
        length(consent_version) between 1 and 64
    ),
    constraint fitness_connections_device_key_hash_limit check (
        device_key_hash is null or length(device_key_hash) = 64
    ),
    constraint fitness_connections_error_code_limit check (
        last_error_code is null or length(last_error_code) <= 128
    ),
    constraint fitness_connections_generation_check check (generation > 0),
    constraint fitness_connections_metadata_shape check (
        jsonb_typeof(metadata) = 'object'
        and pg_column_size(metadata) <= 8192
    ),
    constraint fitness_connections_disconnect_state check (
        (status = 'disconnected' and disconnected_at is not null)
        or (status <> 'disconnected' and disconnected_at is null)
    )
);

create index fitness_connections_user_status_idx
on public.fitness_connections (user_id, status, updated_at desc);

create table public.fitness_daily_metrics (
    id uuid primary key default gen_random_uuid(),
    connection_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    metric_date date not null,
    timezone text,
    resting_heart_rate smallint,
    hrv_rmssd_ms numeric(9, 2),
    sleep_start_at timestamptz,
    sleep_end_at timestamptz,
    sleep_minutes smallint,
    sleep_stages jsonb not null default '{}'::jsonb,
    sleep_score numeric(6, 2),
    recovery_score numeric(6, 2),
    strain_score numeric(7, 3),
    steps integer,
    active_calories integer,
    distance_meters integer,
    active_minutes smallint,
    respiratory_rate numeric(6, 2),
    spo2_percent numeric(5, 2),
    extensions jsonb not null default '{}'::jsonb,
    source_updated_at timestamptz,
    ingested_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint fitness_daily_metrics_connection_owner_fk
        foreign key (connection_id, user_id)
        references public.fitness_connections(id, user_id)
        on delete cascade,
    constraint fitness_daily_metrics_source_key unique (connection_id, metric_date),
    constraint fitness_daily_metrics_timezone_limit check (
        timezone is null or length(timezone) <= 64
    ),
    constraint fitness_daily_metrics_resting_hr_check check (
        resting_heart_rate is null or resting_heart_rate between 20 and 300
    ),
    constraint fitness_daily_metrics_hrv_check check (
        hrv_rmssd_ms is null or hrv_rmssd_ms between 0 and 10000
    ),
    constraint fitness_daily_metrics_sleep_check check (
        (sleep_minutes is null or sleep_minutes between 0 and 1440)
        and (
            sleep_start_at is null
            or sleep_end_at is null
            or sleep_end_at >= sleep_start_at
        )
        and jsonb_typeof(sleep_stages) = 'object'
        and pg_column_size(sleep_stages) <= 2048
    ),
    constraint fitness_daily_metrics_scores_check check (
        (sleep_score is null or sleep_score between 0 and 100)
        and (recovery_score is null or recovery_score between 0 and 100)
        and (strain_score is null or strain_score between 0 and 100)
    ),
    constraint fitness_daily_metrics_activity_check check (
        (steps is null or steps between 0 and 1000000)
        and (active_calories is null or active_calories between 0 and 100000)
        and (distance_meters is null or distance_meters between 0 and 1000000)
        and (active_minutes is null or active_minutes between 0 and 1440)
    ),
    constraint fitness_daily_metrics_vitals_check check (
        (respiratory_rate is null or respiratory_rate between 1 and 100)
        and (spo2_percent is null or spo2_percent between 50 and 100)
    ),
    constraint fitness_daily_metrics_extensions_shape check (
        jsonb_typeof(extensions) = 'object'
        and pg_column_size(extensions) <= 8192
    )
);

create index fitness_daily_metrics_user_date_idx
on public.fitness_daily_metrics (user_id, metric_date desc);

create table public.fitness_workout_sessions (
    id uuid primary key default gen_random_uuid(),
    connection_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    source_session_key text not null,
    workout_log_id uuid references public.workout_logs(id) on delete set null,
    workout_type text not null,
    started_at timestamptz not null,
    ended_at timestamptz,
    duration_seconds integer,
    average_heart_rate smallint,
    maximum_heart_rate smallint,
    active_calories integer,
    distance_meters integer,
    strain_score numeric(7, 3),
    metadata jsonb not null default '{}'::jsonb,
    summary jsonb not null default '{}'::jsonb,
    source_updated_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint fitness_workout_sessions_owner_key unique (id, user_id),
    constraint fitness_workout_sessions_connection_owner_fk
        foreign key (connection_id, user_id)
        references public.fitness_connections(id, user_id)
        on delete cascade,
    constraint fitness_workout_sessions_source_key
        unique (connection_id, source_session_key),
    constraint fitness_workout_sessions_source_key_limit check (
        length(source_session_key) between 1 and 256
    ),
    constraint fitness_workout_sessions_type_limit check (
        length(workout_type) between 1 and 64
    ),
    constraint fitness_workout_sessions_time_check check (
        ended_at is null or ended_at >= started_at
    ),
    constraint fitness_workout_sessions_duration_check check (
        duration_seconds is null or duration_seconds between 0 and 172800
    ),
    constraint fitness_workout_sessions_hr_check check (
        (average_heart_rate is null or average_heart_rate between 20 and 300)
        and (maximum_heart_rate is null or maximum_heart_rate between 20 and 300)
        and (
            average_heart_rate is null
            or maximum_heart_rate is null
            or maximum_heart_rate >= average_heart_rate
        )
    ),
    constraint fitness_workout_sessions_activity_check check (
        (active_calories is null or active_calories between 0 and 100000)
        and (distance_meters is null or distance_meters between 0 and 1000000)
        and (strain_score is null or strain_score between 0 and 100)
    ),
    constraint fitness_workout_sessions_metadata_shape check (
        jsonb_typeof(metadata) = 'object'
        and pg_column_size(metadata) <= 8192
    ),
    constraint fitness_workout_sessions_summary_shape check (
        jsonb_typeof(summary) = 'object'
        and pg_column_size(summary) <= 16384
    )
);

create index fitness_workout_sessions_user_started_idx
on public.fitness_workout_sessions (user_id, started_at desc);

create index fitness_workout_sessions_connection_time_idx
on public.fitness_workout_sessions (connection_id, started_at desc);

create table public.fitness_hr_samples (
    connection_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    sampled_at timestamptz not null,
    bpm smallint not null,
    source_record_id text,
    source_session_key text,
    quality smallint,
    ingested_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '7 days'),
    primary key (connection_id, sampled_at),
    constraint fitness_hr_samples_connection_owner_fk
        foreign key (connection_id, user_id)
        references public.fitness_connections(id, user_id)
        on delete cascade,
    constraint fitness_hr_samples_bpm_check check (bpm between 20 and 300),
    constraint fitness_hr_samples_record_id_limit check (
        source_record_id is null or length(source_record_id) <= 256
    ),
    constraint fitness_hr_samples_session_key_limit check (
        source_session_key is null or length(source_session_key) <= 256
    ),
    constraint fitness_hr_samples_quality_check check (
        quality is null or quality between 0 and 100
    ),
    constraint fitness_hr_samples_expiry_check check (expires_at > ingested_at)
);

create index fitness_hr_samples_user_time_idx
on public.fitness_hr_samples (user_id, sampled_at desc);

create index fitness_hr_samples_expiry_idx
on public.fitness_hr_samples (expires_at);

create table public.fitness_hr_5m (
    connection_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    bucket_start timestamptz not null,
    minimum_bpm smallint not null,
    maximum_bpm smallint not null,
    average_bpm numeric(6, 2) not null,
    sample_count integer,
    source text not null default 'raw',
    updated_at timestamptz not null default now(),
    primary key (connection_id, bucket_start),
    constraint fitness_hr_5m_connection_owner_fk
        foreign key (connection_id, user_id)
        references public.fitness_connections(id, user_id)
        on delete cascade,
    constraint fitness_hr_5m_alignment_check check (
        mod(floor(extract(epoch from bucket_start))::bigint, 300) = 0
    ),
    constraint fitness_hr_5m_hr_check check (
        minimum_bpm between 20 and 300
        and maximum_bpm between 20 and 300
        and average_bpm between 20 and 300
        and maximum_bpm >= minimum_bpm
        and average_bpm between minimum_bpm and maximum_bpm
    ),
    constraint fitness_hr_5m_count_check check (
        sample_count is null or sample_count between 1 and 10000
    ),
    constraint fitness_hr_5m_source_check check (source in ('raw', 'provider'))
);

create index fitness_hr_5m_user_time_idx
on public.fitness_hr_5m (user_id, bucket_start desc);

create index fitness_hr_5m_retention_idx
on public.fitness_hr_5m (bucket_start);

create table public.fitness_workout_summaries (
    id uuid primary key default gen_random_uuid(),
    connection_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    source_workout_id text not null,
    workout_type text not null,
    started_at timestamptz not null,
    ended_at timestamptz not null,
    average_heart_rate smallint,
    maximum_heart_rate smallint,
    heart_rate_zones jsonb not null default '{}'::jsonb,
    distance_meters integer,
    strain_score numeric(7, 3),
    active_calories integer,
    extensions jsonb not null default '{}'::jsonb,
    source_updated_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint fitness_workout_summaries_connection_owner_fk
        foreign key (connection_id, user_id)
        references public.fitness_connections(id, user_id)
        on delete cascade,
    constraint fitness_workout_summaries_source_key
        unique (connection_id, source_workout_id),
    constraint fitness_workout_summaries_source_id_limit check (
        length(source_workout_id) between 1 and 256
    ),
    constraint fitness_workout_summaries_type_limit check (
        length(workout_type) between 1 and 64
    ),
    constraint fitness_workout_summaries_time_check check (
        ended_at >= started_at
        and ended_at <= started_at + interval '7 days'
    ),
    constraint fitness_workout_summaries_hr_check check (
        (average_heart_rate is null or average_heart_rate between 20 and 300)
        and (maximum_heart_rate is null or maximum_heart_rate between 20 and 300)
        and (
            average_heart_rate is null
            or maximum_heart_rate is null
            or maximum_heart_rate >= average_heart_rate
        )
    ),
    constraint fitness_workout_summaries_activity_check check (
        (distance_meters is null or distance_meters between 0 and 10000000)
        and (strain_score is null or strain_score between 0 and 100)
        and (active_calories is null or active_calories between 0 and 100000)
    ),
    constraint fitness_workout_summaries_zones_shape check (
        jsonb_typeof(heart_rate_zones) = 'object'
        and pg_column_size(heart_rate_zones) <= 8192
    ),
    constraint fitness_workout_summaries_extensions_shape check (
        jsonb_typeof(extensions) = 'object'
        and pg_column_size(extensions) <= 8192
    )
);

create index fitness_workout_summaries_user_started_idx
on public.fitness_workout_summaries (user_id, started_at desc);

create table public.fitness_summaries (
    id uuid primary key default gen_random_uuid(),
    connection_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    summary_type text not null,
    source_key text not null,
    period_start timestamptz not null,
    period_end timestamptz not null,
    metrics jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint fitness_summaries_connection_owner_fk
        foreign key (connection_id, user_id)
        references public.fitness_connections(id, user_id)
        on delete cascade,
    constraint fitness_summaries_source_key
        unique (connection_id, summary_type, source_key),
    constraint fitness_summaries_type_limit check (
        summary_type ~ '^[a-z][a-z0-9_]{1,31}$'
    ),
    constraint fitness_summaries_source_key_limit check (
        length(source_key) between 1 and 256
    ),
    constraint fitness_summaries_period_check check (
        period_end >= period_start
        and period_end <= period_start + interval '366 days'
    ),
    constraint fitness_summaries_metrics_shape check (
        jsonb_typeof(metrics) = 'object'
        and pg_column_size(metrics) <= 16384
    )
);

create index fitness_summaries_user_period_idx
on public.fitness_summaries (user_id, period_start desc);

create table public.fitness_consent_events (
    id uuid primary key default gen_random_uuid(),
    connection_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    event_key text not null,
    event_type text not null,
    consent_version text not null,
    scopes text[] not null default '{}'::text[],
    source text not null default 'app',
    details jsonb not null default '{}'::jsonb,
    occurred_at timestamptz not null default now(),
    constraint fitness_consent_events_connection_owner_fk
        foreign key (connection_id, user_id)
        references public.fitness_connections(id, user_id)
        on delete cascade,
    constraint fitness_consent_events_idempotency_key
        unique (connection_id, event_key),
    constraint fitness_consent_events_key_limit check (
        length(event_key) between 1 and 128
    ),
    constraint fitness_consent_events_type_check check (
        event_type in (
            'granted',
            'scopes_changed',
            'consent_version_changed',
            'revoked'
        )
    ),
    constraint fitness_consent_events_version_limit check (
        length(consent_version) between 1 and 64
    ),
    constraint fitness_consent_events_scope_limit check (
        cardinality(scopes) <= 32
        and array_position(scopes, null) is null
        and pg_column_size(scopes) <= 4096
    ),
    constraint fitness_consent_events_source_limit check (
        length(source) between 1 and 64
    ),
    constraint fitness_consent_events_details_shape check (
        jsonb_typeof(details) = 'object'
        and pg_column_size(details) <= 8192
    )
);

create index fitness_consent_events_user_time_idx
on public.fitness_consent_events (user_id, occurred_at desc);

create table app_private.fitness_connection_tokens (
    connection_id uuid primary key
        references public.fitness_connections(id) on delete cascade,
    provider text not null,
    provider_account_key text not null,
    access_token_ciphertext text not null,
    refresh_token_ciphertext text,
    access_token_expires_at timestamptz,
    encryption_key_version text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint fitness_connection_tokens_account_key
        unique (provider, provider_account_key),
    constraint fitness_connection_tokens_provider_format check (
        provider = lower(provider)
        and provider ~ '^[a-z][a-z0-9_]{1,31}$'
    ),
    constraint fitness_connection_tokens_account_limit check (
        length(provider_account_key) between 1 and 512
    ),
    constraint fitness_connection_tokens_access_limit check (
        length(access_token_ciphertext) between 1 and 16384
    ),
    constraint fitness_connection_tokens_refresh_limit check (
        refresh_token_ciphertext is null
        or length(refresh_token_ciphertext) between 1 and 16384
    ),
    constraint fitness_connection_tokens_key_version_limit check (
        length(encryption_key_version) between 1 and 64
    )
);

create table app_private.fitness_sync_state (
    connection_id uuid primary key
        references public.fitness_connections(id) on delete cascade,
    cursor text,
    cursor_updated_at timestamptz,
    next_sync_at timestamptz not null default now(),
    last_attempt_at timestamptz,
    last_success_at timestamptz,
    consecutive_failures integer not null default 0,
    last_error_code text,
    last_error_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint fitness_sync_state_cursor_limit check (
        cursor is null or length(cursor) <= 8192
    ),
    constraint fitness_sync_state_failure_check check (
        consecutive_failures between 0 and 1000000
    ),
    constraint fitness_sync_state_error_limit check (
        last_error_code is null or length(last_error_code) <= 128
    )
);

create index fitness_sync_state_due_idx
on app_private.fitness_sync_state (next_sync_at, connection_id);

create table app_private.fitness_sync_leases (
    connection_id uuid not null
        references public.fitness_connections(id) on delete cascade,
    purpose text not null,
    lease_token uuid,
    lease_expires_at timestamptz,
    last_claimed_at timestamptz,
    last_success_at timestamptz,
    updated_at timestamptz not null default now(),
    primary key (connection_id, purpose),
    constraint fitness_sync_leases_token_key unique (lease_token),
    constraint fitness_sync_leases_purpose_check check (
        purpose in ('background', 'foreground', 'workout')
    ),
    constraint fitness_sync_leases_pair_check check (
        (lease_token is null and lease_expires_at is null)
        or (lease_token is not null and lease_expires_at is not null)
    )
);

create index fitness_sync_leases_expiry_idx
on app_private.fitness_sync_leases (lease_expires_at)
where lease_token is not null;

create table app_private.fitness_audit_events (
    id uuid primary key default gen_random_uuid(),
    connection_id uuid references public.fitness_connections(id) on delete set null,
    user_id uuid not null references auth.users(id) on delete cascade,
    event_type text not null,
    actor_type text not null,
    details jsonb not null default '{}'::jsonb,
    occurred_at timestamptz not null default now(),
    constraint fitness_audit_events_type_limit check (
        event_type ~ '^[a-z][a-z0-9_]{1,63}$'
    ),
    constraint fitness_audit_events_actor_check check (
        actor_type in ('user', 'worker', 'system')
    ),
    constraint fitness_audit_events_details_shape check (
        jsonb_typeof(details) = 'object'
        and pg_column_size(details) <= 8192
    )
);

create index fitness_audit_events_user_time_idx
on app_private.fitness_audit_events (user_id, occurred_at desc);

create index fitness_audit_events_retention_idx
on app_private.fitness_audit_events (occurred_at);

alter table public.fitness_connections enable row level security;
alter table public.fitness_daily_metrics enable row level security;
alter table public.fitness_workout_sessions enable row level security;
alter table public.fitness_hr_samples enable row level security;
alter table public.fitness_hr_5m enable row level security;
alter table public.fitness_workout_summaries enable row level security;
alter table public.fitness_summaries enable row level security;
alter table public.fitness_consent_events enable row level security;

create policy fitness_connections_select_own
on public.fitness_connections
for select to authenticated
using ((select auth.uid()) = user_id);

create policy fitness_daily_metrics_select_own
on public.fitness_daily_metrics
for select to authenticated
using ((select auth.uid()) = user_id);

create policy fitness_workout_sessions_select_own
on public.fitness_workout_sessions
for select to authenticated
using ((select auth.uid()) = user_id);

create policy fitness_hr_samples_select_own
on public.fitness_hr_samples
for select to authenticated
using ((select auth.uid()) = user_id);

create policy fitness_hr_5m_select_own
on public.fitness_hr_5m
for select to authenticated
using ((select auth.uid()) = user_id);

create policy fitness_workout_summaries_select_own
on public.fitness_workout_summaries
for select to authenticated
using ((select auth.uid()) = user_id);

create policy fitness_summaries_select_own
on public.fitness_summaries
for select to authenticated
using ((select auth.uid()) = user_id);

create policy fitness_consent_events_select_own
on public.fitness_consent_events
for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.fitness_connections from public, anon, authenticated;
revoke all on public.fitness_daily_metrics from public, anon, authenticated;
revoke all on public.fitness_workout_sessions from public, anon, authenticated;
revoke all on public.fitness_hr_samples from public, anon, authenticated;
revoke all on public.fitness_hr_5m from public, anon, authenticated;
revoke all on public.fitness_workout_summaries from public, anon, authenticated;
revoke all on public.fitness_summaries from public, anon, authenticated;
revoke all on public.fitness_consent_events from public, anon, authenticated;

grant select on public.fitness_connections to authenticated;
grant select on public.fitness_daily_metrics to authenticated;
grant select on public.fitness_workout_sessions to authenticated;
grant select on public.fitness_hr_5m to authenticated;
grant select on public.fitness_workout_summaries to authenticated;
grant select on public.fitness_summaries to authenticated;
grant select on public.fitness_consent_events to authenticated;

-- Raw samples are deliberately not granted to clients. User-facing workout detail
-- is a bounded five-minute bucket projection created in the next migration.
revoke all on app_private.fitness_connection_tokens
from public, anon, authenticated, service_role;
revoke all on app_private.fitness_sync_state
from public, anon, authenticated, service_role;
revoke all on app_private.fitness_sync_leases
from public, anon, authenticated, service_role;
revoke all on app_private.fitness_audit_events
from public, anon, authenticated, service_role;
