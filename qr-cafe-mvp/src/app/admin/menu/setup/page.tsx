import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextRequest } from "next/server";
import AdminPageHeader from "@/app/admin/_components/AdminPageHeader";
import { createSupabaseAdminClient, requireStoreRole } from "@/app/api/_lib/storeAuth";
import MenuSetupPreview from "@/app/preview/menu-setup/MenuSetupPreview";
import { menuSetupRouteEnabled, menuSetupStoreAllowed } from "@/app/api/_lib/menuSetupAccess";

export const dynamic = "force-dynamic";

// Production is closed unless both rollout flags and a trusted origin are configured.
export default async function MenuSetupPage({ searchParams }: { searchParams: Promise<{ store?: string | string[] }> }) {
  if (!menuSetupRouteEnabled("admin")) notFound();
  const query = await searchParams;
  const storeId = typeof query.store === "string" ? query.store.trim() : "";
  if (!storeId || storeId.length > 200) notFound();
  if (!menuSetupStoreAllowed(storeId)) notFound();
  const setupHref = `/admin/setup?store=${encodeURIComponent(storeId)}&mode=bulk`;
  let storeName = "";
  let message = "";
  try {
    const admin = createSupabaseAdminClient();
    const request = new NextRequest("http://localhost/admin/menu/setup", { headers: await headers() });
    await requireStoreRole({ req: request, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const store = await admin.from("stores").select("store_name,setup_completed").eq("store_id", storeId).maybeSingle();
    if (store.error || !store.data) throw new Error("store unavailable");
    storeName = store.data.store_name || storeId;
    const counts = await Promise.all([
      "menu_categories", "menu_items", "option_groups", "option_items", "menu_option_prices", "menu_option_item_exclusions",
    ].map(async (table) => {
      const result = await admin.from(table).select("store_id", { head: true, count: "exact" }).eq("store_id", storeId);
      if (result.error || result.count == null) throw new Error("state unavailable");
      return result.count;
    }));
    if (store.data.setup_completed || counts.some((count) => count > 0)) {
      message = "이미 등록된 설정이 있습니다. 기존 내용을 보호하기 위해 메뉴 관리에서 수정해주세요.";
    }
  } catch {
    message = "매장 소유자 권한과 설정 상태를 확인하지 못했습니다. 로그인과 선택한 매장을 확인해주세요.";
  }
  return <>
    <div style={{ maxWidth: 1180, margin: "20px auto", padding: "0 16px" }}>
      <AdminPageHeader title="사진·파일로 한 번에 설정" description="자료를 올리고, 틀린 부분만 고친 뒤 등록하세요." storeId={storeName ? storeId : undefined} storeName={storeName} actions={<a href={setupHref}>초기설정으로</a>} />
      {message && <section role="status" style={{ padding: 20, background: "#fff", borderRadius: 16, marginTop: 16 }}><p>{message}</p><a href={setupHref}>초기설정으로 돌아가기</a>{storeName && <> · <a href={`/admin/menu?store=${encodeURIComponent(storeId)}`}>메뉴 관리</a></>}</section>}
    </div>
    {!message && <MenuSetupPreview key={`admin:${storeId}`} storeId={storeId} integrated registrationEnabled={process.env.MENU_SETUP_REGISTRATION_ENABLED === "true"} />}
  </>;
}
