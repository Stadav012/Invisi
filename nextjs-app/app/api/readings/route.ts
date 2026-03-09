import { supabase } from "@/lib/supabase/client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batch_id");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    if (!batchId) {
        return NextResponse.json({ error: "batch_id is required" }, { status: 400 });
    }

    const { data, error } = await supabase
        .from("sensor_readings")
        .select("*")
        .eq("batch_id", batchId)
        .order("recorded_at", { ascending: false })
        .limit(limit);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}
