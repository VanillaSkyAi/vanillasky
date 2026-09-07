import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// These assertions cover what a green CI run cannot prove about itself: that the
// release pipeline publishes to the right dist-tag, holds least privilege, uses
// no long-lived credentials, and pins every third-party action to a commit.
// Anything CI proves by running (job wiring, matrix shapes, runner budgets) is
// deliberately not asserted here.

const releaseWorkflow = () => readFileSync(".github/workflows/release.yml", "utf8");

describe("release supply chain", () => {
  it("publishes stable and prerelease artifacts to explicit dist-tags", () => {
    const workflow = releaseWorkflow();
    const publish = 'npm publish "./release-assets/${{ needs.verify.outputs.artifact-filename }}" --provenance --access public';

    expect(workflow).toContain(`${publish} --tag latest`);
    expect(workflow).toContain(`${publish} --tag beta`);
    expect(workflow).not.toContain("--tag next");
  });

  it("separates read-only verification, OIDC publishing, and release-write permissions", () => {
    const workflow = releaseWorkflow();

    expect(workflow).toMatch(/verify:[\s\S]*?permissions:\n\s+contents: read/);
    expect(workflow).toMatch(/publish-npm:[\s\S]*?permissions:\n\s+contents: read\n\s+id-token: write/);
    expect(workflow).toMatch(/publish-github-release:[\s\S]*?permissions:\n\s+contents: write/);
    expect(workflow).not.toMatch(/^permissions:\n\s+contents: write/m);
  });

  it("publishes through the OIDC trusted publisher without a long-lived token", () => {
    const workflow = releaseWorkflow();

    expect(workflow).toContain("id-token: write");
    expect(workflow).not.toContain(["NPM", "BOOTSTRAP", "TOKEN"].join("_"));
    expect(workflow).not.toContain("NODE_AUTH_TOKEN");
  });

  it("refuses to publish from a fork or an unapproved branch", () => {
    const workflow = releaseWorkflow();

    expect(workflow).toContain("EXPECTED_REPOSITORY: VanillaSkyAi/video");
    expect(workflow).toContain('if [[ "$GITHUB_REPOSITORY" != "$EXPECTED_REPOSITORY" ]]');
    expect(workflow).toContain("needs: repository-identity");
    expect(workflow).toContain("VANILLASKY_APPROVED_BRANCH: origin/main");
    expect(workflow).toContain("npm@11.17.0");
  });

  it("verifies the dist-tag transition before the irreversible publish", () => {
    const workflow = releaseWorkflow();

    expect(workflow.indexOf("verify-release-integrity.mjs dist-tags-transition"))
      .toBeLessThan(workflow.indexOf("npm publish"));
  });

  it("never overwrites an existing GitHub release", () => {
    const workflow = releaseWorkflow();

    expect(workflow).toContain("verify-github-release.mjs");
    expect(workflow).not.toContain("--clobber");
    expect(workflow).not.toContain("gh release upload");
  });

  it("pins every third-party action to a full commit SHA", () => {
    for (const path of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
      const workflow = readFileSync(path, "utf8");
      const uses = [...workflow.matchAll(/uses:\s+([^\s@]+)@([^\s]+)/g)];

      expect(uses.length, path).toBeGreaterThan(0);
      for (const [, action, revision] of uses) {
        expect(revision, `${path} ${action}`).toMatch(/^[a-f0-9]{40}$/);
      }
    }
  });

  it("pins the browser container image by digest", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(ci).toMatch(/image: mcr\.microsoft\.com\/playwright:[^\s@]+@sha256:[a-f0-9]{64}/);
  });
});
