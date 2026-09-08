import { notFound } from "next/navigation";
import OpsPrivacyRequests from "@/app/ops/privacy-requests/OpsPrivacyRequests";

export default function OpsPrivacyPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <OpsPrivacyRequests preview />;
}
