import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
    const { data } = await supabase.from("batches").select("*").order("created_at", { ascending: false }).limit(2);
    console.log(JSON.stringify(data, null, 2));
}
check();
