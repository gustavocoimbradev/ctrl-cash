-- Finding people: everybody can be found by name or code in the new-chat list, unless they turn it off (then only an exact code,
-- or a person they already talk to or share with, finds them).
alter table profiles add column discoverable boolean not null default true;
