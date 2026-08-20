/** Provider / Google auth failure (not Display pairing). */
export class AuthError extends Error {
  constructor() {
    super("not signed in");
  }
}
