import { requireAdminUser } from "@/lib/admin-auth";
import ShotList from "./shot-list-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Photo shot list | Primark Safety Passport" };
export default async function ShotListPage() {
  await requireAdminUser('/shot-list');
  return <ShotList/>;
}
