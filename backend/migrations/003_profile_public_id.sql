-- People are now identified by a public random uuid instead of a handle. Non-destructive: the handle column (and its
-- constraints) stays but becomes optional and is never written again; bio stays in the table, unused.
-- The public id is NOT the Firebase user id, which still never leaves the server.
alter table profiles add column public_id uuid not null default gen_random_uuid();
create unique index profiles_public_id_idx on profiles (public_id);
alter table profiles alter column handle drop not null;
