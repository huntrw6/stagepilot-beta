import assert from "node:assert/strict";

// Reads the administrator metrics route after a live acceptance run and proves
// no disposable installation survived. The route exposes only aggregate
// counters, so this never records an installation ID, hostname, keyed source
// hash, provider body, or credential.

const origin = process.env.CONTROL_PLANE_ORIGIN;
const token = process.env.ADMIN_API_TOKEN;
assert(origin?.startsWith("https://") && token, "residue configuration is required");

const response = await fetch(`${origin}/v1/admin/metrics`, {
  headers: {
    authorization: `Bearer ${token}`,
    "user-agent": "StagePilot-private-beta-acceptance/1.0",
  },
});
assert.equal(response.status, 200, `admin metrics unavailable: ${response.status}`);
const metrics = await response.json();

const counters = {
  activeInstallations: metrics.activeInstallations,
  enrollments: metrics.enrollments,
  enrollmentDenied: metrics.enrollmentDenied,
  statusDenied: metrics.statusDenied,
  mutationDenied: metrics.mutationDenied,
  providerDenied: metrics.providerDenied,
};
assert(
  Object.values(counters).every((value) => Number.isInteger(value) && value >= 0),
  `admin metrics are not aggregate integer counters: ${JSON.stringify(counters)}`,
);
console.log(JSON.stringify(counters));
assert.equal(
  counters.activeInstallations,
  0,
  `disposable installation residue remains: ${counters.activeInstallations}`,
);
