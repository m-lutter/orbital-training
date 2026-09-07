-- Bound the lifetime of workout requests so an overloaded or stale client
-- cannot keep Data API/Postgres request memory and connections occupied.
-- Normal workout context/save calls are expected to complete well below 1s.

alter function public.workout_session_context(uuid, text)
    set statement_timeout = '5s';

alter function public.save_workout_log_v6(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb, text
)
    set statement_timeout = '5s';

alter function public.save_workout_log_v6(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb, text
)
    set lock_timeout = '1s';

alter function app_private.save_workout_log_v6_impl(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb, text
)
    set statement_timeout = '5s';

alter function app_private.save_workout_log_v6_impl(
    uuid, integer, text, integer, integer, text, jsonb, jsonb, jsonb,
    integer, text, jsonb, jsonb, text
)
    set lock_timeout = '1s';

notify pgrst, 'reload config';
