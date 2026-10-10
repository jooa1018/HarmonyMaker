import { Suspense } from "react";
import { SharedPracticeClient } from "./SharedPracticeClient";

export default function SharePage() {
  return <Suspense fallback={<div className="hm"><div className="hm-page"><p role="status">공유 연습 악보를 여는 중…</p></div></div>}><SharedPracticeClient /></Suspense>;
}
