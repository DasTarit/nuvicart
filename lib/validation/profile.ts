import { z } from "zod";

export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  avatarUrl: z.string().url().max(2048).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
});
export type ProfileInput = z.infer<typeof profileSchema>;
