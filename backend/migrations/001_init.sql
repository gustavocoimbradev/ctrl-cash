-- Ctrl+Cash schema. One table per collection; primary key (user_id, id).
-- Nothing is ever deleted: removal is a soft delete through archived_at_ms.

create table transactions (
  user_id          text not null,
  id               text not null,
  type             text not null check (type in ('income', 'expense')),
  description      text not null check (char_length(description) between 1 and 100),
  amount           bigint not null check (amount > 0 and amount <= 100000000000),
  date             date not null,
  confirmed        boolean not null,
  fixed            boolean not null,
  confirmed_months text[] not null check (cardinality(confirmed_months) <= 600),
  card_id          text check (card_id is null or char_length(card_id) between 1 and 40),
  reserve_id       text check (reserve_id is null or char_length(reserve_id) between 1 and 40),
  invoice_key      text check (invoice_key is null or invoice_key ~ '^[0-9]{4}-[0-9]{2}$'),
  category         text check (category is null or char_length(category) between 1 and 40),
  installment      jsonb check (installment is null or jsonb_typeof(installment) = 'object'),
  revisions        jsonb check (revisions is null or (fixed and jsonb_typeof(revisions) = 'array' and jsonb_array_length(revisions) <= 60)),
  overrides        jsonb check (overrides is null or (fixed and jsonb_typeof(overrides) = 'object')),
  created_at_ms    bigint,
  archived_at_ms   bigint,
  updated_at       timestamptz not null default now(),
  primary key (user_id, id),
  check (card_id is null or reserve_id is null),
  check (reserve_id is null or type = 'expense')
);
create index transactions_user_date_idx on transactions (user_id, date);
create index transactions_user_card_idx on transactions (user_id, card_id) where card_id is not null;

create table cards (
  user_id        text not null,
  id             text not null,
  name           text not null check (char_length(name) between 1 and 60),
  credit_limit   bigint not null check (credit_limit > 0 and credit_limit <= 100000000000),
  due_day        integer not null check (due_day between 1 and 31),
  color          text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at_ms  bigint,
  archived_at_ms bigint,
  updated_at     timestamptz not null default now(),
  primary key (user_id, id)
);
create index cards_user_idx on cards (user_id);

create table payments (
  user_id        text not null,
  id             text not null,
  card_id        text not null check (char_length(card_id) between 1 and 40),
  invoice_key    text not null check (invoice_key ~ '^[0-9]{4}-[0-9]{2}$'),
  amount         bigint not null check (amount > 0 and amount <= 100000000000),
  date           date not null,
  archived_at_ms bigint,
  updated_at     timestamptz not null default now(),
  primary key (user_id, id)
);
create index payments_user_date_idx on payments (user_id, date);
create index payments_user_card_idx on payments (user_id, card_id);

create table reserves (
  user_id        text not null,
  id             text not null,
  name           text not null check (char_length(name) between 1 and 60),
  goal           bigint check (goal is null or (goal > 0 and goal <= 100000000000)),
  created_at_ms  bigint,
  archived_at_ms bigint,
  updated_at     timestamptz not null default now(),
  primary key (user_id, id)
);
create index reserves_user_idx on reserves (user_id);

create table reserve_moves (
  user_id        text not null,
  id             text not null,
  reserve_id     text not null check (char_length(reserve_id) between 1 and 40),
  type           text not null check (type in ('deposit', 'withdraw')),
  amount         bigint not null check (amount > 0 and amount <= 100000000000),
  date           date not null,
  confirmed      boolean,
  created_at_ms  bigint,
  archived_at_ms bigint,
  updated_at     timestamptz not null default now(),
  primary key (user_id, id)
);
create index reserve_moves_user_date_idx on reserve_moves (user_id, date);
create index reserve_moves_user_reserve_idx on reserve_moves (user_id, reserve_id);

create table categories (
  user_id        text not null,
  id             text not null,
  slug           text not null check (char_length(slug) between 1 and 60),
  kind           text not null check (kind in ('expense', 'income')),
  name           text not null check (char_length(name) between 1 and 40),
  weight         double precision check (weight is null or (weight between 0 and 1 and kind = 'expense')),
  created_at_ms  bigint,
  archived_at_ms bigint,
  updated_at     timestamptz not null default now(),
  primary key (user_id, id)
);
create index categories_user_idx on categories (user_id);
