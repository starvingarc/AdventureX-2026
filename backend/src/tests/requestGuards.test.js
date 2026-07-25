import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import {
  checkRateLimit,
  corsHeadersForRequest,
  evaluateRequestGuards,
  isValidDeviceId,
  maxBodyBytesForRequest,
  rateLimitGroupForRequest,
  readJsonBodyWithLimit,
  RequestGuardError,
  resetRequestGuardState,
  resolveDeviceId
} from "../security/requestGuards.js";

function mockRequest({ method = "GET", url = "/api/chapters", headers = {}, body = "" } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

test("validates anonymous device ids without rejecting UUIDs or test ids", () => {
  assert.equal(isValidDeviceId("demo-device"), true);
  assert.equal(isValidDeviceId("device-1"), true);
  assert.equal(isValidDeviceId("8f4fc496-2d11-4dd7-9bda-9e62f32b8d91"), true);
  assert.equal(isValidDeviceId("../bad"), false);
  assert.equal(isValidDeviceId("a".repeat(129)), false);
});

test("requires valid device ids for private API routes only", () => {
  const invalid = resolveDeviceId(mockRequest({
    headers: { "x-device-id": "../bad" }
  }));
  assert.equal(invalid.valid, false);

  const privateGuard = evaluateRequestGuards(mockRequest({
    method: "GET",
    url: "/api/chapters",
    headers: { "x-device-id": "../bad" }
  }), {
    deviceIdResult: invalid,
    env: { SHIBEI_RATE_LIMIT_DISABLED: "1" }
  });
  assert.equal(privateGuard.errorCode, "invalid_device_id");

  const publicGuard = evaluateRequestGuards(mockRequest({
    method: "GET",
    url: "/api/health",
    headers: { "x-device-id": "../bad" }
  }), {
    deviceIdResult: invalid,
    env: { SHIBEI_RATE_LIMIT_DISABLED: "1" }
  });
  assert.equal(publicGuard, null);

  const versionGuard = evaluateRequestGuards(mockRequest({
    method: "GET",
    url: "/api/version",
    headers: { "x-device-id": "../bad" }
  }), {
    deviceIdResult: invalid,
    env: { SHIBEI_RATE_LIMIT_DISABLED: "1" }
  });
  assert.equal(versionGuard, null);
});

test("reads JSON body with a hard size limit", async () => {
  const ok = await readJsonBodyWithLimit(mockRequest({
    method: "POST",
    url: "/api/v2/chapters",
    body: JSON.stringify({ title: "ok" })
  }), { maxBytes: 64 });
  assert.deepEqual(ok, { title: "ok" });

  await assert.rejects(
    () => readJsonBodyWithLimit(mockRequest({
      method: "POST",
      url: "/api/v2/chapters",
      body: JSON.stringify({ text: "x".repeat(128) })
    }), { maxBytes: 64 }),
    (error) => {
      assert.equal(error instanceof RequestGuardError, true);
      assert.equal(error.statusCode, 413);
      assert.equal(error.errorCode, "request_body_too_large");
      return true;
    }
  );
});

test("classifies generation and mutation routes for limits", () => {
  assert.equal(rateLimitGroupForRequest(mockRequest({ method: "POST", url: "/api/v2/chapters" })), "generation");
  assert.equal(rateLimitGroupForRequest(mockRequest({ method: "POST", url: "/api/sources/image-flow" })), "generation");
  assert.equal(rateLimitGroupForRequest(mockRequest({ method: "POST", url: "/api/v2/recommended-articles/a/import" })), "recommended-import");
  assert.equal(rateLimitGroupForRequest(mockRequest({ method: "POST", url: "/api/notifications/n1/read" })), "mutation");
  assert.equal(rateLimitGroupForRequest(mockRequest({ method: "GET", url: "/api/health" })), "none");
  assert.equal(rateLimitGroupForRequest(mockRequest({ method: "GET", url: "/api/version" })), "none");
  assert.equal(rateLimitGroupForRequest(mockRequest({ method: "GET", url: "/api/sources/image-flow/jobs/11111111-1111-1111-1111-111111111111" })), "normal-api");
});

test("allows screenshots larger than the generic JSON limit only on the image flow", () => {
  const imageRequest = mockRequest({ method: "POST", url: "/api/sources/image-flow" });
  const regularRequest = mockRequest({ method: "POST", url: "/api/notifications/n1/read" });
  assert.equal(maxBodyBytesForRequest(imageRequest, {}), 8 * 1024 * 1024);
  assert.equal(maxBodyBytesForRequest(regularRequest, {}), 1024 * 1024);
  assert.equal(maxBodyBytesForRequest(imageRequest, { SHIBEI_MAX_IMAGE_FLOW_BODY_BYTES: "3145728" }), 3 * 1024 * 1024);
});

test("limits repeated generation requests by device and ip", () => {
  resetRequestGuardState();
  const req = mockRequest({
    method: "POST",
    url: "/api/v2/chapters",
    headers: { "x-device-id": "device-1" }
  });
  const env = {
    SHIBEI_GENERATION_RATE_LIMIT: "2",
    SHIBEI_GENERATION_RATE_LIMIT_WINDOW_MS: "60000"
  };

  assert.equal(checkRateLimit(req, { deviceId: "device-1", env, now: 1000 }).allowed, true);
  assert.equal(checkRateLimit(req, { deviceId: "device-1", env, now: 1001 }).allowed, true);
  const limited = checkRateLimit(req, { deviceId: "device-1", env, now: 1002 });
  assert.equal(limited.allowed, false);
  assert.equal(limited.group, "generation");
  assert.equal(limited.retryAfterSeconds, 60);

  resetRequestGuardState();
});

test("uses explicit production CORS allowlist", () => {
  const allowed = corsHeadersForRequest(mockRequest({
    headers: { origin: "https://app.example.com" }
  }), {
    NODE_ENV: "production",
    SHIBEI_ALLOWED_ORIGINS: "https://app.example.com,https://admin.example.com"
  });
  assert.equal(allowed["access-control-allow-origin"], "https://app.example.com");

  const denied = corsHeadersForRequest(mockRequest({
    headers: { origin: "https://evil.example.com" }
  }), {
    NODE_ENV: "production",
    SHIBEI_ALLOWED_ORIGINS: "https://app.example.com"
  });
  assert.equal(denied["access-control-allow-origin"], undefined);

  const dev = corsHeadersForRequest(mockRequest({
    headers: { origin: "http://localhost:5173" }
  }), {});
  assert.equal(dev["access-control-allow-origin"], "http://localhost:5173");
});
