-- Make deleting an owned program reliably cascade through every child row.
-- PostgreSQL reuses the released table space; routine autovacuum handles the
-- physical cleanup without an application-side maintenance operation.

alter table public.program_versions
drop constraint if exists program_versions_questionnaire_response_id_fkey;

alter table public.program_versions
add constraint program_versions_questionnaire_response_id_fkey
foreign key (questionnaire_response_id)
references public.questionnaire_responses(id)
on delete cascade;

notify pgrst, 'reload schema';
