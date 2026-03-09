import { supabase } from "@/lib/supabase/client";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
    const { data, error } = await supabase
        .from("batches")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
    const body = await request.json();

    // Determine next batch number
    const { count } = await supabase
        .from("batches")
        .select("*", { count: "exact", head: true });

    const batchNumber = `Batch #${(count ?? 0) + 1}`;

    const { data, error } = await supabase
        .from("batches")
        .insert({
            batch_number: batchNumber,
            weight_kg: body.weight ? parseFloat(body.weight) : null,
            variety: body.variety || "Amelonado",
            notes: body.notes || null,
            fermentation_start_date: body.date || new Date().toISOString().split("T")[0],
            recording_interval_mins: body.recording_interval_mins ? parseInt(body.recording_interval_mins) : 5,
            status: "fermenting",
        })
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
}
