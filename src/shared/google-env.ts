export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

export function googleClient(): {
  id: string;
  secret: string;
  redirect: string;
} {
  const id = process.env.GOOGLE_CLIENT_ID ?? "";
  const secret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirect =
    process.env.GOOGLE_REDIRECT_URI ??
    "http://localhost:3000/api/auth/callback/google";
  return { id, secret, redirect };
}
