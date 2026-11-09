-- What a share shows: 'percent' (percentages and the score, the default) or 'amounts' (the real values too). The amounts are
-- published apart from the summary and only returned to people whose share is in amounts mode.
alter table summary_shares add column mode text not null default 'percent' check (mode in ('percent', 'amounts'));
alter table profile_summaries add column amounts jsonb check (amounts is null or jsonb_typeof(amounts) = 'object');
