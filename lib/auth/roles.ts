import type { AppRole } from "@/types/auth";
import { createClient } from "@/lib/supabase/server";

export async function getCurrentRole(): Promise<AppRole | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("role").eq("user_id", user.id).single();
  return (data?.role as AppRole | undefined) ?? null;
}

export async function requireRole(allowed: AppRole[]) {
  const role = await getCurrentRole();
  if (!role || !allowed.includes(role)) throw new Error("Forbidden");
  return role;
}
