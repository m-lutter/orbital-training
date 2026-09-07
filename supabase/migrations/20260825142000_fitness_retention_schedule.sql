-- Keep short-lived workout heart-rate samples and private fitness audit events
-- bounded without depending on an application request. The named job is
-- replaced when this migration is replayed so local resets and repaired
-- deployments cannot accumulate duplicate retention jobs.

create extension if not exists pg_cron with schema pg_catalog;

do $migration$
declare
    v_job_id bigint;
begin
    for v_job_id in
        select job.jobid
        from cron.job as job
        where job.jobname in (
            'orbital-fitness-retention-daily',
            'orbital-fitness-retention-hourly'
        )
    loop
        perform cron.unschedule(v_job_id);
    end loop;

    perform cron.schedule(
        'orbital-fitness-retention-hourly',
        '23 * * * *',
        $command$select public.fitness_run_retention(7, 365, 20000);$command$
    );
end;
$migration$;
