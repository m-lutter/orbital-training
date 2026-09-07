-- Immutable inputs and engine outputs for questionnaire/engine schema v3.
-- Existing programs.payload rows remain valid and readable.

create table public.questionnaire_responses (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    program_id uuid not null references public.programs(id) on delete cascade,
    version_number integer not null check (version_number > 0),
    questionnaire_version integer not null check (questionnaire_version > 0),
    response jsonb not null check (jsonb_typeof(response) = 'object'),
    created_at timestamptz not null default now(),
    unique (program_id, version_number)
);

create table public.program_versions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    program_id uuid not null references public.programs(id) on delete cascade,
    questionnaire_response_id uuid not null references public.questionnaire_responses(id) on delete restrict,
    version_number integer not null check (version_number > 0),
    engine_version text not null,
    policy_version text not null,
    input_fingerprint text not null,
    payload jsonb not null check (jsonb_typeof(payload) = 'object'),
    created_at timestamptz not null default now(),
    unique (program_id, version_number)
);

create index questionnaire_responses_user_id_idx
on public.questionnaire_responses(user_id);

create index questionnaire_responses_program_id_idx
on public.questionnaire_responses(program_id);

create index program_versions_user_id_idx
on public.program_versions(user_id);

create index program_versions_program_id_idx
on public.program_versions(program_id);

alter table public.questionnaire_responses enable row level security;
alter table public.program_versions enable row level security;

create policy "questionnaire_responses_select_own"
on public.questionnaire_responses
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "program_versions_select_own"
on public.program_versions
for select
to authenticated
using ((select auth.uid()) = user_id);

-- The authenticated client may read its immutable history. Creation goes
-- through the function below so the three initial rows commit atomically.
revoke all on public.questionnaire_responses from anon, authenticated;
revoke all on public.program_versions from anon, authenticated;
grant select on public.questionnaire_responses to authenticated;
grant select on public.program_versions to authenticated;

create or replace function public.create_program_with_initial_version(
    p_name text,
    p_questionnaire_version integer,
    p_engine_version text,
    p_policy_version text,
    p_input_fingerprint text,
    p_questionnaire jsonb,
    p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_program_id uuid;
    v_response_id uuid;
begin
    if v_user_id is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;

    if p_name is null or char_length(btrim(p_name)) < 1 or char_length(btrim(p_name)) > 100 then
        raise exception 'Program name must contain 1 to 100 characters.' using errcode = '22023';
    end if;

    if p_questionnaire_version <> 2 then
        raise exception 'Unsupported questionnaire version.' using errcode = '22023';
    end if;

    if jsonb_typeof(p_questionnaire) <> 'object'
       or jsonb_typeof(p_payload) <> 'object'
       or p_payload ->> 'schemaVersion' <> '3' then
        raise exception 'Invalid questionnaire or program payload.' using errcode = '22023';
    end if;

    if coalesce(char_length(p_engine_version), 0) < 1
       or coalesce(char_length(p_policy_version), 0) < 1
       or coalesce(char_length(p_input_fingerprint), 0) < 1 then
        raise exception 'Version metadata is required.' using errcode = '22023';
    end if;

    insert into public.programs (user_id, name, payload)
    values (v_user_id, btrim(p_name), p_payload)
    returning id into v_program_id;

    insert into public.questionnaire_responses (
        user_id,
        program_id,
        version_number,
        questionnaire_version,
        response
    )
    values (
        v_user_id,
        v_program_id,
        1,
        p_questionnaire_version,
        p_questionnaire
    )
    returning id into v_response_id;

    insert into public.program_versions (
        user_id,
        program_id,
        questionnaire_response_id,
        version_number,
        engine_version,
        policy_version,
        input_fingerprint,
        payload
    )
    values (
        v_user_id,
        v_program_id,
        v_response_id,
        1,
        p_engine_version,
        p_policy_version,
        p_input_fingerprint,
        p_payload
    );

    return v_program_id;
end;
$$;

revoke all on function public.create_program_with_initial_version(
    text,
    integer,
    text,
    text,
    text,
    jsonb,
    jsonb
) from public;

grant execute on function public.create_program_with_initial_version(
    text,
    integer,
    text,
    text,
    text,
    jsonb,
    jsonb
) to authenticated;
