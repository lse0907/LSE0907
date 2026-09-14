import { readFileSync } from "node:fs";

function source(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const migration = source("supabase/migrations/20260912193000_customer_order_push_notifications.sql");
const route = source("src/app/api/orders/notifications/route.ts");
const statusRoute = source("src/app/api/orders/status/route.ts");
const stationReadyRoute = source("src/app/api/orders/station-ready/route.ts");
const notificationCard = source("src/app/_components/CustomerOrderNotificationCard.tsx");
const worker = source("public/sw.js");

assert(migration.includes("customer_order_push_subscriptions"), "push subscription table is missing");
assert(migration.includes("enable row level security"), "RLS must be enabled");
assert(migration.includes("revoke all on table public.customer_order_push_subscriptions from public, anon, authenticated"), "customer table must remain server-only");
assert(migration.includes("close_customer_order_push_subscriptions_on_order_end"), "terminal orders must close active subscriptions");
assert(route.includes("timingSafeEqual"), "order access token comparison must be timing-safe");
assert(route.includes("ORDER_NOTIFICATION_CLOSED"), "terminal orders must reject new subscriptions");
assert(route.includes("disable_device"), "device-level notification disable must revoke server subscriptions");
assert(route.includes('.eq("endpoint", subscription.endpoint)'), "notification status must be scoped to the current device");
assert(statusRoute.includes("sendReadyOrderPush"), "ready status must invoke the controlled delivery path");
assert(statusRoute.includes("ready push recovery"), "terminal handoff must retry an unrecorded ready notification before revoking subscriptions");
assert(stationReadyRoute.includes("ITEMS_NOT_COMPLETE"), "station readiness must revalidate menu completion on the server");
assert(stationReadyRoute.includes("PACKING_CHECK_REQUIRED"), "station readiness must revalidate packing checks on the server");
assert(stationReadyRoute.includes("sendReadyOrderPush"), "station readiness must invoke the controlled delivery path");
assert(stationReadyRoute.includes("push: pushResult"), "station readiness must record controlled delivery outcome in the event audit trail");
assert(notificationCard.includes("restoreExistingDeviceNotification"), "a prior device subscription must be reused for the next order");
assert(worker.includes('addEventListener("push"'), "service worker must handle push events");
assert(worker.includes('addEventListener("notificationclick"'), "service worker must route notification clicks");
console.log("Customer order notification checks passed.");
