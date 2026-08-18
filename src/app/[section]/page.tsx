import { notFound, redirect } from "next/navigation";
import { NotImplemented } from "@/components/stub/NotImplemented";
import { FAMILYOS_NAV } from "@/lib/nav";

const STUBS: Set<string> = new Set(
  FAMILYOS_NAV.map((i) => i.id).filter(
    (id) => id !== "calendar" && id !== "settings",
  ),
);

export default async function StubPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (section === "calendar") redirect("/");
  if (!STUBS.has(section)) notFound();
  return <NotImplemented name={section} />;
}
