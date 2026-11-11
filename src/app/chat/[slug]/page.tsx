import { notFound } from "next/navigation";
import { getAgencyBySlug } from "@/lib/engine";
import { ChatWidget } from "@/components/ChatWidget";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agency = await getAgencyBySlug(slug);
  if (!agency) notFound();
  return <ChatWidget slug={agency.slug} agencyName={agency.name} assistant={agency.assistantName} />;
}
