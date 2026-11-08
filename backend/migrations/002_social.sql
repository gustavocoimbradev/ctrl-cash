-- Social layer: public profiles, follows, direct messages and the shared monthly summary.
-- Nothing is ever removed: unfollowing archives the follow, revoking a share stamps revoked_at_ms, and messages are
-- never removed. People are addressed by handle; the Firebase user id stays internal and is never returned by the API.

create table profiles (
  user_id       text primary key,
  handle        text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name  text not null check (char_length(display_name) between 1 and 40),
  bio           text check (bio is null or char_length(bio) between 1 and 160),
  color         text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at_ms bigint not null,
  updated_at    timestamptz not null default now()
);

create table follows (
  follower_id    text not null,
  followee_id    text not null,
  created_at_ms  bigint not null,
  archived_at_ms bigint,
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on follows (followee_id) where archived_at_ms is null;
create index follows_follower_idx on follows (follower_id) where archived_at_ms is null;

create table messages (
  seq           bigserial not null,
  id            text primary key check (char_length(id) between 1 and 100),
  sender_id     text not null,
  recipient_id  text not null,
  body          text not null check (char_length(body) between 1 and 1000),
  created_at_ms bigint not null,
  read_at_ms    bigint,
  check (sender_id <> recipient_id)
);
create index messages_thread_idx on messages (recipient_id, sender_id, created_at_ms);
create index messages_sent_idx on messages (sender_id, recipient_id, created_at_ms);
create index messages_unread_idx on messages (recipient_id, sender_id) where read_at_ms is null;

create table summary_shares (
  owner_id       text not null,
  viewer_id      text not null,
  created_at_ms  bigint not null,
  revoked_at_ms  bigint,
  primary key (owner_id, viewer_id),
  check (owner_id <> viewer_id)
);
create index summary_shares_viewer_idx on summary_shares (viewer_id) where revoked_at_ms is null;

create table profile_summaries (
  user_id       text primary key,
  summary       jsonb not null check (jsonb_typeof(summary) = 'object'),
  updated_at_ms bigint not null
);
