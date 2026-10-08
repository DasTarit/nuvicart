import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/types/auth";

export async function getAdminContext(): Promise<{ userId: string; role: Extract<AppRole, "admin" | "super_admin"> }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("user_id", user.id).single();
  if (error || !profile || (profile.role !== "admin" && profile.role !== "super_admin")) throw new Error("FORBIDDEN");
  return { userId: user.id, role: profile.role };
}

export async function requireAdmin() {
  return getAdminContext();
}

export async function requireSuperAdmin() {
  const context = await getAdminContext();
  if (context.role !== "super_admin") throw new Error("FORBIDDEN");
  return context;
}

export async function requireAdminPage() {
  try { return await requireAdmin(); }
  catch (error) { redirect(error instanceof Error && error.message === "UNAUTHENTICATED" ? "/login" : "/account/orders"); }
}

export async function requireSuperAdminPage() {
  try { return await requireSuperAdmin(); }
  catch (error) { redirect(error instanceof Error && error.message === "UNAUTHENTICATED" ? "/login" : "/account/orders"); }
}
