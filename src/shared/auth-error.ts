export class ProviderAuthError extends Error {
  constructor() {
    super("not signed in");
  }
}
