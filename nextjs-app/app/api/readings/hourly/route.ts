import { supabase } from "@/lib/supabase/client";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batch_id");
    const hours = parseInt(searchParams.get("hours") || "48", 10);

    if (!batchId) {
        return NextResponse.json({ error: "batch_id is required" }, { status: 400 });
    }

    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from("sensor_readings_hourly")
        .select("*")
        .eq("batch_id", batchId)
        .gte("hour", since)
        .order("hour", { ascending: true });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}
