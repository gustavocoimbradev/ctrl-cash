-- A second permission for a connected assistant: acting on the person's social side (profile, sharing, messages). Reading and
-- changing the person's own finances stay as they were (can_write). Everything an assistant changes is written to a log the
-- person can read; nothing in it is ever deleted.
alter table assistant_connections add column can_social boolean not null default false;

create table assistant_actions (
  id             bigserial primary key,
  user_id        text not null,
  connection_id  text not null references assistant_connections (id),
  tool           text not null check (char_length(tool) between 1 and 60),
  summary        text not null check (char_length(summary) <= 300),
  created_at_ms  bigint not null
);
create index assistant_actions_user_idx on assistant_actions (user_id, created_at_ms desc);
create index assistant_actions_connection_idx on assistant_actions (connection_id, created_at_ms desc);
