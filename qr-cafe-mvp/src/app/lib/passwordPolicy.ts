export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_SPECIAL_CHARACTERS = "!@#$%^&*()_+-=[]{};':\"|<>?,./`~";

export const PASSWORD_POLICY_MESSAGE =
  "비밀번호는 10자 이상이며 영문 소문자, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다. 영문 대문자는 선택 사항입니다.";

export function getPasswordPolicyError(password: string): string | null {
  if (Array.from(password).length < PASSWORD_MIN_LENGTH) {
    return PASSWORD_POLICY_MESSAGE;
  }

  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `비밀번호는 UTF-8 기준 ${PASSWORD_MAX_BYTES}바이트를 넘을 수 없습니다.`;
  }

  const hasLowercase = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecialCharacter = Array.from(password).some((character) =>
    PASSWORD_SPECIAL_CHARACTERS.includes(character),
  );

  if (!hasLowercase || !hasDigit || !hasSpecialCharacter) {
    return PASSWORD_POLICY_MESSAGE;
  }

  return null;
}

export function formatPasswordAuthError(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;

  const authError = error as { code?: unknown; message?: unknown; name?: unknown };
  const code = typeof authError.code === "string" ? authError.code : "";
  const message = typeof authError.message === "string" ? authError.message : "";
  const name = typeof authError.name === "string" ? authError.name : "";

  if (
    code === "weak_password" ||
    name === "WeakPasswordError" ||
    /weak password|password should|password must/i.test(message)
  ) {
    return PASSWORD_POLICY_MESSAGE;
  }

  return message || fallback;
}
