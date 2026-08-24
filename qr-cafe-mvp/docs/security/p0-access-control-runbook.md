# P0 접근통제 적용·검증 Runbook

대상 마이그레이션: `supabase/migrations/20260823145351_p0_access_control.sql`

이 문서는 로컬 구현 검토용입니다. 별도 승인 전에는 운영 Supabase에 적용하지 않습니다.

## 적용 전 조건

1. GitHub `main`, Vercel Production, Supabase 스키마의 기준 커밋을 다시 기록한다.
2. 운영 DB 백업 또는 PITR 사용 가능 여부를 확인한다.
3. 고객 주문 조회 API와 `done`·`status` 화면 변경을 먼저 배포한다.
4. 새 코드에서 주문 접근 토큰이 URL에 포함되지 않는지 확인한다.
5. 테스트 매장에서 후불 주문 1건과 선결제 주문 1건을 준비한다.

## 적용 순서

1. 코드 변경을 Preview 환경에 배포한다.
2. Preview에서 고객 주문 조회·상태 갱신·취소와 직원 주문 목록을 확인한다.
3. 코드 배포 승인을 별도로 받는다.
4. Production 코드를 먼저 배포한다.
5. DB 마이그레이션 적용 승인을 별도로 받는다.
6. 마이그레이션을 적용하고 아래 검증을 즉시 수행한다.

DB를 먼저 잠그면 기존 Production 고객 화면의 직접 조회가 실패하므로 순서를 바꾸지 않는다.

## DB 검증

다음 조회는 정책·권한 메타데이터만 확인하며 주문 데이터는 출력하지 않는다.

```sql
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('orders', 'order_items', 'order_item_options', 'menu_categories')
order by tablename, policyname;
```

기대 결과:

- `public_select_*`, `public_insert_*`, `member_update_orders_status` 정책이 없다.
- 주문 3개 테이블에는 `authenticated` 대상 매장 구성원·OPS 조회 정책만 있다.
- `menu_categories`에는 활성 공개 조회와 대표자·OPS 관리 정책만 있다.

```sql
select c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('orders', 'order_items', 'order_item_options', 'menu_categories')
order by c.relname;
```

기대 결과: 네 테이블 모두 `relrowsecurity = true`.

```sql
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in (
    'apply_loyalty_on_paid_order',
    'finalize_order_rewards',
    'rollback_order_rewards',
    'apply_store_billing_payment'
  )
order by routine_name, grantee;
```

기대 결과: 네 고위험 함수에 `PUBLIC`, `anon`, `authenticated` 실행권이 없다.

## 기능·보안 검증

- 비로그인 브라우저에서 메뉴의 활성 카테고리는 보인다.
- 비활성 카테고리는 비로그인 사용자에게 보이지 않는다.
- 비로그인 사용자는 카테고리를 등록·수정·삭제할 수 없다.
- 대표자는 자기 매장의 활성·비활성 카테고리를 조회하고 관리할 수 있다.
- 직원·타 매장 대표자는 대상 매장의 카테고리를 수정할 수 없다.
- 비로그인 사용자의 주문 테이블 직접 `SELECT`·`INSERT`가 거부된다.
- 고객의 올바른 주문 ID·매장 ID·접근 토큰 조합은 주문 조회 API에서 성공한다.
- 잘못된 토큰 또는 타 매장 조합은 동일한 `404 ORDER_NOT_FOUND` 응답을 받는다.
- 고객 응답에 `access_token`, `payment_key`, `toss_order_id`, `customer_user_id`, `loyalty_snapshot`이 없다.
- 매장 구성원은 자기 매장 주문만 조회할 수 있고 다른 매장 주문은 0건이다.
- 직원 화면의 주문·품목·옵션 조회와 상태 변경 API가 정상 동작한다.
- 고객 취소 API는 올바른 토큰의 `new` 주문만 허용한다.
- 브라우저 주소·이동 링크에 `accessToken` 쿼리 문자열이 남지 않는다.

## 중단·복구 기준

- 마이그레이션은 하나의 트랜잭션이므로 적용 중 SQL 오류가 발생하면 전체가 롤백되어야 한다.
- DB 적용 전 코드 문제가 발견되면 코드 배포만 이전 버전으로 되돌리고 DB는 적용하지 않는다.
- DB 적용 후에는 공개 주문 정책을 복원하는 방식으로 롤백하지 않는다. 그 정책은 주문 토큰과 결제 식별자 노출을 다시 허용하기 때문이다.
- DB 적용 후 장애가 발생하면 접근통제를 유지한 채 서버 API·정상 매장 정책을 보정하는 후속 마이그레이션을 적용한다.
- 서비스 중단이 불가피하면 v5 정책의 장애 게이트에 따라 신규 주문 접수를 먼저 중지하고 데이터 정합성을 확인한다.

## 승인 경계

- 로컬 코드 작성·검증
- GitHub 푸시·PR
- Vercel Preview 배포
- Vercel Production 배포
- Supabase 마이그레이션 적용

각 항목은 서로 다른 단계이며, 다음 단계로 넘어가기 전에 별도 승인을 받는다.
