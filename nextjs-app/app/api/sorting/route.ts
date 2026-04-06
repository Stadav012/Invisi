import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batch_id");

    if (!batchId) {
        return NextResponse.json({ error: "batch_id required" }, { status: 400 });
    }

    // Get summary stats
    const { data: summary, error: summaryErr } = await supabase
        .from("sorting_summary")
        .select("*")
        .eq("batch_id", batchId)
        .single();

    // Get recent individual results (last 20)
    const { data: recent, error: recentErr } = await supabase
        .from("sorting_results")
        .select("prediction, label, confidence, inference_ms, sorted_at")
        .eq("batch_id", batchId)
        .order("sorted_at", { ascending: false })
        .limit(20);

    if (summaryErr && summaryErr.code !== "PGRST116") {
        return NextResponse.json({ error: summaryErr.message }, { status: 500 });
    }

    return NextResponse.json({
        summary: summary || {
            total_sorted: 0,
            good_count: 0,
            poor_count: 0,
            good_pct: 0,
            avg_inference_ms: 0,
            last_sorted_at: null,
        },
        recent: recent || [],
    });
}
