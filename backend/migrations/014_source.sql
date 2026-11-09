-- Who made a record: 'claude' when an assistant created it through MCP (the app shows a small mark); absent when the person did.
alter table transactions add column source text check (source is null or source = 'claude');
alter table cards add column source text check (source is null or source = 'claude');
alter table categories add column source text check (source is null or source = 'claude');
alter table payments add column source text check (source is null or source = 'claude');
