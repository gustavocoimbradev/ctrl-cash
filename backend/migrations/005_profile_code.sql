-- People now find each other by a short public code (6 characters: digits and letters, no I and no O) instead of the uuid,
-- which stays in the table, unused. Existing profiles get their code lazily, the next time the API loads them.
alter table profiles add column code text check (code is null or code ~ '^[0-9A-HJ-NP-Z]{6}$');
create unique index profiles_code_idx on profiles (code);
