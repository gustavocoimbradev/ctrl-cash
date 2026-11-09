-- What a connected assistant may do: read only (the default), or also add transactions. Chosen by the person on the consent
-- page and changeable at any time in Account settings.
alter table assistant_connections add column can_write boolean not null default false;
