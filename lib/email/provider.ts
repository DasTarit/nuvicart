import "server-only";
import { developmentEmailProvider } from "./development";
import { resendEmailProvider } from "./resend";
import type { EmailProvider } from "./types";

export function getEmailProvider(): EmailProvider {
  return process.env.NODE_ENV === "production" ? resendEmailProvider : developmentEmailProvider;
}

export function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}
