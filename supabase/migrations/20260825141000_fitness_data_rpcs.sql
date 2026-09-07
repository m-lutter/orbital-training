-- Bounded, service-only write boundary for fitness integrations. Provider tokens
-- must already be encrypted by the Worker before they reach these functions.

create function app_private.fitness_assert_connection(
    p_user_id uuid,
    p_connection_id uuid,
    p_require_active boolean default true,
    p_expected_generation integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_status text;
    v_generation integer;
begin
    select connection.status, connection.generation
    into v_status, v_generation
    from public.fitness_connections as connection
    where connection.id = p_connection_id
      and connection.user_id = p_user_id
    for share;

    if v_status is null
       or (p_require_active and v_status <> 'active')
       or (
           p_expected_generation is not null
           and v_generation <> p_expected_generation
       ) then
        raise exception using
            errcode = '22023',
            message = 'The fitness connection is unavailable.';
    end if;
end;
$$;

create function app_private.fitness_assert_json_batch(
    p_value jsonb,
    p_label text,
    p_max_rows integer,
    p_max_bytes integer
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
    if p_value is null or jsonb_typeof(p_value) <> 'array' then
        raise exception using
            errcode = '22023',
            message = p_label || ' must be a JSON array.';
    end if;

    if jsonb_array_length(p_value) > p_max_rows then
        raise exception using
            errcode = '22023',
            message = p_label || ' contains too many rows.';
    end if;

    if pg_column_size(p_value) > p_max_bytes then
        raise exception using
            errcode = '54000',
            message = p_label || ' is too large.';
    end if;
end;
$$;

create function app_private.fitness_audit(
    p_connection_id uuid,
    p_user_id uuid,
    p_event_type text,
    p_actor_type text,
    p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into app_private.fitness_audit_events (
        connection_id,
        user_id,
        event_type,
        actor_type,
        details
    )
    values (
        p_connection_id,
        p_user_id,
        p_event_type,
        p_actor_type,
        coalesce(p_details, '{}'::jsonb)
    );
end;
$$;

revoke all on function app_private.fitness_assert_connection(
    uuid, uuid, boolean, integer
)
from public, anon, authenticated, service_role;
revoke all on function app_private.fitness_assert_json_batch(jsonb, text, integer, integer)
from public, anon, authenticated, service_role;
revoke all on function app_private.fitness_audit(uuid, uuid, text, text, jsonb)
from public, anon, authenticated, service_role;

create function public.fitness_store_connection_tokens(
    p_user_id uuid,
    p_provider text,
    p_provider_account_key text,
    p_access_token_ciphertext text,
    p_refresh_token_ciphertext text default null,
    p_access_token_expires_at timestamptz default null,
    p_scopes text[] default '{}'::text[],
    p_consent_version text default '1',
    p_encryption_key_version text default 'v1',
    p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
    v_connection_id uuid;
    v_generation integer;
    v_provider text := lower(trim(p_provider));
    v_scopes text[] := '{}'::text[];
    v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
    v_previous_scopes text[];
    v_previous_status text;
    v_previous_consent_version text;
    v_had_connection boolean := false;
    v_scope_changed boolean := false;
    v_consent_version_changed boolean := false;
    v_record_consent boolean := false;
begin
    select coalesce(array_agg(scope order by scope), '{}'::text[])
    into v_scopes
    from (
        select distinct trim(input.scope) as scope
        from unnest(coalesce(p_scopes, '{}'::text[])) as input(scope)
        where trim(input.scope) <> ''
    ) as normalized_scopes;

    select connection.scopes, connection.status, connection.consent_version
    into v_previous_scopes, v_previous_status, v_previous_consent_version
    from public.fitness_connections as connection
    where connection.user_id = p_user_id
      and connection.provider = v_provider
    for update;
    v_had_connection := found;
    v_scope_changed := v_previous_status = 'active'
        and v_previous_scopes is distinct from v_scopes;
    v_consent_version_changed := v_previous_status = 'active'
        and v_previous_consent_version is distinct from p_consent_version;
    v_record_consent := not v_had_connection
        or v_previous_status <> 'active'
        or v_scope_changed
        or v_consent_version_changed;

    insert into public.fitness_connections (
        user_id,
        provider,
        status,
        scopes,
        consent_version,
        connected_at,
        disconnected_at,
        metadata,
        updated_at
    )
    values (
        p_user_id,
        v_provider,
        'active',
        v_scopes,
        p_consent_version,
        now(),
        null,
        v_metadata,
        now()
    )
    on conflict (user_id, provider) do update
    set status = 'active',
        scopes = excluded.scopes,
        consent_version = excluded.consent_version,
        connected_at = case
            when public.fitness_connections.status = 'disconnected'
                then now()
            else public.fitness_connections.connected_at
        end,
        disconnected_at = null,
        last_error_code = null,
        generation = case
            when public.fitness_connections.status = 'disconnected'
                then public.fitness_connections.generation + 1
            else public.fitness_connections.generation
        end,
        metadata = excluded.metadata,
        updated_at = now()
    returning id, generation into v_connection_id, v_generation;

    insert into app_private.fitness_connection_tokens (
        connection_id,
        provider,
        provider_account_key,
        access_token_ciphertext,
        refresh_token_ciphertext,
        access_token_expires_at,
        encryption_key_version,
        updated_at
    )
    values (
        v_connection_id,
        v_provider,
        p_provider_account_key,
        p_access_token_ciphertext,
        p_refresh_token_ciphertext,
        p_access_token_expires_at,
        p_encryption_key_version,
        now()
    )
    on conflict (connection_id) do update
    set provider = excluded.provider,
        provider_account_key = excluded.provider_account_key,
        access_token_ciphertext = excluded.access_token_ciphertext,
        refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        access_token_expires_at = excluded.access_token_expires_at,
        encryption_key_version = excluded.encryption_key_version,
        updated_at = now();

    insert into app_private.fitness_sync_state (connection_id)
    values (v_connection_id)
    on conflict (connection_id) do nothing;

    insert into app_private.fitness_sync_leases (connection_id, purpose)
    values
        (v_connection_id, 'background'),
        (v_connection_id, 'foreground'),
        (v_connection_id, 'workout')
    on conflict (connection_id, purpose) do nothing;

    if v_record_consent then
        insert into public.fitness_consent_events (
            connection_id,
            user_id,
            event_key,
            event_type,
            consent_version,
            scopes,
            source,
            details
        )
        values (
            v_connection_id,
            p_user_id,
            case
                when v_scope_changed then
                    'scope:' || v_generation::text || ':'
                    || gen_random_uuid()::text
                when v_consent_version_changed then
                    'consent:' || v_generation::text || ':'
                    || gen_random_uuid()::text
                else
                    'grant:' || v_generation::text || ':' || md5(
                        p_consent_version || ':'
                        || array_to_string(v_scopes, ',')
                    )
            end,
            case
                when v_scope_changed then 'scopes_changed'
                when v_consent_version_changed then 'consent_version_changed'
                else 'granted'
            end,
            p_consent_version,
            v_scopes,
            'oauth',
            jsonb_build_object(
                'provider', v_provider,
                'previousScopes', case
                    when v_scope_changed then to_jsonb(v_previous_scopes)
                    else null
                end,
                'previousConsentVersion', case
                    when v_consent_version_changed then v_previous_consent_version
                    else null
                end
            )
        )
        on conflict (connection_id, event_key) do nothing;
    end if;

    perform app_private.fitness_audit(
        v_connection_id,
        p_user_id,
        'connection_tokens_stored',
        'worker',
        jsonb_build_object(
            'provider', v_provider,
            'encryptionKeyVersion', p_encryption_key_version
        )
    );

    return v_connection_id;
end;
$$;

create function public.fitness_register_device_connection(
    p_user_id uuid,
    p_provider text,
    p_device_key text,
    p_scopes text[] default '{}'::text[],
    p_consent_version text default '1',
    p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
    v_connection_id uuid;
    v_generation integer;
    v_provider text := lower(trim(p_provider));
    v_scopes text[] := '{}'::text[];
    v_previous_scopes text[];
    v_previous_status text;
    v_previous_consent_version text;
    v_had_connection boolean := false;
    v_scope_changed boolean := false;
    v_consent_version_changed boolean := false;
    v_record_consent boolean := false;
begin
    if v_provider not in ('apple_health', 'health_connect') then
        raise exception using
            errcode = '22023',
            message = 'The provider requires an OAuth connection.';
    end if;

    if p_device_key is null
       or length(p_device_key) not between 16 and 512 then
        raise exception using
            errcode = '22023',
            message = 'The device key is invalid.';
    end if;

    select coalesce(array_agg(scope order by scope), '{}'::text[])
    into v_scopes
    from (
        select distinct trim(input.scope) as scope
        from unnest(coalesce(p_scopes, '{}'::text[])) as input(scope)
        where trim(input.scope) <> ''
    ) as normalized_scopes;

    select connection.scopes, connection.status, connection.consent_version
    into v_previous_scopes, v_previous_status, v_previous_consent_version
    from public.fitness_connections as connection
    where connection.user_id = p_user_id
      and connection.provider = v_provider
    for update;
    v_had_connection := found;
    v_scope_changed := v_previous_status = 'active'
        and v_previous_scopes is distinct from v_scopes;
    v_consent_version_changed := v_previous_status = 'active'
        and v_previous_consent_version is distinct from p_consent_version;
    v_record_consent := not v_had_connection
        or v_previous_status <> 'active'
        or v_scope_changed
        or v_consent_version_changed;

    insert into public.fitness_connections (
        user_id,
        provider,
        status,
        scopes,
        consent_version,
        device_key_hash,
        connected_at,
        disconnected_at,
        metadata,
        updated_at
    )
    values (
        p_user_id,
        v_provider,
        'active',
        v_scopes,
        p_consent_version,
        encode(sha256(convert_to(p_device_key, 'UTF8')), 'hex'),
        now(),
        null,
        coalesce(p_metadata, '{}'::jsonb),
        now()
    )
    on conflict (user_id, provider) do update
    set status = 'active',
        scopes = excluded.scopes,
        consent_version = excluded.consent_version,
        device_key_hash = excluded.device_key_hash,
        connected_at = case
            when public.fitness_connections.status = 'disconnected'
                then now()
            else public.fitness_connections.connected_at
        end,
        disconnected_at = null,
        last_error_code = null,
        generation = case
            when public.fitness_connections.status = 'disconnected'
                then public.fitness_connections.generation + 1
            else public.fitness_connections.generation
        end,
        metadata = excluded.metadata,
        updated_at = now()
    returning id, generation into v_connection_id, v_generation;

    delete from app_private.fitness_connection_tokens
    where connection_id = v_connection_id;

    insert into app_private.fitness_sync_state (connection_id)
    values (v_connection_id)
    on conflict (connection_id) do nothing;

    insert into app_private.fitness_sync_leases (connection_id, purpose)
    values
        (v_connection_id, 'background'),
        (v_connection_id, 'foreground'),
        (v_connection_id, 'workout')
    on conflict (connection_id, purpose) do nothing;

    if v_record_consent then
        insert into public.fitness_consent_events (
            connection_id,
            user_id,
            event_key,
            event_type,
            consent_version,
            scopes,
            source,
            details
        )
        values (
            v_connection_id,
            p_user_id,
            case
                when v_scope_changed then
                    'scope:' || v_generation::text || ':'
                    || gen_random_uuid()::text
                when v_consent_version_changed then
                    'consent:' || v_generation::text || ':'
                    || gen_random_uuid()::text
                else
                    'grant:' || v_generation::text || ':' || md5(
                        p_consent_version || ':'
                        || array_to_string(v_scopes, ',')
                    )
            end,
            case
                when v_scope_changed then 'scopes_changed'
                when v_consent_version_changed then 'consent_version_changed'
                else 'granted'
            end,
            p_consent_version,
            v_scopes,
            'device',
            jsonb_build_object(
                'provider', v_provider,
                'previousScopes', case
                    when v_scope_changed then to_jsonb(v_previous_scopes)
                    else null
                end,
                'previousConsentVersion', case
                    when v_consent_version_changed then v_previous_consent_version
                    else null
                end
            )
        )
        on conflict (connection_id, event_key) do nothing;
    end if;

    perform app_private.fitness_audit(
        v_connection_id,
        p_user_id,
        'device_connection_registered',
        'worker',
        jsonb_build_object('provider', v_provider)
    );

    return v_connection_id;
end;
$$;

create function public.fitness_load_connection_tokens(
    p_user_id uuid,
    p_connection_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
    v_result jsonb;
begin
    perform app_private.fitness_assert_connection(
        p_user_id,
        p_connection_id,
        true
    );

    select jsonb_build_object(
        'connectionId', token.connection_id,
        'provider', token.provider,
        'providerAccountKey', token.provider_account_key,
        'accessTokenCiphertext', token.access_token_ciphertext,
        'refreshTokenCiphertext', token.refresh_token_ciphertext,
        'accessTokenExpiresAt', token.access_token_expires_at,
        'encryptionKeyVersion', token.encryption_key_version
    )
    into v_result
    from app_private.fitness_connection_tokens as token
    where token.connection_id = p_connection_id;

    return v_result;
end;
$$;

create function public.fitness_upsert_daily_metrics(
    p_user_id uuid,
    p_connection_id uuid,
    p_metrics jsonb,
    p_expected_generation integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
    v_received integer;
    v_changed integer;
begin
    perform app_private.fitness_assert_connection(
        p_user_id,
        p_connection_id,
        true,
        p_expected_generation
    );
    perform app_private.fitness_assert_json_batch(
        p_metrics,
        'Daily metrics',
        31,
        131072
    );
    v_received := jsonb_array_length(p_metrics);

    insert into public.fitness_daily_metrics (
        connection_id,
        user_id,
        metric_date,
        timezone,
        resting_heart_rate,
        hrv_rmssd_ms,
        sleep_start_at,
        sleep_end_at,
        sleep_minutes,
        sleep_stages,
        sleep_score,
        recovery_score,
        strain_score,
        steps,
        active_calories,
        distance_meters,
        active_minutes,
        respiratory_rate,
        spo2_percent,
        extensions,
        source_updated_at,
        ingested_at,
        updated_at
    )
    select
        p_connection_id,
        p_user_id,
        metric."metricDate",
        metric."timeZone",
        metric."restingHeartRateBpm",
        metric."heartRateVariabilityMs",
        metric."sleepStartAt",
        metric."sleepEndAt",
        metric."sleepMinutes",
        coalesce(metric."sleepStages", '{}'::jsonb),
        metric."sleepScore",
        metric."recoveryScore",
        metric."strainScore",
        metric.steps,
        metric."activeCalories",
        metric."distanceMeters",
        metric."activeMinutes",
        metric."respiratoryRate",
        metric."spo2Percent",
        coalesce(metric.extensions, '{}'::jsonb),
        metric."sourceUpdatedAt",
        now(),
        now()
    from jsonb_to_recordset(p_metrics) as metric(
        "metricDate" date,
        "timeZone" text,
        "restingHeartRateBpm" smallint,
        "heartRateVariabilityMs" numeric,
        "sleepStartAt" timestamptz,
        "sleepEndAt" timestamptz,
        "sleepMinutes" smallint,
        "sleepStages" jsonb,
        "sleepScore" numeric,
        "recoveryScore" numeric,
        "strainScore" numeric,
        steps integer,
        "activeCalories" integer,
        "distanceMeters" integer,
        "activeMinutes" smallint,
        "respiratoryRate" numeric,
        "spo2Percent" numeric,
        "sourceUpdatedAt" timestamptz,
        extensions jsonb
    )
    where metric."metricDate" between current_date - 3650 and current_date + 1
    on conflict (connection_id, metric_date) do update
    set timezone = excluded.timezone,
        resting_heart_rate = excluded.resting_heart_rate,
        hrv_rmssd_ms = excluded.hrv_rmssd_ms,
        sleep_start_at = excluded.sleep_start_at,
        sleep_end_at = excluded.sleep_end_at,
        sleep_minutes = excluded.sleep_minutes,
        sleep_stages = excluded.sleep_stages,
        sleep_score = excluded.sleep_score,
        recovery_score = excluded.recovery_score,
        strain_score = excluded.strain_score,
        steps = excluded.steps,
        active_calories = excluded.active_calories,
        distance_meters = excluded.distance_meters,
        active_minutes = excluded.active_minutes,
        respiratory_rate = excluded.respiratory_rate,
        spo2_percent = excluded.spo2_percent,
        extensions = excluded.extensions,
        source_updated_at = excluded.source_updated_at,
        ingested_at = excluded.ingested_at,
        updated_at = now()
    where (
        public.fitness_daily_metrics.source_updated_at is null
        or (
            excluded.source_updated_at is not null
            and excluded.source_updated_at
                >= public.fitness_daily_metrics.source_updated_at
        )
    ) and (
        public.fitness_daily_metrics.timezone,
        public.fitness_daily_metrics.resting_heart_rate,
        public.fitness_daily_metrics.hrv_rmssd_ms,
        public.fitness_daily_metrics.sleep_start_at,
        public.fitness_daily_metrics.sleep_end_at,
        public.fitness_daily_metrics.sleep_minutes,
        public.fitness_daily_metrics.sleep_stages,
        public.fitness_daily_metrics.sleep_score,
        public.fitness_daily_metrics.recovery_score,
        public.fitness_daily_metrics.strain_score,
        public.fitness_daily_metrics.steps,
        public.fitness_daily_metrics.active_calories,
        public.fitness_daily_metrics.distance_meters,
        public.fitness_daily_metrics.active_minutes,
        public.fitness_daily_metrics.respiratory_rate,
        public.fitness_daily_metrics.spo2_percent,
        public.fitness_daily_metrics.extensions,
        public.fitness_daily_metrics.source_updated_at
    ) is distinct from (
        excluded.timezone,
        excluded.resting_heart_rate,
        excluded.hrv_rmssd_ms,
        excluded.sleep_start_at,
        excluded.sleep_end_at,
        excluded.sleep_minutes,
        excluded.sleep_stages,
        excluded.sleep_score,
        excluded.recovery_score,
        excluded.strain_score,
        excluded.steps,
        excluded.active_calories,
        excluded.distance_meters,
        excluded.active_minutes,
        excluded.respiratory_rate,
        excluded.spo2_percent,
        excluded.extensions,
        excluded.source_updated_at
    );
    get diagnostics v_changed = row_count;

    if v_changed <> v_received and exists (
        select 1
        from jsonb_to_recordset(p_metrics) as invalid("metricDate" date)
        where invalid."metricDate" is null
           or invalid."metricDate" < current_date - 3650
           or invalid."metricDate" > current_date + 1
    ) then
        raise exception using
            errcode = '22023',
            message = 'Daily metrics contain an invalid metricDate.';
    end if;

    return jsonb_build_object(
        'received', v_received,
        'changed', v_changed
    );
end;
$$;

create function public.fitness_upsert_workout_summaries(
    p_user_id uuid,
    p_connection_id uuid,
    p_summaries jsonb,
    p_expected_generation integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
    v_received integer;
    v_changed integer;
begin
    perform app_private.fitness_assert_connection(
        p_user_id,
        p_connection_id,
        true,
        p_expected_generation
    );
    perform app_private.fitness_assert_json_batch(
        p_summaries,
        'Workout summaries',
        100,
        262144
    );
    v_received := jsonb_array_length(p_summaries);

    insert into public.fitness_workout_summaries (
        connection_id,
        user_id,
        source_workout_id,
        workout_type,
        started_at,
        ended_at,
        average_heart_rate,
        maximum_heart_rate,
        heart_rate_zones,
        distance_meters,
        strain_score,
        active_calories,
        extensions,
        source_updated_at,
        updated_at
    )
    select
        p_connection_id,
        p_user_id,
        summary."sourceWorkoutId",
        summary."workoutType",
        summary."startedAt",
        summary."endedAt",
        summary."averageHeartRateBpm",
        summary."maximumHeartRateBpm",
        coalesce(summary."heartRateZones", '{}'::jsonb),
        summary."distanceMeters",
        summary."strainScore",
        summary."activeCalories",
        coalesce(summary.extensions, '{}'::jsonb),
        summary."sourceUpdatedAt",
        now()
    from jsonb_to_recordset(p_summaries) as summary(
        "sourceWorkoutId" text,
        "workoutType" text,
        "startedAt" timestamptz,
        "endedAt" timestamptz,
        "averageHeartRateBpm" smallint,
        "maximumHeartRateBpm" smallint,
        "heartRateZones" jsonb,
        "distanceMeters" integer,
        "strainScore" numeric,
        "activeCalories" integer,
        "sourceUpdatedAt" timestamptz,
        extensions jsonb
    )
    on conflict (connection_id, source_workout_id) do update
    set workout_type = excluded.workout_type,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        average_heart_rate = excluded.average_heart_rate,
        maximum_heart_rate = excluded.maximum_heart_rate,
        heart_rate_zones = excluded.heart_rate_zones,
        distance_meters = excluded.distance_meters,
        strain_score = excluded.strain_score,
        active_calories = excluded.active_calories,
        extensions = excluded.extensions,
        source_updated_at = excluded.source_updated_at,
        updated_at = now()
    where (
        public.fitness_workout_summaries.source_updated_at is null
        or (
            excluded.source_updated_at is not null
            and excluded.source_updated_at
                >= public.fitness_workout_summaries.source_updated_at
        )
    ) and (
        public.fitness_workout_summaries.workout_type,
        public.fitness_workout_summaries.started_at,
        public.fitness_workout_summaries.ended_at,
        public.fitness_workout_summaries.average_heart_rate,
        public.fitness_workout_summaries.maximum_heart_rate,
        public.fitness_workout_summaries.heart_rate_zones,
        public.fitness_workout_summaries.distance_meters,
        public.fitness_workout_summaries.strain_score,
        public.fitness_workout_summaries.active_calories,
        public.fitness_workout_summaries.extensions,
        public.fitness_workout_summaries.source_updated_at
    ) is distinct from (
        excluded.workout_type,
        excluded.started_at,
        excluded.ended_at,
        excluded.average_heart_rate,
        excluded.maximum_heart_rate,
        excluded.heart_rate_zones,
        excluded.distance_meters,
        excluded.strain_score,
        excluded.active_calories,
        excluded.extensions,
        excluded.source_updated_at
    );
    get diagnostics v_changed = row_count;

    return jsonb_build_object(
        'received', v_received,
        'changed', v_changed
    );
end;
$$;

create function public.fitness_upsert_hr_buckets(
    p_user_id uuid,
    p_connection_id uuid,
    p_buckets jsonb,
    p_expected_generation integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
    v_received integer;
    v_changed integer;
begin
    perform app_private.fitness_assert_connection(
        p_user_id,
        p_connection_id,
        true,
        p_expected_generation
    );
    perform app_private.fitness_assert_json_batch(
        p_buckets,
        'Heart-rate buckets',
        600,
        262144
    );
    v_received := jsonb_array_length(p_buckets);

    with parsed as (
        select distinct on (
            to_timestamp(
                floor(extract(epoch from bucket."bucketStart") / 300) * 300
            )
        )
            to_timestamp(
                floor(extract(epoch from bucket."bucketStart") / 300) * 300
            ) as bucket_start,
            bucket."minBpm" as minimum_bpm,
            bucket."maxBpm" as maximum_bpm,
            bucket."avgBpm" as average_bpm,
            bucket."sampleCount" as sample_count
        from jsonb_to_recordset(p_buckets) as bucket(
            "bucketStart" timestamptz,
            "minBpm" smallint,
            "maxBpm" smallint,
            "avgBpm" numeric,
            "sampleCount" integer
        )
        where bucket."bucketStart" is not null
        order by
            to_timestamp(
                floor(extract(epoch from bucket."bucketStart") / 300) * 300
            ),
            bucket."bucketStart" desc
    )
    insert into public.fitness_hr_5m (
        connection_id,
        user_id,
        bucket_start,
        minimum_bpm,
        maximum_bpm,
        average_bpm,
        sample_count,
        source,
        updated_at
    )
    select
        p_connection_id,
        p_user_id,
        parsed.bucket_start,
        parsed.minimum_bpm,
        parsed.maximum_bpm,
        parsed.average_bpm,
        parsed.sample_count,
        'provider',
        now()
    from parsed
    on conflict (connection_id, bucket_start) do update
    set minimum_bpm = excluded.minimum_bpm,
        maximum_bpm = excluded.maximum_bpm,
        average_bpm = excluded.average_bpm,
        sample_count = excluded.sample_count,
        source = excluded.source,
        updated_at = now()
    where (
        public.fitness_hr_5m.minimum_bpm,
        public.fitness_hr_5m.maximum_bpm,
        public.fitness_hr_5m.average_bpm,
        public.fitness_hr_5m.sample_count,
        public.fitness_hr_5m.source
    ) is distinct from (
        excluded.minimum_bpm,
        excluded.maximum_bpm,
        excluded.average_bpm,
        excluded.sample_count,
        excluded.source
    );
    get diagnostics v_changed = row_count;

    if exists (
        select 1
        from jsonb_to_recordset(p_buckets) as invalid("bucketStart" timestamptz)
        where invalid."bucketStart" is null
    ) then
        raise exception using
            errcode = '22023',
            message = 'Heart-rate buckets contain an invalid bucketStart.';
    end if;

    return jsonb_build_object(
        'received', v_received,
        'changed', v_changed
    );
end;
$$;

create function public.fitness_ingest_hr_samples(
    p_user_id uuid,
    p_connection_id uuid,
    p_samples jsonb,
    p_expected_generation integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
    v_received integer;
    v_changed integer;
    v_buckets_changed integer;
    v_min_sample timestamptz;
    v_max_sample timestamptz;
begin
    perform app_private.fitness_assert_connection(
        p_user_id,
        p_connection_id,
        true,
        p_expected_generation
    );
    perform app_private.fitness_assert_json_batch(
        p_samples,
        'Heart-rate samples',
        2000,
        524288
    );
    v_received := jsonb_array_length(p_samples);

    select min(sample."sampledAt"), max(sample."sampledAt")
    into v_min_sample, v_max_sample
    from jsonb_to_recordset(p_samples) as sample("sampledAt" timestamptz);

    if v_received > 0 and (
        v_min_sample is null
        or v_min_sample < now() - interval '8 days'
        or v_max_sample > now() + interval '1 day'
    ) then
        raise exception using
            errcode = '22023',
            message = 'Heart-rate samples fall outside the accepted window.';
    end if;

    with parsed as (
        select distinct on (sample."sampledAt")
            sample."sampledAt" as sampled_at,
            sample.bpm,
            sample."sourceRecordId" as source_record_id,
            sample."sourceSessionKey" as source_session_key,
            sample.quality
        from jsonb_to_recordset(p_samples) as sample(
            "sampledAt" timestamptz,
            bpm smallint,
            "sourceRecordId" text,
            "sourceSessionKey" text,
            quality smallint
        )
        order by sample."sampledAt", sample."sourceRecordId" desc nulls last
    )
    insert into public.fitness_hr_samples (
        connection_id,
        user_id,
        sampled_at,
        bpm,
        source_record_id,
        source_session_key,
        quality,
        ingested_at,
        expires_at
    )
    select
        p_connection_id,
        p_user_id,
        parsed.sampled_at,
        parsed.bpm,
        parsed.source_record_id,
        parsed.source_session_key,
        parsed.quality,
        now(),
        now() + interval '7 days'
    from parsed
    on conflict (connection_id, sampled_at) do update
    set bpm = excluded.bpm,
        source_record_id = excluded.source_record_id,
        source_session_key = excluded.source_session_key,
        quality = excluded.quality,
        ingested_at = excluded.ingested_at,
        expires_at = excluded.expires_at
    where (
        public.fitness_hr_samples.bpm,
        public.fitness_hr_samples.source_record_id,
        public.fitness_hr_samples.source_session_key,
        public.fitness_hr_samples.quality
    ) is distinct from (
        excluded.bpm,
        excluded.source_record_id,
        excluded.source_session_key,
        excluded.quality
    );
    get diagnostics v_changed = row_count;

    if v_received = 0 then
        return jsonb_build_object(
            'received', 0,
            'changed', 0,
            'bucketsChanged', 0
        );
    end if;

    insert into public.fitness_hr_5m (
        connection_id,
        user_id,
        bucket_start,
        minimum_bpm,
        maximum_bpm,
        average_bpm,
        sample_count,
        source,
        updated_at
    )
    select
        p_connection_id,
        p_user_id,
        to_timestamp(floor(extract(epoch from sample.sampled_at) / 300) * 300),
        min(sample.bpm),
        max(sample.bpm),
        round(avg(sample.bpm)::numeric, 2),
        count(*)::integer,
        'raw',
        now()
    from public.fitness_hr_samples as sample
    where sample.connection_id = p_connection_id
      and sample.sampled_at >= to_timestamp(
          floor(extract(epoch from v_min_sample) / 300) * 300
      )
      and sample.sampled_at < to_timestamp(
          floor(extract(epoch from v_max_sample) / 300) * 300 + 300
      )
    group by to_timestamp(
        floor(extract(epoch from sample.sampled_at) / 300) * 300
    )
    on conflict (connection_id, bucket_start) do update
    set minimum_bpm = excluded.minimum_bpm,
        maximum_bpm = excluded.maximum_bpm,
        average_bpm = excluded.average_bpm,
        sample_count = excluded.sample_count,
        source = excluded.source,
        updated_at = now()
    where (
        public.fitness_hr_5m.minimum_bpm,
        public.fitness_hr_5m.maximum_bpm,
        public.fitness_hr_5m.average_bpm,
        public.fitness_hr_5m.sample_count,
        public.fitness_hr_5m.source
    ) is distinct from (
        excluded.minimum_bpm,
        excluded.maximum_bpm,
        excluded.average_bpm,
        excluded.sample_count,
        excluded.source
    );
    get diagnostics v_buckets_changed = row_count;

    return jsonb_build_object(
        'received', v_received,
        'changed', v_changed,
        'bucketsChanged', v_buckets_changed
    );
end;
$$;

create function public.fitness_start_workout_session(
    p_user_id uuid,
    p_connection_id uuid,
    p_source_session_key text,
    p_started_at timestamptz,
    p_workout_type text,
    p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
    v_session_id uuid;
begin
    perform app_private.fitness_assert_connection(
        p_user_id,
        p_connection_id,
        true
    );

    insert into public.fitness_workout_sessions (
        connection_id,
        user_id,
        source_session_key,
        workout_type,
        started_at,
        metadata,
        updated_at
    )
    values (
        p_connection_id,
        p_user_id,
        p_source_session_key,
        p_workout_type,
        p_started_at,
        coalesce(p_metadata, '{}'::jsonb),
        now()
    )
    on conflict (connection_id, source_session_key) do update
    set started_at = least(
            public.fitness_workout_sessions.started_at,
            excluded.started_at
        ),
        workout_type = excluded.workout_type,
        metadata = excluded.metadata,
        updated_at = now()
    returning id into v_session_id;

    perform app_private.fitness_audit(
        p_connection_id,
        p_user_id,
        'workout_session_started',
        'worker',
        jsonb_build_object(
            'sessionId', v_session_id,
            'sourceSessionKey', p_source_session_key
        )
    );

    return v_session_id;
end;
$$;

create function public.fitness_end_workout_session(
    p_user_id uuid,
    p_connection_id uuid,
    p_source_session_key text,
    p_ended_at timestamptz,
    p_summary jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
    v_session public.fitness_workout_sessions%rowtype;
    v_summary jsonb := coalesce(p_summary, '{}'::jsonb);
begin
    perform app_private.fitness_assert_connection(
        p_user_id,
        p_connection_id,
        true
    );

    if jsonb_typeof(v_summary) <> 'object'
       or pg_column_size(v_summary) > 16384 then
        raise exception using
            errcode = '54000',
            message = 'The workout summary is invalid or too large.';
    end if;

    update public.fitness_workout_sessions as session
    set ended_at = p_ended_at,
        duration_seconds = floor(
            extract(epoch from p_ended_at - session.started_at)
        )::integer,
        average_heart_rate = (v_summary ->> 'averageHeartRateBpm')::smallint,
        maximum_heart_rate = (v_summary ->> 'maximumHeartRateBpm')::smallint,
        active_calories = (v_summary ->> 'activeCalories')::integer,
        distance_meters = (v_summary ->> 'distanceMeters')::integer,
        strain_score = (v_summary ->> 'strainScore')::numeric,
        summary = v_summary,
        updated_at = now()
    where session.connection_id = p_connection_id
      and session.user_id = p_user_id
      and session.source_session_key = p_source_session_key
      and p_ended_at >= session.started_at
      and p_ended_at <= session.started_at + interval '48 hours'
    returning session.* into v_session;

    if v_session.id is null then
        raise exception using
            errcode = '22023',
            message = 'The workout session cannot be ended.';
    end if;

    insert into public.fitness_summaries (
        connection_id,
        user_id,
        summary_type,
        source_key,
        period_start,
        period_end,
        metrics,
        updated_at
    )
    values (
        p_connection_id,
        p_user_id,
        'workout',
        p_source_session_key,
        v_session.started_at,
        p_ended_at,
        v_summary,
        now()
    )
    on conflict (connection_id, summary_type, source_key) do update
    set period_start = excluded.period_start,
        period_end = excluded.period_end,
        metrics = excluded.metrics,
        updated_at = now();

    perform app_private.fitness_audit(
        p_connection_id,
        p_user_id,
        'workout_session_ended',
        'worker',
        jsonb_build_object('sessionId', v_session.id)
    );

    return v_session.id;
end;
$$;

create function public.fitness_get_workout_detail(
    p_workout_session_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
set statement_timeout = '3s'
as $$
    select jsonb_build_object(
        'session', jsonb_build_object(
            'id', session.id,
            'connectionId', session.connection_id,
            'sourceSessionKey', session.source_session_key,
            'workoutType', session.workout_type,
            'startedAt', session.started_at,
            'endedAt', session.ended_at,
            'durationSeconds', session.duration_seconds,
            'averageHeartRateBpm', session.average_heart_rate,
            'maximumHeartRateBpm', session.maximum_heart_rate,
            'activeCalories', session.active_calories,
            'distanceMeters', session.distance_meters,
            'strainScore', session.strain_score,
            'summary', session.summary
        ),
        'heartRateBuckets', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'bucketStart', bucket.bucket_start,
                    'minBpm', bucket.minimum_bpm,
                    'maxBpm', bucket.maximum_bpm,
                    'avgBpm', bucket.average_bpm,
                    'sampleCount', bucket.sample_count
                )
                order by bucket.bucket_start
            )
            from public.fitness_hr_5m as bucket
            where bucket.connection_id = session.connection_id
              and bucket.user_id = session.user_id
              and bucket.bucket_start >= to_timestamp(
                  floor(extract(epoch from session.started_at) / 300) * 300
              )
              and bucket.bucket_start <= coalesce(
                  session.ended_at,
                  least(now(), session.started_at + interval '48 hours')
              )
        ), '[]'::jsonb)
    )
    from public.fitness_workout_sessions as session
    where session.id = p_workout_session_id
      and session.user_id = (select auth.uid());
$$;

-- Raw samples are available only through the authenticated application Worker.
-- Keeping this service-role-only prevents browser clients from bypassing the
-- bounded workout response while still allowing a detailed post-workout plot.
create function public.fitness_get_workout_raw_detail(
    p_user_id uuid,
    p_workout_session_id uuid,
    p_max_samples integer default 5000
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
    v_result jsonb;
begin
    if p_max_samples is null or p_max_samples not between 1 and 5000 then
        raise exception using
            errcode = '22023',
            message = 'The workout sample limit is invalid.';
    end if;

    select jsonb_build_object(
        'workoutSessionId', session.id,
        'status', case when session.ended_at is null then 'active' else 'complete' end,
        'startedAt', session.started_at,
        'endedAt', session.ended_at,
        'samples', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'recordedAt', sample.sampled_at,
                    'bpm', sample.bpm
                ) order by sample.sampled_at
            )
            from (
                select raw.sampled_at, raw.bpm
                from public.fitness_hr_samples as raw
                where raw.connection_id = session.connection_id
                  and raw.user_id = session.user_id
                  and raw.sampled_at >= session.started_at
                  and raw.sampled_at <= coalesce(
                      session.ended_at,
                      least(now(), session.started_at + interval '48 hours')
                  )
                  and (
                      raw.source_session_key is null
                      or raw.source_session_key = session.source_session_key
                  )
                order by raw.sampled_at
                limit p_max_samples
            ) as sample
        ), '[]'::jsonb),
        'buckets', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'bucketStart', bucket.bucket_start,
                    'minBpm', bucket.minimum_bpm,
                    'maxBpm', bucket.maximum_bpm,
                    'avgBpm', bucket.average_bpm,
                    'sampleCount', coalesce(bucket.sample_count, 1)
                ) order by bucket.bucket_start
            )
            from public.fitness_hr_5m as bucket
            where bucket.connection_id = session.connection_id
              and bucket.user_id = session.user_id
              and bucket.bucket_start >= to_timestamp(
                  floor(extract(epoch from session.started_at) / 300) * 300
              )
              and bucket.bucket_start <= coalesce(
                  session.ended_at,
                  least(now(), session.started_at + interval '48 hours')
              )
        ), '[]'::jsonb)
    ) into v_result
    from public.fitness_workout_sessions as session
    where session.id = p_workout_session_id
      and session.user_id = p_user_id;

    return v_result;
end;
$$;

create function public.fitness_disconnect_provider(
    p_user_id uuid,
    p_connection_id uuid,
    p_delete_health_data boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
    v_connection public.fitness_connections%rowtype;
begin
    select connection.*
    into v_connection
    from public.fitness_connections as connection
    where connection.id = p_connection_id
      and connection.user_id = p_user_id
    for update;

    if v_connection.id is null then
        raise exception using
            errcode = '22023',
            message = 'The fitness connection is unavailable.';
    end if;

    update public.fitness_connections
    set status = 'disconnected',
        disconnected_at = coalesce(disconnected_at, now()),
        last_error_code = null,
        updated_at = now()
    where id = p_connection_id;

    delete from app_private.fitness_connection_tokens
    where connection_id = p_connection_id;
    delete from app_private.fitness_sync_leases
    where connection_id = p_connection_id;
    delete from app_private.fitness_sync_state
    where connection_id = p_connection_id;

    if p_delete_health_data then
        delete from public.fitness_hr_samples
        where connection_id = p_connection_id;
        delete from public.fitness_hr_5m
        where connection_id = p_connection_id;
        delete from public.fitness_summaries
        where connection_id = p_connection_id;
        delete from public.fitness_workout_summaries
        where connection_id = p_connection_id;
        delete from public.fitness_workout_sessions
        where connection_id = p_connection_id;
        delete from public.fitness_daily_metrics
        where connection_id = p_connection_id;
    end if;

    insert into public.fitness_consent_events (
        connection_id,
        user_id,
        event_key,
        event_type,
        consent_version,
        scopes,
        source,
        details
    )
    values (
        p_connection_id,
        p_user_id,
        'revoke:' || v_connection.generation::text,
        'revoked',
        v_connection.consent_version,
        v_connection.scopes,
        'app',
        case
            when p_delete_health_data then jsonb_build_object(
                'healthDataDeleted', true,
                'healthDataDeletedAt', to_jsonb(clock_timestamp())
            )
            else jsonb_build_object('healthDataDeleted', false)
        end
    )
    on conflict (connection_id, event_key) do update
    set details = public.fitness_consent_events.details || jsonb_build_object(
        'healthDataDeleted', true,
        'healthDataDeletedAt', to_jsonb(clock_timestamp())
    )
    where (excluded.details ->> 'healthDataDeleted') = 'true'
      and not coalesce(
          (public.fitness_consent_events.details ->> 'healthDataDeleted')::boolean,
          false
      );

    if v_connection.status <> 'disconnected' or p_delete_health_data then
        perform app_private.fitness_audit(
            p_connection_id,
            p_user_id,
            'connection_disconnected',
            'worker',
            jsonb_build_object(
                'provider', v_connection.provider,
                'healthDataDeleted', p_delete_health_data
            )
        );
    end if;

    return true;
end;
$$;

create function public.fitness_claim_connection_sync(
    p_user_id uuid,
    p_connection_id uuid,
    p_min_interval_seconds integer default 21600,
    p_lease_seconds integer default 120,
    p_purpose text default 'foreground'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '1s'
as $$
declare
    v_provider text;
    v_generation integer;
    v_lease_token uuid;
    v_lease_expires_at timestamptz;
    v_cursor text;
    v_last_success_at timestamptz;
begin
    if p_purpose is null
       or p_min_interval_seconds is null
       or p_lease_seconds is null
       or p_purpose not in ('foreground', 'workout')
       or p_min_interval_seconds not between 20 and 604800
       or p_lease_seconds not between 15 and 600 then
        raise exception using
            errcode = '22023',
            message = 'The sync lease parameters are invalid.';
    end if;

    perform app_private.fitness_assert_connection(
        p_user_id,
        p_connection_id,
        true
    );

    select connection.provider, connection.generation
    into v_provider, v_generation
    from public.fitness_connections as connection
    where connection.id = p_connection_id
      and connection.user_id = p_user_id;

    insert into app_private.fitness_sync_state (connection_id)
    values (p_connection_id)
    on conflict (connection_id) do nothing;

    insert into app_private.fitness_sync_leases (connection_id, purpose)
    values (p_connection_id, p_purpose)
    on conflict (connection_id, purpose) do nothing;

    update app_private.fitness_sync_leases as lease
    set lease_token = gen_random_uuid(),
        lease_expires_at = now() + p_lease_seconds * interval '1 second',
        last_claimed_at = now(),
        updated_at = now()
    where lease.connection_id = p_connection_id
      and lease.purpose = p_purpose
      and (
          lease.lease_token is null
          or lease.lease_expires_at <= now()
      )
      and (
          lease.last_claimed_at is null
          or lease.last_claimed_at <= now()
              - p_min_interval_seconds * interval '1 second'
      )
    returning lease.lease_token, lease.lease_expires_at
    into v_lease_token, v_lease_expires_at;

    if v_lease_token is null then
        return null;
    end if;

    update app_private.fitness_sync_state
    set last_attempt_at = now(),
        updated_at = now()
    where connection_id = p_connection_id
    returning cursor, last_success_at
    into v_cursor, v_last_success_at;

    return jsonb_build_object(
        'connectionId', p_connection_id,
        'provider', v_provider,
        'generation', v_generation,
        'purpose', p_purpose,
        'leaseToken', v_lease_token,
        'leaseExpiresAt', v_lease_expires_at,
        'cursor', v_cursor,
        'lastSuccessAt', v_last_success_at
    );
end;
$$;

create function public.fitness_claim_sync_lease(
    p_provider text default null,
    p_limit integer default 10,
    p_lease_seconds integer default 120
)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
begin
    if p_limit is null
       or p_lease_seconds is null
       or p_limit not between 1 and 50
       or p_lease_seconds not between 15 and 600 then
        raise exception using
            errcode = '22023',
            message = 'The sync claim parameters are invalid.';
    end if;

    return query
    with candidates as (
        select state.connection_id
        from app_private.fitness_sync_state as state
        join public.fitness_connections as connection
          on connection.id = state.connection_id
        join app_private.fitness_sync_leases as lease
          on lease.connection_id = state.connection_id
         and lease.purpose = 'background'
        where connection.status = 'active'
          and (p_provider is null or connection.provider = lower(p_provider))
          and state.next_sync_at <= now()
          and (
              lease.lease_token is null
              or lease.lease_expires_at <= now()
          )
        order by state.next_sync_at, state.connection_id
        for update of state, lease skip locked
        limit p_limit
    ), claimed as (
        update app_private.fitness_sync_leases as lease
        set lease_token = gen_random_uuid(),
            lease_expires_at = now() + p_lease_seconds * interval '1 second',
            last_claimed_at = now(),
            updated_at = now()
        from candidates
        where lease.connection_id = candidates.connection_id
          and lease.purpose = 'background'
        returning
            lease.connection_id,
            lease.lease_token,
            lease.lease_expires_at
    ), attempted as (
        update app_private.fitness_sync_state as state
        set last_attempt_at = now(),
            updated_at = now()
        from claimed
        where state.connection_id = claimed.connection_id
        returning
            state.connection_id,
            state.cursor,
            state.last_success_at,
            claimed.lease_token,
            claimed.lease_expires_at
    )
    select jsonb_build_object(
        'connectionId', attempted.connection_id,
        'userId', connection.user_id,
        'provider', connection.provider,
        'generation', connection.generation,
        'purpose', 'background',
        'leaseToken', attempted.lease_token,
        'leaseExpiresAt', attempted.lease_expires_at,
        'cursor', attempted.cursor,
        'lastSuccessAt', attempted.last_success_at
    )
    from attempted
    join public.fitness_connections as connection
      on connection.id = attempted.connection_id;
end;
$$;

create function public.fitness_complete_sync_lease(
    p_connection_id uuid,
    p_lease_token uuid,
    p_cursor text default null,
    p_next_sync_at timestamptz default (now() + interval '6 hours')
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '1s'
as $$
declare
    v_purpose text;
begin
    if p_cursor is not null and length(p_cursor) > 8192 then
        raise exception using
            errcode = '54000',
            message = 'The sync cursor is too large.';
    end if;

    update app_private.fitness_sync_leases as lease
    set lease_token = null,
        lease_expires_at = null,
        last_success_at = now(),
        updated_at = now()
    where lease.connection_id = p_connection_id
      and lease.lease_token = p_lease_token
      and lease.lease_expires_at > now()
    returning lease.purpose into v_purpose;

    if v_purpose is null then
        return false;
    end if;

    update app_private.fitness_sync_state
    set cursor = coalesce(p_cursor, cursor),
        cursor_updated_at = case
            when p_cursor is null then cursor_updated_at
            else now()
        end,
        next_sync_at = greatest(p_next_sync_at, now()),
        last_success_at = now(),
        consecutive_failures = 0,
        last_error_code = null,
        last_error_at = null,
        updated_at = now()
    where connection_id = p_connection_id;

    update public.fitness_connections
    set last_synced_at = now(),
        last_error_code = null,
        updated_at = now()
    where id = p_connection_id;

    return true;
end;
$$;

create function public.fitness_fail_sync_lease(
    p_connection_id uuid,
    p_lease_token uuid,
    p_error_code text,
    p_next_sync_at timestamptz default (now() + interval '15 minutes')
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '1s'
as $$
declare
    v_purpose text;
    v_user_id uuid;
begin
    if p_error_code is null
       or length(p_error_code) not between 1 and 128 then
        raise exception using
            errcode = '22023',
            message = 'The sync error code is invalid.';
    end if;

    update app_private.fitness_sync_leases as lease
    set lease_token = null,
        lease_expires_at = null,
        updated_at = now()
    where lease.connection_id = p_connection_id
      and lease.lease_token = p_lease_token
    returning lease.purpose into v_purpose;

    if v_purpose is null then
        return false;
    end if;

    update app_private.fitness_sync_state
    set next_sync_at = greatest(p_next_sync_at, now()),
        consecutive_failures = least(consecutive_failures + 1, 1000000),
        last_error_code = p_error_code,
        last_error_at = now(),
        updated_at = now()
    where connection_id = p_connection_id;

    update public.fitness_connections
    set last_error_code = p_error_code,
        updated_at = now()
    where id = p_connection_id
    returning user_id into v_user_id;

    if v_user_id is not null then
        perform app_private.fitness_audit(
            p_connection_id,
            v_user_id,
            'sync_failed',
            'worker',
            jsonb_build_object(
                'purpose', v_purpose,
                'errorCode', p_error_code
            )
        );
    end if;

    return true;
end;
$$;

create function public.fitness_run_retention(
    p_raw_days integer default 7,
    p_audit_days integer default 365,
    p_batch_limit integer default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '1s'
as $$
declare
    v_raw_deleted integer;
    v_buckets_deleted integer;
    v_audit_deleted integer;
    v_leases_cleared integer;
begin
    if p_raw_days is null
       or p_audit_days is null
       or p_batch_limit is null
       or p_raw_days not between 1 and 30
       or p_audit_days not between 30 and 3650
       or p_batch_limit not between 1 and 20000 then
        raise exception using
            errcode = '22023',
            message = 'The retention parameters are invalid.';
    end if;

    with expired as (
        select sample.ctid
        from public.fitness_hr_samples as sample
        where sample.expires_at <= now()
           or sample.sampled_at < now() - p_raw_days * interval '1 day'
        order by sample.expires_at
        for update skip locked
        limit p_batch_limit
    )
    delete from public.fitness_hr_samples as sample
    using expired
    where sample.ctid = expired.ctid;
    get diagnostics v_raw_deleted = row_count;

    with expired as (
        select bucket.ctid
        from public.fitness_hr_5m as bucket
        where bucket.bucket_start < now() - interval '400 days'
        order by bucket.bucket_start
        for update skip locked
        limit p_batch_limit
    )
    delete from public.fitness_hr_5m as bucket
    using expired
    where bucket.ctid = expired.ctid;
    get diagnostics v_buckets_deleted = row_count;

    with expired as (
        select audit.ctid
        from app_private.fitness_audit_events as audit
        where audit.occurred_at < now() - p_audit_days * interval '1 day'
        order by audit.occurred_at
        for update skip locked
        limit p_batch_limit
    )
    delete from app_private.fitness_audit_events as audit
    using expired
    where audit.ctid = expired.ctid;
    get diagnostics v_audit_deleted = row_count;

    with expired as (
        select lease.ctid
        from app_private.fitness_sync_leases as lease
        where lease.lease_token is not null
          and lease.lease_expires_at < now() - interval '1 day'
        order by lease.lease_expires_at
        for update skip locked
        limit p_batch_limit
    )
    update app_private.fitness_sync_leases as lease
    set lease_token = null,
        lease_expires_at = null,
        updated_at = now()
    from expired
    where lease.ctid = expired.ctid;
    get diagnostics v_leases_cleared = row_count;

    return jsonb_build_object(
        'rawSamplesDeleted', v_raw_deleted,
        'heartRateBucketsDeleted', v_buckets_deleted,
        'auditEventsDeleted', v_audit_deleted,
        'staleLeasesCleared', v_leases_cleared
    );
end;
$$;

-- Refreshing an expiring token is not consent to reconnect. This path only
-- updates the same active account/generation and never changes connection
-- status, scopes outside the provider response, or disconnected_at.
create function public.fitness_delete_mobile_source_records(
    p_user_id uuid,
    p_connection_id uuid,
    p_deletions jsonb,
    p_expected_generation integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
    v_hr_deleted integer;
    v_workouts_deleted integer;
begin
    perform app_private.fitness_assert_connection(
        p_user_id,
        p_connection_id,
        true,
        p_expected_generation
    );
    perform app_private.fitness_assert_json_batch(
        p_deletions,
        'Mobile source deletions',
        100,
        32768
    );

    if exists (
        select 1
        from jsonb_to_recordset(p_deletions) as deletion(kind text, "sourceRecordId" text)
        where deletion.kind not in ('heart_rate', 'workout')
           or deletion."sourceRecordId" is null
           or length(deletion."sourceRecordId") not between 1 and 256
    ) then
        raise exception using
            errcode = '22023',
            message = 'Mobile source deletions are invalid.';
    end if;

    delete from public.fitness_hr_samples as sample
    using jsonb_to_recordset(p_deletions) as deletion(kind text, "sourceRecordId" text)
    where deletion.kind = 'heart_rate'
      and sample.connection_id = p_connection_id
      and sample.user_id = p_user_id
      and sample.source_record_id = deletion."sourceRecordId";
    get diagnostics v_hr_deleted = row_count;

    delete from public.fitness_workout_summaries as summary
    using jsonb_to_recordset(p_deletions) as deletion(kind text, "sourceRecordId" text)
    where deletion.kind = 'workout'
      and summary.connection_id = p_connection_id
      and summary.user_id = p_user_id
      and summary.source_workout_id = deletion."sourceRecordId";
    get diagnostics v_workouts_deleted = row_count;

    return jsonb_build_object(
        'heartRateSamplesDeleted', v_hr_deleted,
        'workoutSummariesDeleted', v_workouts_deleted
    );
end;
$$;

create function public.fitness_refresh_connection_tokens(
    p_user_id uuid,
    p_connection_id uuid,
    p_expected_generation integer,
    p_provider_account_key text,
    p_access_token_ciphertext text,
    p_refresh_token_ciphertext text default null,
    p_access_token_expires_at timestamptz default null,
    p_scopes text[] default '{}'::text[],
    p_encryption_key_version text default 'v1'
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
    v_connection_id uuid;
begin
    select connection.id
    into v_connection_id
    from public.fitness_connections as connection
    join app_private.fitness_connection_tokens as token
      on token.connection_id = connection.id
    where connection.id = p_connection_id
      and connection.user_id = p_user_id
      and connection.status = 'active'
      and connection.generation = p_expected_generation
      and token.provider_account_key = p_provider_account_key
    for update of connection, token;

    if v_connection_id is null then
        return false;
    end if;

    update app_private.fitness_connection_tokens
    set access_token_ciphertext = p_access_token_ciphertext,
        refresh_token_ciphertext = coalesce(
            p_refresh_token_ciphertext,
            refresh_token_ciphertext
        ),
        access_token_expires_at = p_access_token_expires_at,
        encryption_key_version = p_encryption_key_version,
        updated_at = now()
    where connection_id = v_connection_id;

    update public.fitness_connections
    set scopes = case
            when cardinality(coalesce(p_scopes, '{}'::text[])) = 0
                then scopes
            else p_scopes
        end,
        last_error_code = null,
        updated_at = now()
    where id = v_connection_id;

    return true;
end;
$$;

-- A reconnect may authorize a different upstream account. The schema keeps a
-- single provider row per Orbital user, so generation changes deliberately
-- clear the previous generation's derived health data before mixing is
-- possible. Consent history remains available for the life of the account.
create function app_private.fitness_purge_reconnected_generation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.generation > old.generation then
        delete from public.fitness_hr_samples where connection_id = new.id;
        delete from public.fitness_hr_5m where connection_id = new.id;
        delete from public.fitness_summaries where connection_id = new.id;
        delete from public.fitness_workout_summaries where connection_id = new.id;
        delete from public.fitness_workout_sessions where connection_id = new.id;
        delete from public.fitness_daily_metrics where connection_id = new.id;
    end if;
    return new;
end;
$$;

revoke all on function app_private.fitness_purge_reconnected_generation()
from public, anon, authenticated, service_role;

create trigger fitness_connections_purge_reconnected_generation
after update of generation on public.fitness_connections
for each row
when (new.generation > old.generation)
execute function app_private.fitness_purge_reconnected_generation();

-- Return a full-span plot without an earliest-samples bias. Raw statistics use
-- every retained sample; the response series selects one representative from
-- each equal-sized time-ordered bin and therefore includes the workout tail.
create or replace function public.fitness_get_workout_raw_detail(
    p_user_id uuid,
    p_workout_session_id uuid,
    p_max_samples integer default 5000
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
    v_result jsonb;
begin
    if p_max_samples is null or p_max_samples not between 1 and 5000 then
        raise exception using
            errcode = '22023',
            message = 'The workout sample limit is invalid.';
    end if;

    with selected_session as (
        select session.*
        from public.fitness_workout_sessions as session
        where session.id = p_workout_session_id
          and session.user_id = p_user_id
    ), raw as materialized (
        select sample.sampled_at, sample.bpm
        from selected_session as session
        join public.fitness_hr_samples as sample
          on sample.connection_id = session.connection_id
         and sample.user_id = session.user_id
         and sample.sampled_at >= session.started_at
         and sample.sampled_at <= coalesce(
             session.ended_at,
             least(now(), session.started_at + interval '48 hours')
         )
         and (
             sample.source_session_key is null
             or sample.source_session_key = session.source_session_key
         )
    ), ranked as (
        select
            raw.sampled_at,
            raw.bpm,
            row_number() over (order by raw.sampled_at) as ordinal,
            count(*) over () as total_rows
        from raw
    ), sampled as (
        select distinct on (
            floor(
                (ranked.ordinal - 1)::numeric
                * least(p_max_samples::bigint, ranked.total_rows)
                / greatest(ranked.total_rows, 1)
            )
        )
            ranked.sampled_at,
            ranked.bpm
        from ranked
        order by
            floor(
                (ranked.ordinal - 1)::numeric
                * least(p_max_samples::bigint, ranked.total_rows)
                / greatest(ranked.total_rows, 1)
            ),
            ranked.ordinal desc
    ), raw_statistics as (
        select
            count(*)::integer as sample_count,
            avg(raw.bpm)::numeric as average_bpm,
            max(raw.bpm)::smallint as maximum_bpm
        from raw
    )
    select jsonb_build_object(
        'workoutSessionId', session.id,
        'status', case when session.ended_at is null then 'active' else 'complete' end,
        'startedAt', session.started_at,
        'endedAt', session.ended_at,
        'rawSummary', jsonb_build_object(
            'sampleCount', statistics.sample_count,
            'averageBpm', statistics.average_bpm,
            'maximumBpm', statistics.maximum_bpm
        ),
        'samples', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'recordedAt', sample.sampled_at,
                    'bpm', sample.bpm
                ) order by sample.sampled_at
            )
            from sampled as sample
        ), '[]'::jsonb),
        'buckets', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'bucketStart', bucket.bucket_start,
                    'minBpm', bucket.minimum_bpm,
                    'maxBpm', bucket.maximum_bpm,
                    'avgBpm', bucket.average_bpm,
                    'sampleCount', coalesce(bucket.sample_count, 1)
                ) order by bucket.bucket_start
            )
            from public.fitness_hr_5m as bucket
            where bucket.connection_id = session.connection_id
              and bucket.user_id = session.user_id
              and bucket.bucket_start >= to_timestamp(
                  floor(extract(epoch from session.started_at) / 300) * 300
              )
              and bucket.bucket_start <= coalesce(
                  session.ended_at,
                  least(now(), session.started_at + interval '48 hours')
              )
        ), '[]'::jsonb)
    ) into v_result
    from selected_session as session
    cross join raw_statistics as statistics;

    return v_result;
end;
$$;

revoke all on function public.fitness_refresh_connection_tokens(
    uuid, uuid, integer, text, text, text, timestamptz, text[], text
) from public, anon, authenticated;
revoke all on function public.fitness_delete_mobile_source_records(
    uuid, uuid, jsonb, integer
) from public, anon, authenticated;

revoke all on function public.fitness_store_connection_tokens(
    uuid, text, text, text, text, timestamptz, text[], text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.fitness_register_device_connection(
    uuid, text, text, text[], text, jsonb
) from public, anon, authenticated;
revoke all on function public.fitness_load_connection_tokens(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.fitness_upsert_daily_metrics(uuid, uuid, jsonb, integer)
from public, anon, authenticated;
revoke all on function public.fitness_upsert_workout_summaries(uuid, uuid, jsonb, integer)
from public, anon, authenticated;
revoke all on function public.fitness_upsert_hr_buckets(uuid, uuid, jsonb, integer)
from public, anon, authenticated;
revoke all on function public.fitness_ingest_hr_samples(uuid, uuid, jsonb, integer)
from public, anon, authenticated;
revoke all on function public.fitness_start_workout_session(
    uuid, uuid, text, timestamptz, text, jsonb
) from public, anon, authenticated;
revoke all on function public.fitness_end_workout_session(
    uuid, uuid, text, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.fitness_disconnect_provider(uuid, uuid, boolean)
from public, anon, authenticated;
revoke all on function public.fitness_get_workout_raw_detail(uuid, uuid, integer)
from public, anon, authenticated;
revoke all on function public.fitness_claim_connection_sync(
    uuid, uuid, integer, integer, text
) from public, anon, authenticated;
revoke all on function public.fitness_claim_sync_lease(text, integer, integer)
from public, anon, authenticated;
revoke all on function public.fitness_complete_sync_lease(
    uuid, uuid, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.fitness_fail_sync_lease(
    uuid, uuid, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.fitness_run_retention(integer, integer, integer)
from public, anon, authenticated;

grant execute on function public.fitness_store_connection_tokens(
    uuid, text, text, text, text, timestamptz, text[], text, text, jsonb
) to service_role;
grant execute on function public.fitness_refresh_connection_tokens(
    uuid, uuid, integer, text, text, text, timestamptz, text[], text
) to service_role;
grant execute on function public.fitness_delete_mobile_source_records(
    uuid, uuid, jsonb, integer
) to service_role;
grant execute on function public.fitness_register_device_connection(
    uuid, text, text, text[], text, jsonb
) to service_role;
grant execute on function public.fitness_load_connection_tokens(uuid, uuid)
to service_role;
grant execute on function public.fitness_upsert_daily_metrics(uuid, uuid, jsonb, integer)
to service_role;
grant execute on function public.fitness_upsert_workout_summaries(uuid, uuid, jsonb, integer)
to service_role;
grant execute on function public.fitness_upsert_hr_buckets(uuid, uuid, jsonb, integer)
to service_role;
grant execute on function public.fitness_ingest_hr_samples(uuid, uuid, jsonb, integer)
to service_role;
grant execute on function public.fitness_start_workout_session(
    uuid, uuid, text, timestamptz, text, jsonb
) to service_role;
grant execute on function public.fitness_end_workout_session(
    uuid, uuid, text, timestamptz, jsonb
) to service_role;
grant execute on function public.fitness_disconnect_provider(uuid, uuid, boolean)
to service_role;
grant execute on function public.fitness_get_workout_raw_detail(uuid, uuid, integer)
to service_role;
grant execute on function public.fitness_claim_connection_sync(
    uuid, uuid, integer, integer, text
) to service_role;
grant execute on function public.fitness_claim_sync_lease(text, integer, integer)
to service_role;
grant execute on function public.fitness_complete_sync_lease(
    uuid, uuid, text, timestamptz
) to service_role;
grant execute on function public.fitness_fail_sync_lease(
    uuid, uuid, text, timestamptz
) to service_role;
grant execute on function public.fitness_run_retention(integer, integer, integer)
to service_role;

revoke all on function public.fitness_get_workout_detail(uuid)
from public, anon, service_role;
grant execute on function public.fitness_get_workout_detail(uuid)
to authenticated;
