import { notFound } from "next/navigation";
import MenuSetupPreview from "./MenuSetupPreview";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string | string[] }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const query = await searchParams;
  const storeId = typeof query.store === "string" && query.store.trim().length <= 200 ? query.store.trim() : "";
  return <MenuSetupPreview key={storeId || "unscoped"} storeId={storeId} registrationEnabled={process.env.MENU_SETUP_REGISTRATION_ENABLED === "true"} />;
}
