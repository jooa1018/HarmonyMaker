import type { Metadata } from "next";
import Link from "next/link";
import { ImportReviewClient } from "./ImportReviewClient";
import styles from "./import.module.css";

export const metadata: Metadata = {
  title: "MusicXML 가져오기 · HarmonyMaker",
  description: "MusicXML/MXL 안전 가져오기와 Quick Review",
};

export default function ImportPage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <Link href="/" className={styles.backLink}>← S/A/T 데모</Link>
        <p className="eyebrow">STEP 3 · SOURCE FIRST</p>
        <h1>MusicXML 가져오기</h1>
        <p>악보를 안전하게 읽고, 멜로디·코드·구간·가수 음역·권리를 직접 확인합니다.</p>
      </header>
      <ImportReviewClient />
    </main>
  );
}
