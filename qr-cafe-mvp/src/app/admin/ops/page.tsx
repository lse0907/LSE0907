import { redirect } from "next/navigation";

export default async function LegacyAdminOpsPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const { store } = await searchParams;
  const query = store ? `?store=${encodeURIComponent(store)}` : "";
  redirect(`/admin${query}`);
}
