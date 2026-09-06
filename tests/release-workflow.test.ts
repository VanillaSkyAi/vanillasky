import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("release workflow", () => {
  it("publishes stable pre-1.0 releases to the latest npm tag explicitly", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(workflow).toContain(
      'npm publish "./release-assets/${{ needs.verify.outputs.artifact-filename }}" --provenance --access public --tag latest',
    );
  });

  it("publishes prereleases to the beta npm tag", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(workflow).toContain(
      'npm publish "./release-assets/${{ needs.verify.outputs.artifact-filename }}" --provenance --access public --tag beta',
    );
    expect(workflow).not.toContain("release_tag=next");
    expect(workflow).not.toContain("--tag next");
  });

  it("verifies, publishes, and uploads one exact packed release artifact", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(workflow).toContain("id: artifact");
    expect(workflow).toContain("npm run release:build -- --ci");
    expect(workflow).toContain("VANILLASKY_PACKED_TARBALL: ./release-assets/${{ needs.verify.outputs.artifact-filename }}");
    expect(workflow).toContain("VANILLASKY_EXPECTED_INTEGRITY: ${{ needs.verify.outputs.integrity }}");
    expect(workflow).toContain('npm publish "./release-assets/${{ needs.verify.outputs.artifact-filename }}" --provenance --access public --tag latest');
    expect(workflow).toContain('npm publish "./release-assets/${{ needs.verify.outputs.artifact-filename }}" --provenance --access public --tag beta');
    expect(workflow).toContain("if: ${{ always() && hashFiles('artifacts/release-verification/**') != '' }}");
    expect(workflow).toContain("VANILLASKY_EXPECTED_SHA256:");
    expect(workflow).not.toContain("--clobber");
    expect(workflow).not.toMatch(/\bnpm pack(?:\s|$)/);
    expect(workflow).toContain('dist-tags "${{ needs.verify.outputs.name }}" "${{ needs.verify.outputs.version }}"');

    const buildArtifact = workflow.indexOf("- name: Build release artifact");
    const verifyArtifact = workflow.indexOf("- name: Verify exact release artifact");
    const publishNpm = workflow.indexOf("- name: Publish stable package with trusted provenance");
    const verifyNpm = workflow.indexOf("- name: Verify npm artifact identity");
    const verifyPublished = workflow.indexOf("- name: Verify published npm package");
    const publishGitHub = workflow.indexOf("- name: Publish immutable GitHub release");
    expect(buildArtifact).toBeLessThan(verifyArtifact);
    expect(verifyArtifact).toBeLessThan(publishNpm);
    expect(publishNpm).toBeLessThan(verifyNpm);
    expect(verifyNpm).toBeLessThan(verifyPublished);
    expect(verifyPublished).toBeLessThan(publishGitHub);
  });

  it("separates read-only verification, OIDC publishing, and GitHub release permissions", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(workflow).toContain("verify:");
    expect(workflow).toContain("publish-npm:");
    expect(workflow).toContain("publish-github-release:");
    expect(workflow).toMatch(/verify:[\s\S]*?permissions:\n\s+contents: read/);
    expect(workflow).toMatch(/publish-npm:[\s\S]*?permissions:\n\s+contents: read\n\s+id-token: write/);
    expect(workflow).toMatch(/publish-github-release:[\s\S]*?permissions:\n\s+contents: write/);
    expect(workflow).not.toMatch(/^permissions:\n\s+contents: write/m);
  });

  it("publishes through the configured OIDC trusted publisher without a long-lived token", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    const guide = readFileSync("docs/maintainers/releasing.md", "utf8");

    expect(workflow).toContain("id-token: write");
    expect(workflow).not.toContain(["NPM", "BOOTSTRAP", "TOKEN"].join("_"));
    expect(workflow).not.toContain("NODE_AUTH_TOKEN");
    expect(guide).not.toMatch(/bootstrap|first[- ]release/i);
    expect(guide).toMatch(/trusted publisher/i);
  });

  it("pins actions, npm, repository identity, ancestry, and annotated-tag eligibility", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(workflow).toContain("npm@11.17.0");
    expect(workflow).toContain("repository-identity:");
    expect(workflow).toContain('EXPECTED_REPOSITORY: VanillaSkyAi/video');
    expect(workflow).toContain('if [[ "$GITHUB_REPOSITORY" != "$EXPECTED_REPOSITORY" ]]');
    expect(workflow).toContain("needs: repository-identity");
    expect(workflow).not.toMatch(/^\s+if:\s+github\.repository\s*==/m);
    expect(workflow).toContain("VANILLASKY_APPROVED_BRANCH: origin/main");
    expect(workflow).toContain("release:build -- --ci");
    expect(workflow).toContain("verify-release-integrity.mjs dist-tags");
    expect(workflow).toContain("verify-release-integrity.mjs dist-tags-transition");
    expect(workflow.indexOf("verify-release-integrity.mjs dist-tags-transition"))
      .toBeLessThan(workflow.indexOf("npm publish"));
    expect(workflow).not.toContain("package-manager-cache");
    expect(workflow).toContain("--notes-file release-assets/RELEASE_NOTES.md");
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d+/);
    for (const sha of [
      "3d3c42e5aac5ba805825da76410c181273ba90b1",
      "820762786026740c76f36085b0efc47a31fe5020",
      "ea165f8d65b6e75b540449e92b4886f43607fa02",
      "d3f86a106a0bac45b974a628896c90dbdf5c8093",
    ]) expect(workflow).toContain(sha);
    expect(workflow).not.toContain("11d5960a326750d5838078e36cf38b85af677262");
    expect(workflow).not.toContain("49933ea5288caeca8642d1e84afbd3f7d6820020");
  });

  it("restores the remote annotated tag object after checkout before building the release", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    const checkout = workflow.indexOf("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
    const restoreTag = workflow.indexOf("- name: Restore annotated release tag object");
    const buildArtifact = workflow.indexOf("- name: Build release artifact");
    expect(restoreTag).toBeGreaterThan(checkout);
    expect(restoreTag).toBeLessThan(buildArtifact);
    expect(workflow).toContain(
      'git fetch --force origin "refs/tags/$GITHUB_REF_NAME:refs/tags/$GITHUB_REF_NAME"',
    );
  });

  it("packs on the host and isolates published browser verification", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    const verifyJob = workflow.split("  verify:")[1].split("  publish-npm:")[0];
    const publishedJob = workflow.split("  verify-published:")[1].split("  publish-github-release:")[0];
    const image = "mcr.microsoft.com/playwright:v1.62.0-noble@sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07";

    expect(verifyJob).not.toContain("container:");
    // The tag job packs a commit CI already verified; it must not re-run the suite.
    expect(verifyJob).not.toContain("playwright install");
    expect(verifyJob).not.toContain("npm test");
    expect(publishedJob).toContain(`image: ${image}`);
    expect(publishedJob).toContain("options: --init --ipc=host --user pwuser");
    expect(publishedJob).not.toContain("playwright install");
  });

  it("documents a repeatable path for every new release tag", () => {
    const guide = readFileSync("docs/maintainers/releasing.md", "utf8");

    expect(guide).toContain("VanillaSkyAi/video");
    expect(guide).toMatch(/before creating.*tag/is);
    expect(guide).not.toContain("VanillaSkyAi/vanillasky-sdk");
    expect(guide).not.toMatch(/fresh repository|first[- ]release/i);
    expect(guide).toMatch(/publish.*exact.*tarball[\s\S]*site/i);
  });

  it("keeps onboarding evergreen while release examples pin the exact artifact", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const releaseBuild = readFileSync("scripts/release-build.mjs", "utf8");
    const publicGuides = [
      "README.md",
      "docs/getting-started.md",
      "docs/provider-integration.md",
      "skills/vanillasky/SKILL.md",
    ];

    for (const path of publicGuides) {
      const guide = readFileSync(path, "utf8");
      expect(guide, path).toContain("npx @vanillaskyai/video init");
      expect(guide, path).not.toContain(`@vanillaskyai/video@${manifest.version}`);
    }
    expect(releaseBuild).not.toContain("must pin the install command");
    expect(releaseBuild).not.toContain("must link examples at");
    expect(releaseBuild).toContain('path: join("starters", "video-chat")');
    const executableConsumers = [["video-chat", "starters/video-chat"]];
    for (const [name, path] of executableConsumers) {
      const exampleManifest = JSON.parse(readFileSync(`${path}/package.json`, "utf8"));
      expect(exampleManifest.dependencies["@vanillaskyai/video"], name).toBe(manifest.version);
    }
  });

  it("fails closed on an incomplete existing GitHub release without mutating it", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(workflow).toMatch(/publish-github-release:[\s\S]*?actions\/checkout@[a-f0-9]{40}[\s\S]*?fetch-depth: 0/);
    expect(workflow).toContain('if gh release download "$GITHUB_REF_NAME" --pattern');
    expect(workflow).toContain("verify-github-release.mjs");
    expect(workflow).toContain('--notes-file release-assets/RELEASE_NOTES.md --target main');
    expect(workflow).not.toContain("gh release upload");
    expect(workflow).not.toMatch(/if gh release view[\s\S]*?else\n\s+gh release upload/);
    expect(workflow).not.toContain("--clobber");
  });

  it("records the local-tarball publish argv without invoking npm", () => {
    const workspace = mkdtempSync(join(tmpdir(), "vanillasky-release-publish-spec-"));
    const assets = join(workspace, "release-assets");
    try {
      mkdirSync(assets);
      const filename = "vanillaskyai-video-0.1.0.tgz";
      writeFileSync(join(assets, filename), "recording-only fixture");
      const localTarball = `./release-assets/${filename}`;
      const argvPath = join(workspace, "npm-argv.json");
      const recorderPath = join(workspace, "record-npm.mjs");
      writeFileSync(recorderPath, [
        'import { writeFileSync } from "node:fs";',
        'writeFileSync(process.env.NPM_ARGV_PATH, JSON.stringify(process.argv.slice(2)));',
      ].join("\n"));

      execFileSync(process.execPath, [
        recorderPath,
        "publish",
        localTarball,
        "--provenance",
        "--access",
        "public",
        "--tag",
        "latest",
      ], { cwd: workspace, env: { ...process.env, NPM_ARGV_PATH: argvPath } });

      expect(JSON.parse(readFileSync(argvPath, "utf8"))).toEqual([
        "publish",
        localTarball,
        "--provenance",
        "--access",
        "public",
        "--tag",
        "latest",
      ]);
      expect(localTarball).toMatch(/^\.\/release-assets\/.+\.tgz$/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("pins every CI action to the reviewed v7 commit", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const actions = [...workflow.matchAll(/uses:\s+(actions\/(?:checkout|setup-node))@([^\s]+)/g)];
    expect(actions).toHaveLength(14);
    for (const [, action, revision] of actions) {
      expect(revision, action).toMatch(/^[a-f0-9]{40}$/);
    }
    expect(workflow).toContain("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1");
    expect(workflow).toContain("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0");
  });

  it("supports the current Vercel Node floor and verifies the next runtime", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const nodeCompatibility = workflow
      .split("  node-compatibility:")[1]
      .split("  react-compatibility:")[0];

    expect(manifest.engines.node).toBe(">=22");
    expect(workflow).toContain("node-version: 22");
    expect(nodeCompatibility).toContain("node: [24]");
    expect(nodeCompatibility).not.toMatch(/node:\s*\[[^\]]*20/);
  });

  it("uses React 19 by default and verifies React 18 source compatibility", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const example = JSON.parse(readFileSync("starters/video-chat/package.json", "utf8"));
    const reactCompatibility = workflow
      .split("  react-compatibility:")[1]
      .split("  browser-gate:")[0];

    expect(manifest.devDependencies.react).toMatch(/^\^19\./);
    expect(manifest.devDependencies["react-dom"]).toMatch(/^\^19\./);
    expect(manifest.devDependencies["@types/react"]).toMatch(/^\^19\./);
    expect(manifest.devDependencies["@types/react-dom"]).toMatch(/^\^19\./);
    expect(example.dependencies.react).toMatch(/^\^19\./);
    expect(example.dependencies["react-dom"]).toMatch(/^\^19\./);
    expect(reactCompatibility).toContain("react: [18]");
    expect(reactCompatibility).toContain("npm install --no-audit --no-save --package-lock=false");
    expect(reactCompatibility).toContain("react@${{ matrix.react }}.3.1");
    expect(reactCompatibility).toContain("react-dom@${{ matrix.react }}.3.1");
    expect(reactCompatibility).toContain("@types/react@18.3.28");
    expect(reactCompatibility).toContain("@types/react-dom@18.3.7");
    expect(reactCompatibility).toContain("npm run typecheck");
    expect(reactCompatibility).toContain("npm run build");
  });

  it("parallelizes expensive consumer gates and uses one immutable browser image", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    expect(workflow).toContain("  consumer-gate:");
    expect(workflow).toContain("  consumer-compatibility:");
    expect(workflow).toContain("  provider-gate:");
    expect(workflow).toContain("  provider-compatibility:");
    const consumerGate = workflow.split("  consumer-gate:")[1].split("  consumer-compatibility:")[0];
    const consumerAggregate = workflow.split("  consumer-compatibility:")[1].split("  provider-gate:")[0];
    const providerGate = workflow.split("  provider-gate:")[1].split("  provider-compatibility:")[0];
    const providerAggregate = workflow.split("  provider-compatibility:")[1].split("  node-compatibility:")[0];
    const browserJob = workflow.split("  browser-gate:")[1]?.split("  browser-compatibility:")[0] ?? "";
    const browserAggregate = workflow.split("  browser-compatibility:")[1];

    expect(consumerGate).toContain("gate: [public-api, packed-package, onboarding]");
    for (const gate of [consumerGate, providerGate]) {
      expect(gate).toContain("needs: candidate");
      expect(gate).toContain("VANILLASKY_PACKED_TARBALL:");
      expect(gate).toContain("VANILLASKY_EXPECTED_INTEGRITY:");
      expect(gate).toContain("name: sdk-candidate");
    }
    expect(workflow).toContain("cancel-in-progress: true");
    expect(consumerGate).not.toContain("documented-examples");
    expect(consumerGate).not.toContain("npm run examples:verify-documented");
    expect(consumerGate).toContain("node scripts/verify-public-api-surface.mjs");
    expect(consumerGate).toContain("node scripts/verify-packed-package.mjs");
    expect(consumerGate).toContain("npm run verify:onboarding");
    expect(consumerGate).not.toContain("npm run examples:install-current");
    expect(consumerGate).not.toContain("npm run example:build");
    expect(consumerGate).not.toContain("npm run server-examples:typecheck");
    expect(consumerAggregate).toContain("needs: consumer-gate");
    expect(consumerAggregate).toContain("needs.consumer-gate.result");

    expect(providerGate).toContain("provider: [openai, anthropic, google, openrouter]");
    expect(providerGate).toContain("VANILLASKY_PROVIDER: ${{ matrix.provider }}");
    expect(providerGate).toContain("npm run verify:nextjs");
    expect(providerAggregate).toContain("needs: provider-gate");
    expect(providerAggregate).toContain("needs.provider-gate.result");

    for (const job of [consumerGate, providerGate, workflow.split("  node-compatibility:")[1].split("  react-compatibility:")[0], workflow.split("  react-compatibility:")[1].split("  browser-gate:")[0], browserJob]) {
      expect(job).toContain("if: github.event_name == 'pull_request'");
    }
    expect(workflow).toContain(
      "mcr.microsoft.com/playwright:v1.62.0-noble@sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07",
    );
    expect(browserJob).toContain("options: --ipc=host");
    expect(browserJob).toMatch(/runuser -u pwuser -- bash -eu -c '[\s\S]*npx playwright test[\s\S]*'/);
    expect(browserJob).toContain("module-null-sink sink_name=cinematic_test");
    expect(browserJob).toContain('trap "pulseaudio --kill" EXIT');
    expect(manifest.devDependencies["@playwright/test"]).toBe("1.62.0");
    expect(browserJob).not.toContain("playwright install");
    expect(workflow.match(/npx playwright test(?:\s|$)/g)).toHaveLength(2);
    expect(browserJob).toContain("browser: [chromium, firefox, webkit]");
    expect(browserJob).toContain("fail-fast: false");
    expect(browserJob).toContain("shard: [1, 2]");
    expect(browserJob).toContain("npx playwright test --project=${{ matrix.browser }} --shard=${{ matrix.shard }}/2 --workers=1");
    expect(browserJob).toContain('if [[ "${{ matrix.browser }}" == "chromium" && "${{ matrix.shard }}" == "1" ]]; then');
    expect(browserJob).toContain("name: browser-playback-evidence-${{ matrix.browser }}-${{ matrix.shard }}");
    expect(browserJob).toContain("if: always()");
    expect(browserAggregate).toContain("if: always() && github.event_name == 'pull_request'");
    expect(browserAggregate).toContain("needs: browser-gate");
    expect(browserAggregate).toContain("RESULT: ${{ needs.browser-gate.result }}");
    expect(browserAggregate).toContain('if [[ "$RESULT" != "success" ]]; then');
    expect(browserAggregate).toContain("exit 1");
    expect(workflow.match(/timeout-minutes:/g)).toHaveLength(10);
  });

  it("enforces the live npm-latest public API comparison in pull-request CI", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain("  consumer-gate:");
    const consumerJob = workflow.split("  consumer-gate:")[1].split("  consumer-compatibility:")[0];

    expect(workflow).toContain("pull_request:");
    expect(consumerJob).toContain("- run: node scripts/verify-public-api-surface.mjs");
    expect(consumerJob.indexOf("npm ci")).toBeLessThan(consumerJob.indexOf("node scripts/verify-public-api-surface.mjs"));
  });

  it("keeps the Vitest worker pool within the two-core hosted-runner budget", () => {
    const config = readFileSync("vitest.config.ts", "utf8");
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));

    expect(manifest.scripts.test).toBe("vitest run");
    expect(config).toContain("maxWorkers: 2");
    expect(config).not.toContain("testTimeout");
    expect(config).not.toContain("fileParallelism: false");
  });

  it("audits the shipped dependency tree without re-auditing development tools", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("npm audit --audit-level=low --omit=dev");
  });

  it("compiles the source-owned template tree in the clean-room consumer", () => {
    const verifier = readFileSync("scripts/verify-onboarding.mjs", "utf8");

    expect(verifier).toContain('runCapture("npx", ["--yes", "--package", installSpec, "vanillasky", "init"], app);');
    expect(verifier).not.toContain('writeFileSync(join(app, "package.json")');
    expect(verifier).toContain('run("npm", ["install", "--no-audit", "--no-fund", "--save-dev", "tsx@4.23.12"], app);');
    expect(verifier.indexOf('runCapture("npx", ["--yes", "--package", installSpec, "vanillasky", "init"], app);'))
      .toBeLessThan(verifier.indexOf('"--save-dev", "tsx@4.23.12"'));
    expect(verifier).toContain('join(app, "src", "template-ownership.ts")');
    expect(verifier).toContain('export { templates as browserTemplates } from "../vanillasky/index";');
    expect(verifier).toContain('export { templates as serverTemplates } from "../vanillasky/server";');
    expect(verifier.indexOf('runCli(["templates", "add", "keyFigure"])'))
      .toBeLessThan(verifier.lastIndexOf('run("npm", ["run", "build"], app)'));
  });

  it("exercises the complete packed CLI ownership journey without weakening the scaffold", () => {
    const verifier = readFileSync("scripts/verify-onboarding.mjs", "utf8");

    expect(verifier).toContain('runCapture("npx", ["--yes", "--package", installSpec, "vanillasky", "init"], app);');
    expect(verifier).toContain('const missingDoctor = runCli(["doctor"], { expectFailure: true });');
    expect(verifier).toContain('const readyDoctor = runCli(["doctor"]);');
    expect(verifier).toContain("Packed init exposed the server key in the browser bundle");
    expect(verifier).toContain('getByRole("heading", { name: /responds in video, not text/i })');
    expect(verifier).toContain("Initialized capability fallback drifted");
    expect(verifier).toContain("Initialized browser errors");
    expect(verifier).not.toContain("create-vite@");
    for (const command of ["list", "describe", "create", "add", "sync", "check"]) {
      expect(verifier).toContain(`runCli(["templates", "${command}"`);
    }
    expect(verifier).toContain('runCli(["templates", "add", "keyFigure", "--dry-run"]');
    expect(verifier).toContain('runCli(["templates", "add", "keyFigure", "--diff"]');
    expect(verifier).toContain('runCli(["templates", "sync", "--check"]');
    expect(verifier).toContain("assertProjectImports");
    expect(verifier).toContain("tsconfigSnapshot");
    expect(verifier).toContain("customer-owned acceptance edit");
    expect(verifier).toContain("Expected sync --check to detect deliberate drift");
    expect(verifier).toContain("repeatedAddTreeHash");
    expect(verifier).toContain("server-only-consumer");
    expect(verifier).toContain("Server-only consumer unexpectedly installed React");
    expect(verifier).not.toContain("skipLibCheck");
  });
});
