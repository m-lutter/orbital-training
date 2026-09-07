-- Persist the work a user actually performs separately from the immutable
-- program prescription. A substituted exercise keeps its own performance
-- series inside exercise_logs so its load history is never mixed with the
-- original movement.

alter table public.programs
add constraint programs_id_user_id_key unique (id, user_id);

create table public.workout_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    program_id uuid not null,
    program_version integer not null check (program_version > 0),
    session_id text not null check (char_length(session_id) between 1 and 200),
    week_number integer not null check (week_number > 0),
    session_sequence integer not null check (session_sequence > 0),
    status text not null default 'in_progress'
        check (status in ('in_progress', 'completed', 'partial', 'skipped')),
    exercise_logs jsonb not null default '[]'::jsonb
        check (jsonb_typeof(exercise_logs) = 'array'),
    cardio_log jsonb not null default '{}'::jsonb
        check (jsonb_typeof(cardio_log) = 'object'),
    duration_minutes integer check (duration_minutes between 0 and 1440),
    miss_reason text check (miss_reason is null or char_length(miss_reason) <= 100),
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (program_id, program_version, session_id),
    constraint workout_logs_owned_program_fk
        foreign key (program_id, user_id)
        references public.programs(id, user_id)
        on delete cascade
);

create index workout_logs_user_id_idx on public.workout_logs(user_id);
create index workout_logs_program_id_idx on public.workout_logs(program_id);
create index workout_logs_program_order_idx
on public.workout_logs(program_id, program_version, week_number, session_sequence);

create or replace function public.set_workout_log_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger workout_logs_set_updated_at
before update on public.workout_logs
for each row execute function public.set_workout_log_updated_at();

alter table public.workout_logs enable row level security;

create policy "workout_logs_select_own"
on public.workout_logs
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "workout_logs_insert_own"
on public.workout_logs
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "workout_logs_update_own"
on public.workout_logs
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "workout_logs_delete_own"
on public.workout_logs
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.workout_logs from anon;
grant select, insert, update, delete on public.workout_logs to authenticated;

create or replace function public.workout_logging_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select jsonb_build_object(
        'ready', true,
        'workoutLogVersion', 1,
        'migration', '20260807070000_workout_logging'
    );
$$;

revoke all on function public.workout_logging_status() from public;
grant execute on function public.workout_logging_status() to authenticated;

notify pgrst, 'reload schema';
