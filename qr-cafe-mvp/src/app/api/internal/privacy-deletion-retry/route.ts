import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../_lib/storeAuth";

type ClaimedJob = {
  job_id: string;
  subject_user_id: string;
  job_type: "assess_retention" | "delete_auth_user";
};

function authorized(req: NextRequest) {
  const expected = String(process.env.PRIVACY_DELETION_RETRY_SECRET || "").trim();
  const received = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isMissingAuthUser(error: { status?: number; code?: string } | null) {
  return error?.status === 404 || error?.code === "user_not_found";
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, message: "허용되지 않은 요청입니다." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const claimed = await admin.rpc("claim_due_privacy_deletion_jobs", { p_limit: 10 });
  if (claimed.error) {
    return NextResponse.json({ ok: false, message: "탈퇴 처리 대기열을 불러오지 못했습니다." }, { status: 500 });
  }

  let completed = 0;
  let deferred = 0;
  let failed = 0;

  for (const raw of claimed.data || []) {
    const job = raw as ClaimedJob;
    let userId = String(job.subject_user_id || "");

    if (job.job_type === "assess_retention") {
      const prepared = await admin.rpc("prepare_account_privacy_deletion", { p_job_id: job.job_id });
      if (prepared.error) {
        await admin.rpc("fail_account_privacy_deletion", {
          p_job_id: job.job_id,
          p_failure_code: "PREPARE_FAILED",
          p_failure_detail: prepared.error.message,
        });
        failed += 1;
        continue;
      }
      const result = prepared.data as { ready?: boolean; subject_user_id?: string } | null;
      if (!result?.ready) {
        deferred += 1;
        continue;
      }
      userId = String(result.subject_user_id || userId);
    }

    if (!userId) {
      await admin.rpc("fail_account_privacy_deletion", {
        p_job_id: job.job_id,
        p_failure_code: "USER_ID_MISSING",
        p_failure_detail: "Auth 삭제 대상 식별자가 없습니다.",
      });
      failed += 1;
      continue;
    }

    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error && !isMissingAuthUser(deleted.error)) {
      await admin.rpc("fail_account_privacy_deletion", {
        p_job_id: job.job_id,
        p_failure_code: "AUTH_DELETE_FAILED",
        p_failure_detail: deleted.error.message,
      });
      failed += 1;
      continue;
    }

    const finalized = await admin.rpc("finalize_account_privacy_deletion", { p_job_id: job.job_id });
    if (finalized.error) {
      await admin.rpc("fail_account_privacy_deletion", {
        p_job_id: job.job_id,
        p_failure_code: "FINALIZE_FAILED",
        p_failure_detail: finalized.error.message,
      });
      failed += 1;
      continue;
    }
    completed += 1;
  }

  const purged = await admin.rpc("purge_expired_privacy_retention", { p_limit: 20 });
  if (purged.error) {
    return NextResponse.json({
      ok: false,
      message: "보존기간 만료 자료를 파기하지 못했습니다.",
      claimed: (claimed.data || []).length,
      completed,
      deferred,
      failed,
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    claimed: (claimed.data || []).length,
    completed,
    deferred,
    failed,
    retentionPurge: purged.data,
  });
}
