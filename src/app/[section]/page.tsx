import { notFound, redirect } from "next/navigation";
import { NotImplemented } from "@/shared/NotImplemented";
import { FAMILYOS_NAV } from "@/shared/nav";

const STUBS: Set<string> = new Set(
  FAMILYOS_NAV.map((i) => i.id).filter(
    (id) => id !== "calendar" && id !== "settings" && id !== "lists",
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
