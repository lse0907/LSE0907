"use client";

import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export type StoreRole = "owner" | "manager" | "staff";

export type ViewerAccess = {
  email: string;
  displayName: string;
  isSharedStoreAccount: boolean;
  canUseCustomer: boolean;
  canUseAdmin: boolean;
  canUseStaff: boolean;
  canUseOps: boolean;
  isOpsMaster: boolean;
  storeRoles: StoreRole[];
};

export const EMPTY_VIEWER_ACCESS: ViewerAccess = {
  email: "",
  displayName: "",
  isSharedStoreAccount: false,
  canUseCustomer: false,
  canUseAdmin: false,
  canUseStaff: false,
  canUseOps: false,
  isOpsMaster: false,
  storeRoles: [],
};

export async function resolveViewerAccess(user: User): Promise<ViewerAccess> {
  const isSharedStoreAccount = user.user_metadata?.is_shared_store_account === true;
  const [memberResult, customerResult] = await Promise.all([
    supabase.from("store_members").select("role").eq("user_id", user.id),
    isSharedStoreAccount
      ? Promise.resolve({ data: null })
      : supabase.from("customer_profiles").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  const storeRoles = Array.from(new Set((memberResult.data || [])
    .map((row) => String(row.role || "").toLowerCase())
    .filter((role): role is StoreRole => role === "owner" || role === "manager" || role === "staff")));
  const canUseOps = String(user.app_metadata?.role || "") === "ops";

  return {
    email: user.email || "",
    displayName: String(user.user_metadata?.display_name || user.user_metadata?.name || "").trim(),
    isSharedStoreAccount,
    canUseCustomer: !isSharedStoreAccount && Boolean(customerResult.data),
    canUseAdmin: storeRoles.includes("owner"),
    canUseStaff: storeRoles.length > 0,
    canUseOps,
    isOpsMaster: canUseOps && String(user.app_metadata?.ops_role || "") === "master",
    storeRoles,
  };
}

export function defaultViewerDestination(access: ViewerAccess) {
  const destinations = [access.canUseCustomer, access.canUseAdmin, access.canUseStaff, access.canUseOps]
    .filter(Boolean).length;
  if (destinations > 1) return "/";
  if (access.canUseOps) return "/ops";
  if (access.canUseAdmin) return "/admin";
  if (access.canUseStaff) return "/staff";
  return "/me";
}
