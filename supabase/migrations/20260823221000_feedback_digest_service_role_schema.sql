-- Public digest wrappers call tightly granted implementations in app_private.
-- Schema usage only permits name resolution; object privileges remain revoked
-- unless explicitly granted by the preceding digest migration.

grant usage on schema app_private to service_role;
