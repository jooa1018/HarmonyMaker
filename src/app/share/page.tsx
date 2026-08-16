import { Suspense } from "react";
import { SharedPracticeClient } from "./SharedPracticeClient";

export default function SharePage() {
  return <main><Suspense fallback={<p className="status">공유 연습 악보를 여는 중…</p>}><SharedPracticeClient /></Suspense></main>;
}
