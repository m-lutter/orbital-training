-- One profile for every authenticated user.
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null default '',
    created_at timestamptz not null default now()
);

-- A deliberately minimal program record for the security proof.
create table public.programs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null default 'Untitled program',
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index programs_user_id_idx on public.programs(user_id);

-- Automatically create a profile after signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, display_name)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'display_name', '')
    );

    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

-- RLS must be enabled explicitly.
alter table public.profiles enable row level security;
alter table public.programs enable row level security;

-- Profile policies.
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Program policies.
create policy "programs_select_own"
on public.programs
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "programs_insert_own"
on public.programs
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "programs_update_own"
on public.programs
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "programs_delete_own"
on public.programs
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Only authenticated users receive ordinary table access.
revoke all on public.profiles from anon;
revoke all on public.programs from anon;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.programs to authenticated;