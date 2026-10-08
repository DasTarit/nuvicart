import type { EmailProvider, EmailSendResult, TransactionalEmail } from "./types";

/** Development-only provider. It deliberately never performs network I/O. */
export const developmentEmailProvider: EmailProvider = {
  async sendTransactionalEmail(_email: TransactionalEmail): Promise<EmailSendResult> {
    return { provider: "development", providerMessageId: null };
  },
};
