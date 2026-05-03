"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function getBaseUrl(): string {
    const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (configuredUrl) {
        return configuredUrl.replace(/\/+$/, "");
    }

    if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}`;
    }

    return "http://localhost:3000";
}

export async function login(formData: FormData) {
    const supabase = await createClient();

    const { error } = await supabase.auth.signInWithPassword({
        email: formData.get("email") as string,
        password: formData.get("password") as string,
    });

    if (error) {
        redirect("/login?error=" + encodeURIComponent(error.message));
    }

    revalidatePath("/", "layout");
    redirect("/");
}

export async function signup(formData: FormData) {
    const supabase = await createClient();

    const fullName = formData.get("full_name") as string;

    const { error } = await supabase.auth.signUp({
        email: formData.get("email") as string,
        password: formData.get("password") as string,
        options: {
            emailRedirectTo: `${getBaseUrl()}/auth/confirm`,
            data: {
                full_name: fullName,
            },
        },
    });

    if (error) {
        redirect("/login?error=" + encodeURIComponent(error.message));
    }

    redirect("/login?message=Check your email to confirm your account");
}
