begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_index(
    'public',
    'fitness_hr_samples',
    'fitness_hr_samples_capture_time_idx',
    'live capture cursor reads have a capture-specific time index'
);

select * from finish();
rollback;
