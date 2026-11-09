-- A third permission for a connected assistant: emailing reports to the person themselves. The address is the one on the person's
-- own verified account, captured when they approve the connection; the assistant never chooses a recipient.
alter table assistant_connections add column can_email boolean not null default false;
alter table assistant_connections add column email text check (email is null or (char_length(email) <= 254 and email like '%@%'));
