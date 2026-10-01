import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  fetchOptions: { credentials: "same-origin" },
});

export type AuthCapabilities = {
  ready: boolean;
  emailPassword: boolean;
  emailDelivery: boolean;
  providers: Record<"google" | "github" | "apple", boolean>;
};

export async function signOut(): Promise<void> {
  const result = await authClient.signOut();
  if (result.error) throw new Error();
}

export const authErrorKey = (code?: string) => {
  if (code === "EMAIL_NOT_VERIFIED") return "auth.errors.verifyEmail";
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "auth.errors.credentials";
  if (code === "FRESH_SESSION_REQUIRED" || code === "SESSION_NOT_FRESH")
    return "auth.errors.freshSession";
  if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED")
    return "auth.errors.expiredLink";
  if (code === "ACCOUNT_MIGRATION_REQUIRED" || code === "ACCOUNT_NOT_LINKED")
    return "auth.errors.existingMethod";
  if (code === "EMAIL_DELIVERY_UNAVAILABLE" || code === "AUTH_UNAVAILABLE")
    return "auth.errors.unavailable";
  return "auth.errors.tryAgain";
};
