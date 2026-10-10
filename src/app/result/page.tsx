import { Suspense } from "react";
import { ResultClient, ResultLoading } from "../_result/ResultClient";
export default function ResultPage() { return <Suspense fallback={<ResultLoading />}><ResultClient /></Suspense>; }
