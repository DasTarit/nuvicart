export type TransactionalEmail = {
  eventId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type EmailSendResult = {
  provider: string;
  providerMessageId: string | null;
};

export class EmailProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(code: string, message: string, retryable: boolean, status?: number) {
    super(message);
    this.name = "EmailProviderError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export interface EmailProvider {
  sendTransactionalEmail(email: TransactionalEmail): Promise<EmailSendResult>;
}
