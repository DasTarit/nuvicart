import { createClient } from "@/lib/supabase/server";

export async function recordAdminAudit(action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}, operationKey?: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_admin_audit", {
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_metadata: metadata,
    p_operation_key: operationKey ?? null,
  });
  if (error) throw error;
}
