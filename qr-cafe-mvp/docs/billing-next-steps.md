# Billing Next Steps (합의안)

## 핵심 정책
- 과금 구조: 기본 월구독 + 선결제 기능(addon) 별도 과금.
- 결제 주기: 1개월 / 3개월 / 6개월 / 12개월 옵션.
- 기간 누적: 만료 전 선결제 시 남은 기간에 누적(rollover).
- 권한: 결제/구독 설정 및 결제 실행은 owner 전용.
- 미결제 정책: 만료 즉시 기능 제한 + 매장 리스트에 남은 기간 노출.

## 데이터 모델(요약)
- `store_billing`
  - `base_plan_status`
  - `paid_until`
  - `current_plan_months`
- `store_addons`
  - `prepay_addon_status`
- `billing_payments`
  - 결제 이력(플랜 개월 수, 결제금액, 결제시각, 누적 전/후 만료일)

## 서버 처리 규칙
- 결제 반영 함수에서 다음 규칙을 사용:
  - `anchor = max(now(), paid_until)`
  - `new_paid_until = anchor + plan_months`
- 결제 성공 시:
  - 기본 결제 포함이면 `store_billing.base_plan_status = active`
  - addon 결제 포함이면 `store_addons.prepay_addon_status = active`
  - `billing_payments` 이력 1건 기록

## 적용 순서
1. `docs/sql/supabase-billing-setup.sql`를 Supabase SQL Editor에서 실행.
2. owner 계정으로 샘플 결제 적용 함수(`apply_store_billing_payment`)를 테스트.
3. UI에서 남은 기간/만료 상태를 읽어 노출.
4. owner 전용 결제 페이지(1/3/6/12개월 선택) 연결.
