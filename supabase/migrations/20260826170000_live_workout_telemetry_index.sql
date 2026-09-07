-- Five-second live chart reads use an exclusive sampled_at cursor scoped to a
-- single capture. This partial index keeps those reads, latest-sample lookups,
-- and resets bounded without indexing unrelated untagged health data.

create index if not exists fitness_hr_samples_capture_time_idx
on public.fitness_hr_samples (
    connection_id,
    source_session_key,
    sampled_at desc
)
where source_session_key is not null;
