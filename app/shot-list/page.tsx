import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { learnerForSession } from "@/lib/server";
import ShotList from "./shot-list-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Photo shot list | Primark Safety Passport" };
export default async function ShotListPage() {
  const cookieStore = await cookies();
  let learner;
  try { learner = await learnerForSession(cookieStore.get("primark_session")?.value); }
  catch { return <main className="main"><h1>Shot list unavailable</h1><p>Please try again in a moment.</p><a href="/shot-list/">Try again</a></main>; }
  if (!learner) redirect("/?returnTo=shot-list");
  return <ShotList name={learner.name}/>;
}
