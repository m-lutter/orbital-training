-- Store one immutable review for each completed program week. If the review
-- changes future prescriptions, record the new program version and update the
-- current payload in the same transaction.

create table public.weekly_reviews (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    program_id uuid not null,
    week_number integer not null check (week_number > 0),
    source_program_version integer not null check (source_program_version > 0),
    result_program_version integer not null check (result_program_version > 0),
    decision text not null
        check (decision in ('applied', 'kept', 'no_change')),
    state text not null
        check (state in (
            'on_track',
            'underloaded',
            'physiologically_overloaded',
            'time_infeasible',
            'schedule_infeasible',
            'exercise_mismatch',
            'safety_constrained',
            'insufficient_data'
        )),
    confidence text not null check (confidence in ('low', 'moderate', 'high')),
    metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
    result jsonb not null check (jsonb_typeof(result) = 'object'),
    created_at timestamptz not null default now(),
    unique (program_id, week_number),
    constraint weekly_reviews_owned_program_fk
        foreign key (program_id, user_id)
        references public.programs(id, user_id)
        on delete cascade
);

-- Current application writes use security-definer transactions. Prevent a
-- client from bypassing immutable versions by replacing programs.payload
-- directly. Owners retain select and delete access.
revoke insert, update on public.programs from authenticated;

create index weekly_reviews_user_id_idx on public.weekly_reviews(user_id);
create index weekly_reviews_program_id_idx on public.weekly_reviews(program_id);

alter table public.weekly_reviews enable row level security;

create policy "weekly_reviews_select_own"
on public.weekly_reviews
for select
to authenticated
using ((select auth.uid()) = user_id);

-- Reviews are written only by record_weekly_review so the review row, current
-- payload, and immutable version cannot get out of sync.
revoke all on public.weekly_reviews from anon, authenticated;
grant select on public.weekly_reviews to authenticated;

create or replace function public.record_weekly_review(
    p_program_id uuid,
    p_source_program_version integer,
    p_week_number integer,
    p_decision text,
    p_state text,
    p_confidence text,
    p_metrics jsonb,
    p_result jsonb,
    p_new_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_program_payload jsonb;
    v_current_version integer;
    v_result_version integer := p_source_program_version;
    v_questionnaire_response_id uuid;
    v_review_id uuid;
    v_existing public.weekly_reviews%rowtype;
    v_old_completed_weeks jsonb;
    v_new_completed_weeks jsonb;
begin
    if v_user_id is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;

    if p_week_number < 1 or p_source_program_version < 1 then
        raise exception 'Invalid week or source version.' using errcode = '22023';
    end if;

    if p_decision not in ('applied', 'kept', 'no_change')
       or p_state not in (
           'on_track',
           'underloaded',
           'physiologically_overloaded',
           'time_infeasible',
           'schedule_infeasible',
           'exercise_mismatch',
           'safety_constrained',
           'insufficient_data'
       )
       or p_confidence not in ('low', 'moderate', 'high') then
        raise exception 'Invalid weekly review result.' using errcode = '22023';
    end if;

    if jsonb_typeof(p_metrics) <> 'object'
       or jsonb_typeof(p_result) <> 'object' then
        raise exception 'Review metrics and result must be objects.' using errcode = '22023';
    end if;

    select payload into v_program_payload
    from public.programs
    where id = p_program_id
      and user_id = v_user_id
    for update;

    if not found then
        raise exception 'Program not found.' using errcode = 'P0002';
    end if;

    select * into v_existing
    from public.weekly_reviews
    where program_id = p_program_id
      and user_id = v_user_id
      and week_number = p_week_number;

    if found then
        return jsonb_build_object(
            'reviewId', v_existing.id,
            'programVersion', v_existing.result_program_version,
            'alreadyRecorded', true
        );
    end if;

    begin
        v_current_version := (v_program_payload #>> '{program,version}')::integer;
    exception when others then
        raise exception 'The current program payload has no valid version.' using errcode = '22023';
    end;

    if v_current_version <> p_source_program_version then
        raise exception 'The program changed before this review was saved. Reload and review again.'
            using errcode = '40001';
    end if;

    if p_new_payload is not null then
        if p_decision <> 'applied'
           or jsonb_typeof(p_new_payload) <> 'object'
           or p_new_payload ->> 'schemaVersion' <> '3'
           or (p_new_payload #>> '{program,version}')::integer <> p_source_program_version + 1 then
            raise exception 'Invalid adapted program payload.' using errcode = '22023';
        end if;

        if p_new_payload -> 'inputSnapshot' <> v_program_payload -> 'inputSnapshot'
           or p_new_payload #>> '{program,id}' <> v_program_payload #>> '{program,id}' then
            raise exception 'Adaptation cannot replace the questionnaire or program identity.' using errcode = '22023';
        end if;

        select coalesce(jsonb_agg(item order by (item ->> 'weekNumber')::integer), '[]'::jsonb)
        into v_old_completed_weeks
        from jsonb_array_elements(v_program_payload #> '{program,weeks}') as elements(item)
        where (item ->> 'weekNumber')::integer <= p_week_number;

        select coalesce(jsonb_agg(item order by (item ->> 'weekNumber')::integer), '[]'::jsonb)
        into v_new_completed_weeks
        from jsonb_array_elements(p_new_payload #> '{program,weeks}') as elements(item)
        where (item ->> 'weekNumber')::integer <= p_week_number;

        if v_new_completed_weeks <> v_old_completed_weeks then
            raise exception 'Adaptation cannot rewrite completed weeks.' using errcode = '22023';
        end if;

        select questionnaire_response_id into v_questionnaire_response_id
        from public.program_versions
        where program_id = p_program_id
          and user_id = v_user_id
          and version_number = p_source_program_version;

        if v_questionnaire_response_id is null then
            raise exception 'The source program version was not found.' using errcode = 'P0002';
        end if;

        v_result_version := p_source_program_version + 1;

        insert into public.program_versions (
            user_id,
            program_id,
            questionnaire_response_id,
            version_number,
            engine_version,
            policy_version,
            input_fingerprint,
            payload
        ) values (
            v_user_id,
            p_program_id,
            v_questionnaire_response_id,
            v_result_version,
            p_new_payload ->> 'engineVersion',
            p_new_payload ->> 'policyVersion',
            p_new_payload #>> '{program,inputFingerprint}',
            p_new_payload
        );

        update public.programs
        set payload = p_new_payload
        where id = p_program_id and user_id = v_user_id;
    elsif p_decision = 'applied' then
        raise exception 'An applied review requires a new payload.' using errcode = '22023';
    end if;

    insert into public.weekly_reviews (
        user_id,
        program_id,
        week_number,
        source_program_version,
        result_program_version,
        decision,
        state,
        confidence,
        metrics,
        result
    ) values (
        v_user_id,
        p_program_id,
        p_week_number,
        p_source_program_version,
        v_result_version,
        p_decision,
        p_state,
        p_confidence,
        p_metrics,
        p_result
    ) returning id into v_review_id;

    return jsonb_build_object(
        'reviewId', v_review_id,
        'programVersion', v_result_version,
        'alreadyRecorded', false
    );
end;
$$;

revoke all on function public.record_weekly_review(
    uuid,
    integer,
    integer,
    text,
    text,
    text,
    jsonb,
    jsonb,
    jsonb
) from public;

grant execute on function public.record_weekly_review(
    uuid,
    integer,
    integer,
    text,
    text,
    text,
    jsonb,
    jsonb,
    jsonb
) to authenticated;

-- Once a week is reviewed, its observations are frozen. Cascading deletion of
-- the parent program remains allowed because the parent row no longer exists
-- when its child logs are removed.
create or replace function public.protect_reviewed_workout_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if exists (
        select 1
        from public.programs
        where id = old.program_id
    ) and exists (
        select 1
        from public.weekly_reviews
        where program_id = old.program_id
          and week_number = old.week_number
    ) then
        raise exception 'A reviewed workout log cannot be changed.' using errcode = '55000';
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

revoke all on function public.protect_reviewed_workout_log() from public;

create trigger workout_logs_protect_reviewed_history
before update or delete on public.workout_logs
for each row execute function public.protect_reviewed_workout_log();

create or replace function public.weekly_adaptation_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select jsonb_build_object(
        'ready', true,
        'weeklyReviewVersion', 1,
        'migration', '20260814090000_weekly_feedback_and_adaptation'
    );
$$;

revoke all on function public.weekly_adaptation_status() from public;
grant execute on function public.weekly_adaptation_status() to authenticated;

notify pgrst, 'reload schema';
