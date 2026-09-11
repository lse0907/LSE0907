begin;

-- AI-3 keeps a durable, per-store record of deterministic daily/weekly/monthly
-- briefings. Browser clients never access these rows directly; server routes
-- recheck the store role before reading or creating a snapshot.

alter table public.ai_analysis_runs
  drop constraint if exists ai_analysis_runs_analysis_type_check,
  add constraint ai_analysis_runs_analysis_type_check
    check (analysis_type in (
      'daily_brief','weekly_brief','monthly_brief','manual_refresh',
      'early_observation','full_analysis'
    ));

alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_feature_check,
  add constraint ai_usage_events_feature_check
    check (feature in (
      'daily_brief','weekly_brief','monthly_brief','manual_refresh',
      'early_observation','full_analysis','evaluation'
    ));

alter table public.ai_briefs
  add column if not exists brief_period text not null default 'daily',
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists headline text,
  add column if not exists summary text,
  add column if not exists source_order_count integer,
  add column if not exists source_sales_won numeric(14,2),
  add column if not exists schema_version text not null default 'ai-brief-v1';

update public.ai_briefs
set
  period_start = coalesce(period_start, generated_at::date),
  period_end = coalesce(period_end, generated_at::date),
  headline = coalesce(nullif(headline, ''), 'AI 브리핑'),
  summary = coalesce(summary, ''),
  source_order_count = coalesce(source_order_count, 0),
  source_sales_won = coalesce(source_sales_won, 0)
where period_start is null
   or period_end is null
   or headline is null
   or summary is null
   or source_order_count is null
   or source_sales_won is null;

alter table public.ai_briefs
  alter column period_start set not null,
  alter column period_end set not null,
  alter column headline set not null,
  alter column summary set not null,
  alter column source_order_count set not null,
  alter column source_sales_won set not null,
  add constraint ai_briefs_period_check check (brief_period in ('daily','weekly','monthly')),
  add constraint ai_briefs_period_range_check check (period_start <= period_end),
  add constraint ai_briefs_headline_length_check check (char_length(headline) between 1 and 200),
  add constraint ai_briefs_summary_length_check check (char_length(summary) <= 1000),
  add constraint ai_briefs_source_order_count_check check (source_order_count >= 0),
  add constraint ai_briefs_source_sales_won_check check (source_sales_won >= 0);

create unique index if not exists uq_ai_briefs_store_period_start
  on public.ai_briefs(store_id, brief_period, period_start);
create index if not exists idx_ai_briefs_store_period_generated
  on public.ai_briefs(store_id, brief_period, generated_at desc);

comment on column public.ai_briefs.facts is
  'Facts are aggregate, store-scoped statements only. Do not store customer, payment, prompt, or hidden-reasoning data.';
comment on column public.ai_briefs.hypotheses is
  'Clearly labeled possibilities, never conclusions; each item must be supported by the stored aggregate source period.';
comment on column public.ai_briefs.recommendation is
  'Read-only recommendation data. A separate approval record is mandatory before a consequential action.';
comment on column public.ai_briefs.brief_period is
  'The stored cadence: daily, weekly, or monthly. One immutable snapshot per store and period start.';

commit;
