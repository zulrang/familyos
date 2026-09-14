/** getRandomValues works on the household's HTTP origin; randomUUID requires HTTPS. */
export function requestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
