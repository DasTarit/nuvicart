export const APP_ROLES = ["customer", "admin", "super_admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];
