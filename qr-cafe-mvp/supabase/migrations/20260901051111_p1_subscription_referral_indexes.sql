begin;

create index if not exists idx_billing_credit_ledger_payment
  on public.billing_credit_ledger(billing_payment_id)
  where billing_payment_id is not null;
create index if not exists idx_billing_credit_ledger_referral
  on public.billing_credit_ledger(referral_id)
  where referral_id is not null;
create index if not exists idx_billing_payment_attempts_referral
  on public.billing_payment_attempts(referral_id)
  where referral_id is not null;
create index if not exists idx_billing_payments_attempt
  on public.billing_payments(payment_attempt_id)
  where payment_attempt_id is not null;
create index if not exists idx_billing_payments_referral
  on public.billing_payments(referral_id)
  where referral_id is not null;
create index if not exists idx_billing_referrals_discount_attempt
  on public.billing_referrals(discount_attempt_id)
  where discount_attempt_id is not null;
create index if not exists idx_billing_referrals_code
  on public.billing_referrals(referral_code_id);

commit;
