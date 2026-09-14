import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  MITIGATION_SECONDS,
  PERIOD_SECONDS,
  REQUESTS_PER_PERIOD,
  RULE_REF,
  applyRateLimit,
  hostnameExpression,
} from "./waf-rate-limit.mjs";

function response(result, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, result }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Remote-only WAF rate limit", () => {
  it("uses the generated hostname namespace and generous Free-plan threshold", () => {
    assert.equal(hostnameExpression("illuminary.studio"), '(http.host wildcard "sp-*.illuminary.studio")');
    assert.equal(REQUESTS_PER_PERIOD, 60);
    assert.equal(PERIOD_SECONDS, 10);
    assert.equal(MITIGATION_SECONDS, 10);
  });

  it("creates and reads back exactly one dedicated rule", async () => {
    let created;
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push([url, init.method ?? "GET"]);
      if (url.endsWith("/entrypoint")) return response(null, 404);
      if ((init.method ?? "GET") === "POST") {
        created = JSON.parse(init.body);
        return response({ id: "a".repeat(32), ...created, rules: [{ id: "b".repeat(32), ...created.rules[0] }] });
      }
      return response({ id: "a".repeat(32), ...created, rules: [{ id: "b".repeat(32), ...created.rules[0] }] });
    };

    const result = await applyRateLimit({
      zoneId: "c".repeat(32),
      token: "narrow-provider-token",
      suffix: "illuminary.studio",
      fetchImpl,
    });

    assert.equal(created.phase, "http_ratelimit");
    assert.equal(created.rules.length, 1);
    assert.equal(created.rules[0].ref, RULE_REF);
    assert.equal(result.rulesetId, "a".repeat(32));
    assert.equal(result.ruleId, "b".repeat(32));
    assert.equal(calls.length, 3);
  });

  it("refuses to replace an unrelated rate-limit rule", async () => {
    const fetchImpl = async () => response({
      id: "a".repeat(32),
      rules: [{ id: "b".repeat(32), ref: "unrelated" }],
    });
    await assert.rejects(
      applyRateLimit({
        zoneId: "c".repeat(32), token: "narrow-provider-token", suffix: "illuminary.studio", fetchImpl,
      }),
      /Refusing to modify an unrelated/,
    );
  });
});
