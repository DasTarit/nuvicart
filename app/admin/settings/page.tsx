import { requireSuperAdminPage } from "@/lib/auth/admin";
export default async function AdminSettingsPage() {
  await requireSuperAdminPage();
  return <main className="p-4 sm:p-6 lg:p-8"><h1 className="text-3xl font-semibold">Settings</h1><p className="mt-2 max-w-2xl text-sm text-muted">Privileged settings are intentionally limited in Phase 6. Secrets remain deployment-managed and are never editable from the browser.</p></main>;
}
