-- Wishlist: things the person wants to buy, with an optional price (smallest currency unit), an optional link and a note.
-- Nothing is deleted: archived_at_ms hides an item; bought_at_ms says it was bought (and billed).
create table wishlist (
  user_id        text not null,
  id             text not null,
  name           text not null check (char_length(name) between 1 and 80),
  price          bigint check (price is null or (price > 0 and price <= 100000000000)),
  url            text check (url is null or (char_length(url) <= 500 and url ~ '^https?://')),
  note           text check (note is null or char_length(note) between 1 and 300),
  bought_at_ms   bigint,
  created_at_ms  bigint,
  archived_at_ms bigint,
  updated_at     timestamptz not null default now(),
  primary key (user_id, id)
);
create index wishlist_user_idx on wishlist (user_id);
