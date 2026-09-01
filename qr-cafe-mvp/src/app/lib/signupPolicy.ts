export const SIGNUP_POLICY_VERSION = "policy-v5-2026-08-23";

export type SignupAudience = "customer" | "owner";

export type SignupPolicyInput = {
  audience: SignupAudience;
  minimumAgeConfirmed: boolean;
  businessAuthorityConfirmed: boolean;
  termsAccepted: boolean;
  privacyNoticeAcknowledged: boolean;
  marketingConsent: boolean;
};
