import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { AuthError } from "@/shared/auth-error";
import {
  EventConflictError,
  ProviderUnavailableError,
  rethrowAsUnavailable,
} from "./calendar-error";

afterEach(() => {
  vi.restoreAllMocks();
});

test("a Google outage is logged with the original error before becoming unavailable", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const google = new Error(
    'events 429 {"error":{"message":"Rate Limit Exceeded"}}',
  );
  try {
    rethrowAsUnavailable(google);
    assert.fail("expected throw");
  } catch (e) {
    assert.ok(e instanceof ProviderUnavailableError);
    assert.equal(e.cause, google);
  }
  assert.equal(spy.mock.calls.length, 1);
  assert.equal(spy.mock.calls[0]?.[0], "calendar unavailable:");
  assert.equal(spy.mock.calls[0]?.[1], google);
});

test("auth failures are not wrapped or logged as unavailable", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const auth = new AuthError();
  try {
    rethrowAsUnavailable(auth);
    assert.fail("expected throw");
  } catch (e) {
    assert.equal(e, auth);
  }
  assert.equal(spy.mock.calls.length, 0);
});

test("version conflicts are not wrapped or logged as unavailable", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const conflict = new EventConflictError(null);
  try {
    rethrowAsUnavailable(conflict);
    assert.fail("expected throw");
  } catch (e) {
    assert.equal(e, conflict);
  }
  assert.equal(spy.mock.calls.length, 0);
});
