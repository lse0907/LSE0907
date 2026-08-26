import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const policy = read("src/app/lib/passwordPolicy.ts");
const ownerSignup = read("src/app/signup-owner/page.tsx");
const customerSignup = read("src/app/signup-customer/page.tsx");
const accountApi = read("src/app/api/admin/members/accounts/route.ts");
const membersPage = read("src/app/admin/members/page.tsx");

assert(policy.includes("PASSWORD_MIN_LENGTH = 10"), "비밀번호 최소 길이는 10자여야 합니다.");
assert(policy.includes("PASSWORD_MAX_BYTES = 72"), "비밀번호 최대 길이는 UTF-8 72바이트여야 합니다.");
assert(policy.includes("/[a-z]/.test(password)"), "영문 소문자 포함 여부를 검사해야 합니다.");
assert(policy.includes("/[0-9]/.test(password)"), "숫자 포함 여부를 검사해야 합니다.");
assert(
  policy.includes("PASSWORD_SPECIAL_CHARACTERS.includes(character)"),
  "지원 특수문자 포함 여부를 검사해야 합니다.",
);
assert(
  policy.includes("=[]{};'\\\\:\\\"|<>?,./`~"),
  "Supabase가 지원하는 특수문자 집합을 빠짐없이 사용해야 합니다.",
);
assert(!policy.includes("/[A-Z]/.test(password)"), "영문 대문자는 필수 조건이면 안 됩니다.");
assert(
  policy.includes("new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES"),
  "UTF-8 바이트 상한을 검사해야 합니다.",
);

for (const [name, source] of [
  ["점주 회원가입", ownerSignup],
  ["고객 회원가입", customerSignup],
  ["공용 계정 API", accountApi],
  ["공용 계정 화면", membersPage],
]) {
  assert(source.includes("getPasswordPolicyError"), `${name}에 공통 비밀번호 검증을 적용해야 합니다.`);
  assert(!source.includes("password.length < 8"), `${name}에 기존 8자 기준이 남아 있으면 안 됩니다.`);
}

for (const [name, source] of [
  ["점주 회원가입", ownerSignup],
  ["고객 회원가입", customerSignup],
  ["공용 계정 API", accountApi],
]) {
  assert(source.includes("formatPasswordAuthError"), `${name}의 Auth 오류를 정책 문구로 변환해야 합니다.`);
}

assert(
  ownerSignup.includes("PASSWORD_POLICY_MESSAGE") &&
    customerSignup.includes("PASSWORD_POLICY_MESSAGE") &&
    membersPage.includes("PASSWORD_POLICY_MESSAGE"),
  "모든 비밀번호 생성 화면에 동일한 정책 문구를 표시해야 합니다.",
);

console.log("P0 비밀번호 정책 정적 검증 통과");
