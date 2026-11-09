-- Shopping lists: a name and its items (each with a done flag). Nothing is deleted: a list is archived through
-- archived_at_ms and an item through its own archivedAt; finished_at_ms says the shopping was done and billed.
create table shopping_lists (
  user_id        text not null,
  id             text not null,
  name           text not null check (char_length(name) between 1 and 60),
  items          jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 300),
  finished_at_ms bigint,
  created_at_ms  bigint,
  archived_at_ms bigint,
  updated_at     timestamptz not null default now(),
  primary key (user_id, id)
);
create index shopping_lists_user_idx on shopping_lists (user_id);
