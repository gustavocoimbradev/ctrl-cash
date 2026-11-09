-- Connecting an AI assistant (Claude) to a person's own data through MCP, with OAuth 2.1 (authorization code + PKCE).
-- Nothing is deleted: a connection is revoked by stamping revoked_at_ms; codes and tokens only store hashes and just expire.

-- clients that registered themselves (RFC 7591); public clients, exact redirect URIs
create table oauth_clients (
  client_id     text primary key check (char_length(client_id) between 8 and 100),
  name          text not null check (char_length(name) between 1 and 80),
  redirect_uris jsonb not null check (jsonb_typeof(redirect_uris) = 'array' and jsonb_array_length(redirect_uris) between 1 and 5),
  created_at_ms bigint not null
);

-- what a person allowed: one row per assistant they connected
create table assistant_connections (
  id             text primary key check (char_length(id) between 8 and 100),
  user_id        text not null,
  client_id      text not null references oauth_clients (client_id),
  client_name    text not null,
  created_at_ms  bigint not null,
  last_used_ms   bigint,
  revoked_at_ms  bigint
);
create index assistant_connections_user_idx on assistant_connections (user_id);

create table oauth_codes (
  code_hash       text primary key,
  connection_id   text not null references assistant_connections (id),
  client_id       text not null,
  redirect_uri    text not null,
  code_challenge  text not null,
  expires_at_ms   bigint not null,
  used_at_ms      bigint
);

create table oauth_tokens (
  token_hash     text primary key,
  kind           text not null check (kind in ('access', 'refresh')),
  connection_id  text not null references assistant_connections (id),
  expires_at_ms  bigint not null,
  used_at_ms     bigint
);
create index oauth_tokens_connection_idx on oauth_tokens (connection_id);

-- the picture of the person's finances the assistant reads (made by the app, like the shared summary)
create table assistant_snapshots (
  user_id       text primary key,
  snapshot      jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  updated_at_ms bigint not null
);
