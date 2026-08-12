import assert from "node:assert/strict";
import test from "node:test";
import worker from "./cloudflare-worker.js";

function request(method = "POST", passcode = "secret") {
  return new Request("https://worker.example.test", {
    method,
    headers: passcode ? { "X-Sync-Passcode": passcode } : {},
  });
}

test("Worker fail-closed khi thiếu SYNC_PASSCODE", async () => {
  const response = await worker.fetch(request(), { GITHUB_TOKEN: "github-token" }, {});
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.success, false);
  assert.equal(payload.status, "configuration_error");
});

test("Worker từ chối mật mã sai", async () => {
  const response = await worker.fetch(request("POST", "wrong"), {
    SYNC_PASSCODE: "secret",
    GITHUB_TOKEN: "github-token",
  }, {});

  assert.equal(response.status, 401);
  assert.equal((await response.json()).status, "unauthorized");
});

test("Worker fail-closed khi thiếu GITHUB_TOKEN", async () => {
  const response = await worker.fetch(request(), { SYNC_PASSCODE: "secret" }, {});

  assert.equal(response.status, 500);
  assert.equal((await response.json()).status, "configuration_error");
});

test("Worker dispatch full scan và trả trạng thái accepted", async () => {
  const originalFetch = globalThis.fetch;
  let githubRequest;
  globalThis.fetch = async (url, options) => {
    githubRequest = { url, options };
    return new Response(null, { status: 204 });
  };

  try {
    const response = await worker.fetch(request(), {
      SYNC_PASSCODE: "secret",
      GITHUB_TOKEN: "github-token",
      GITHUB_OWNER: "owner",
      GITHUB_REPO: "repo",
      GITHUB_WORKFLOW_ID: "update-snapshot.yml",
    }, {});
    const payload = await response.json();
    const dispatchBody = JSON.parse(githubRequest.options.body);

    assert.equal(response.status, 202);
    assert.equal(payload.success, true);
    assert.equal(payload.status, "accepted");
    assert.equal(payload.scope, "full");
    assert.equal(githubRequest.options.method, "POST");
    assert.deepEqual(dispatchBody, {
      ref: "main",
      inputs: { scan_all: "true" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Worker chuyển lỗi GitHub thành trạng thái rejected", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("invalid token", { status: 401 });

  try {
    const response = await worker.fetch(request(), {
      SYNC_PASSCODE: "secret",
      GITHUB_TOKEN: "github-token",
    }, {});
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
    assert.equal(payload.status, "rejected");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
