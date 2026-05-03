import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const email = searchParams.get("email");
    const token = searchParams.get("token");
    const token_hash = searchParams.get("token_hash");
    const type = searchParams.get("type") as EmailOtpType | null;

    const redirectTo = request.nextUrl.clone();
    redirectTo.pathname = "/";
    redirectTo.searchParams.delete("code");
    redirectTo.searchParams.delete("email");
    redirectTo.searchParams.delete("token");
    redirectTo.searchParams.delete("token_hash");
    redirectTo.searchParams.delete("type");

    const supabase = await createClient();

    if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
            return NextResponse.redirect(redirectTo);
        }
    }

    if (token && type) {
        if (email) {
            const { error } = await supabase.auth.verifyOtp({ type, token, email });
            if (!error) {
                return NextResponse.redirect(redirectTo);
            }
        } else {
            const { error } = await supabase.auth.verifyOtp({ type, token_hash: token });
            if (!error) {
                return NextResponse.redirect(redirectTo);
            }
        }
    }

    if (token_hash && type) {
        const { error } = await supabase.auth.verifyOtp({ type, token_hash });

        if (!error) {
            return NextResponse.redirect(redirectTo);
        }
    }

    redirectTo.pathname = "/login";
    redirectTo.searchParams.set("error", "Invalid or expired confirmation link");
    return NextResponse.redirect(redirectTo);
}
