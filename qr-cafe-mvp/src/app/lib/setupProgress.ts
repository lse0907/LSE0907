"use client";

import { supabase } from "@/app/lib/supabaseClient";

export type SetupStepKey = "step1" | "step2" | "step3";
export type SetupProgressState = {
  step1: boolean;
  step2: boolean;
  step3: boolean;
};

const emptyState: SetupProgressState = { step1: false, step2: false, step3: false };

function toColumn(step: SetupStepKey) {
  if (step === "step1") return "setup_step1_confirmed";
  if (step === "step2") return "setup_step2_confirmed";
  return "setup_step3_confirmed";
}

export async function getSetupProgress(storeId: string): Promise<SetupProgressState> {
  if (!storeId) return emptyState;
  const { data, error } = await supabase
    .from("stores")
    .select("setup_step1_confirmed,setup_step2_confirmed,setup_step3_confirmed")
    .eq("store_id", storeId)
    .maybeSingle();
  if (error || !data) return emptyState;
  const row = data as Record<string, unknown>;
  return {
    step1: Boolean(row.setup_step1_confirmed),
    step2: Boolean(row.setup_step2_confirmed),
    step3: Boolean(row.setup_step3_confirmed),
  };
}

export async function setSetupStepConfirmed(storeId: string, step: SetupStepKey, value: boolean): Promise<boolean> {
  if (!storeId) return false;
  const col = toColumn(step);
  const { error } = await supabase.from("stores").update({ [col]: value }).eq("store_id", storeId);
  return !error;
}

export async function clearSetupProgress(storeId: string): Promise<boolean> {
  if (!storeId) return false;
  const { error } = await supabase
    .from("stores")
    .update({
      setup_step1_confirmed: false,
      setup_step2_confirmed: false,
      setup_step3_confirmed: false,
    })
    .eq("store_id", storeId);
  return !error;
}
