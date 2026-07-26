-- =========================================================
-- 특정 사용자 한 명만 OPS MASTER로 지정
-- 1) 아래 CHANGE_ME 이메일을 현재 마스터 계정 이메일로 교체
-- 2) 파일 전체 실행
-- 3) 실행 후 해당 계정 로그아웃 → 재로그인
-- =========================================================
do $$
declare
  v_email text := 'CHANGE_ME@example.com';
  v_user_id uuid;
  v_count integer;
begin
  if v_email='CHANGE_ME@example.com' then raise exception '먼저 v_email을 실제 마스터 계정 이메일로 변경하세요.'; end if;
  select count(*) into v_count from auth.users where lower(email)=lower(trim(v_email));
  if v_count=0 then raise exception '해당 이메일 사용자를 찾지 못했습니다: %',v_email; end if;
  if v_count<>1 then raise exception '동일 이메일 사용자가 1명이 아닙니다: %',v_email; end if;
  select id into v_user_id from auth.users where lower(email)=lower(trim(v_email)) limit 1;
  update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)
    || jsonb_build_object('role','ops','ops_role','master') where id=v_user_id;
  raise notice 'OPS MASTER 지정 완료: email=%, user_id=%',v_email,v_user_id;
end $$;

-- 결과 확인: CHANGE_ME를 같은 이메일로 바꿔 실행하세요.
-- select id,email,created_at,raw_app_meta_data from auth.users where lower(email)=lower('CHANGE_ME@example.com');
-- select sm.store_id,sm.role from public.store_members sm where sm.user_id=(select id from auth.users where lower(email)=lower('CHANGE_ME@example.com'));

-- 권한 해제는 아래 주석을 풀고 이메일을 바꾼 뒤 실행합니다.
-- update auth.users set raw_app_meta_data=(coalesce(raw_app_meta_data,'{}'::jsonb)-'role'-'ops_role')
-- where lower(email)=lower('CHANGE_ME@example.com');
