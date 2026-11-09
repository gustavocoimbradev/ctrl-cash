-- How an expense category counts for financial health, in words: healthy, necessary, comfort, luxury, unhealthy or unknown.
-- Chosen by the person (built-in categories carry a default in the app); only expense categories have one.
alter table categories add column tone text
  check (tone is null or (tone in ('healthy', 'necessary', 'comfort', 'luxury', 'unhealthy', 'unknown') and kind = 'expense'));
