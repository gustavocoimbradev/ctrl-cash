-- Account preferences: the language the app speaks and the currency money is shown in. One row per account; amounts
-- stay stored in the currency's smallest unit and are not converted when the currency changes.
create table settings (
  user_id    text primary key,
  language   text not null check (language in ('en', 'pt', 'es', 'de', 'fr', 'it')),
  currency   text not null check (currency ~ '^[A-Z]{3}$'),
  updated_at timestamptz not null default now()
);
