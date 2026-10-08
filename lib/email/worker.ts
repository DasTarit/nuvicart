import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailProvider } from "./provider";
import { renderEmailTemplate } from "./templates";
import { EmailProviderError } from "./types";

type NotificationRow = {
  id: string;
  event_key: string;
  event_type: string;
  recipient_email: string;
  payload: unknown;
  delivery_status: string;
  attempt_count: number;
};

type Claim = { status: "claimed" | "sent" | "failed" | "deferred" | "in_progress"; processing_token?: string; event?: NotificationRow };

export async function processNotificationEvent(eventId: string) {
  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin.rpc("claim_notification_delivery", { p_event_id: eventId });
  if (claimError) throw claimError;
  const claim = claimed as Claim;
  if (claim.status !== "claimed" || !claim.processing_token || !claim.event) return claim.status;

  const event = claim.event;
  try {
    const template = renderEmailTemplate(event.event_type, event.payload);
    const result = await getEmailProvider().sendTransactionalEmail({
      eventId: event.event_key,
      to: event.recipient_email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
    const { error } = await admin.rpc("complete_notification_delivery", {
      p_event_id: event.id,
      p_processing_token: claim.processing_token,
      p_provider: result.provider,
      p_provider_message_id: result.providerMessageId,
    });
    if (error) throw error;
    return "sent";
  } catch (error) {
    const normalized = error instanceof EmailProviderError
      ? error
      : new EmailProviderError("NOTIFICATION_TEMPLATE_ERROR", "Notification payload could not be rendered.", false);
    const { error: failError } = await admin.rpc("fail_notification_delivery", {
      p_event_id: event.id,
      p_processing_token: claim.processing_token,
      p_provider: normalized.code.startsWith("RESEND_") ? "resend" : null,
      p_failure_kind: normalized.retryable ? "retryable" : "permanent",
      p_failure_code: normalized.code,
      p_failure_reason: normalized.message,
    });
    if (failError) throw failError;
    return normalized.retryable ? "retryable" : "failed";
  }
}

export async function processPendingNotifications(limit = 10) {
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notification_events")
    .select("id")
    .in("delivery_status", ["pending", "processing"])
    .order("created_at", { ascending: true })
    .limit(boundedLimit);
  if (error) throw error;
  const results = [];
  for (const row of data ?? []) results.push({ id: String(row.id), result: await processNotificationEvent(String(row.id)) });
  return results;
}
