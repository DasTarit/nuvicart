import "server-only";
import { EmailProviderError, type EmailProvider, type EmailSendResult, type TransactionalEmail } from "./types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

type ResendResponse = { id?: unknown };

export const resendEmailProvider: EmailProvider = {
  async sendTransactionalEmail(email: TransactionalEmail): Promise<EmailSendResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    const fromName = process.env.RESEND_FROM_NAME;
    if (!apiKey || !fromEmail) throw new EmailProviderError("RESEND_NOT_CONFIGURED", "Resend email is not configured.", false, 503);

    let response: Response;
    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, "Idempotency-Key": email.eventId },
        body: JSON.stringify({
          from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new EmailProviderError("RESEND_TIMEOUT", "Resend request timed out.", true);
      }
      throw new EmailProviderError("RESEND_NETWORK_ERROR", "Resend request failed before a response was received.", true);
    }

    if (!response.ok) {
      if (response.status === 409) {
        let conflictCode = "";
        try { const conflict = (await response.clone().json()) as { name?: unknown; error?: { name?: unknown } }; conflictCode = String(conflict.name ?? conflict.error?.name ?? ""); } catch { /* classify conservatively below */ }
        if (conflictCode === "concurrent_idempotent_requests") throw new EmailProviderError("RESEND_IDEMPOTENCY_IN_PROGRESS", "Resend is still processing this idempotent request.", true, response.status);
        throw new EmailProviderError("RESEND_IDEMPOTENCY_CONFLICT", "Resend rejected a conflicting idempotent request.", false, response.status);
      }
      if (response.status >= 500 || response.status === 429) {
        throw new EmailProviderError("RESEND_PROVIDER_TEMPORARY", "Resend temporarily rejected the request.", true, response.status);
      }
      if (response.status === 401 || response.status === 403) {
        throw new EmailProviderError("RESEND_AUTHENTICATION", "Resend authentication failed.", false, response.status);
      }
      throw new EmailProviderError("RESEND_PROVIDER_4XX", "Resend rejected the email request.", false, response.status);
    }

    let body: ResendResponse;
    try {
      body = (await response.json()) as ResendResponse;
    } catch {
      throw new EmailProviderError("RESEND_MALFORMED_RESPONSE", "Resend returned a malformed response.", true, response.status);
    }
    if (typeof body.id !== "string" || body.id.length === 0) {
      throw new EmailProviderError("RESEND_MALFORMED_RESPONSE", "Resend response did not contain a message id.", true, response.status);
    }
    return { provider: "resend", providerMessageId: body.id };
  },
};
