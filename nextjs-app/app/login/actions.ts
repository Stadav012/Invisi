"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
