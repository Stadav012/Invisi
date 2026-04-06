import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const supabase = await createClient();

    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batch_id");
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    if (!batchId) {
        return NextResponse.json({ error: "batch_id is required" }, { status: 400 });
    }

    // Fetch total count for pagination
    const { count } = await supabase
        .from("sensor_readings")
        .select("*", { count: "exact", head: true })
        .eq("batch_id", batchId);

    const { data, error } = await supabase
        .from("sensor_readings")
        .select("*")
        .eq("batch_id", batchId)
        .order("recorded_at", { ascending: false })
        .range(offset, offset + limit - 1);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data, total: count ?? 0 });
}
