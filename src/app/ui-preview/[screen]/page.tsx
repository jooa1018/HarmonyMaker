import { notFound } from "next/navigation";
import { DesignPreview, type PreviewScreen } from "../../_ui/DesignPreview";
const names = ["13-audio", "G-audio-making", "H-audio-done", "01-start", "02-parts", "03-lead", "04-fix", "05-unsupported", "06-making", "07-result", "08-partial", "09-share", "10-library", "11-guide", "12-shared", "A-reading", "B-dragover", "C-unreadable", "D-share-before", "E-library-empty", "F-minibar", "desktop-result"];
export const metadata = { title: "화면 미리보기 · HarmonyMaker", robots: { index: false, follow: false } };
export function generateStaticParams() { return names.map(screen => ({ screen })); }
export default async function PreviewPage({ params }: { params: Promise<{ screen: string }> }) {
  const { screen } = await params;
  if (!names.includes(screen)) notFound();
  return <DesignPreview initialScreen={screen as PreviewScreen} />;
}
