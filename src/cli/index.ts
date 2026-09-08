import { resolve } from "node:path";
import { initVideoChatApp } from "./init.js";
import { addVideoChatProvider } from "./providers.js";
import { doctorVideoChatApp } from "./doctor.js";

export interface VanillaSkyCliEnvironment {
  cwd?: string;
  write?: (line: string) => void;
  /** Test/host override for the packaged canonical starter. */
  starterRoot?: string;
  /** Test/host override for the package spec supplied by npx. */
  sdkSpec?: string;
  /** Test/host override for the package-manager operation performed by init. */
  installDependencies?: (cwd: string) => void | Promise<void>;
}

function help(): string {
  return [
    "VanillaSky video chat",
    "",
    "Usage:",
    "  vanillasky init [--native]",
    "  vanillasky doctor",
    "  vanillasky providers add <speech|transcription>",
    "  vanillasky providers add video [fal|google|runway|custom]",
  ].join("\n");
}

function unknownOption(command: string, args: readonly string[], allowed: readonly string[]): string | undefined {
  const known = new Set(allowed);
  const unknown = args.find((arg) => arg.startsWith("-") && !known.has(arg));
  return unknown ? `Unknown ${command} option: ${unknown}` : undefined;
}

function sanitizeTerminalOutput(value: string): string {
  return [...value].filter((character) => {
    const code = character.charCodeAt(0);
    return code > 159 || (code > 31 && code < 127) || code === 9 || code === 10;
  }).join("");
}

export function runVanillaSkyCli(
  argv: string[],
  environment: VanillaSkyCliEnvironment = {},
): number | Promise<number> {
  const output = environment.write ?? console.log;
  const write = (line: string): void => output(sanitizeTerminalOutput(line));
  const cwd = resolve(environment.cwd ?? process.cwd());
  const [rootCommand, ...rootArgs] = argv;

  if (rootCommand === "init") {
    return (async () => {
      try {
        const unknown = unknownOption("init", rootArgs, ["--native"]);
        if (unknown) throw new Error(unknown);
        const unexpected = rootArgs.find(argument => argument !== "--native");
        if (unexpected || rootArgs.length > 1) throw new Error(`Unexpected init argument: ${unexpected ?? rootArgs[1]}`);
        const result = await initVideoChatApp({
          cwd,
          native: rootArgs.includes("--native") ? true : undefined,
          starterRoot: environment.starterRoot,
          sdkSpec: environment.sdkSpec ?? process.env.npm_config_package,
          installDependencies: environment.installDependencies,
        });
        write(result.initialized ? "Video chat initialized with chapter introductions and browser voice." : "Video chat is already initialized; dependencies checked.");
        const health = doctorVideoChatApp(cwd);
        health.lines.forEach(write);
        const requiredKey = health.lines.find(line => /^MISSING {2}(ANTHROPIC_API_KEY|GEMINI_API_KEY) in \.env\.local$/.test(line))?.split("  ")[1].split(" ")[0];
        write(health.ok ? "Ready. Run: npm run dev" : requiredKey
          ? `Add ${requiredKey} to .env.local. Then run: npm run dev`
          : "Next: fix the missing setup items above, then run npm run dev.");
        return 0;
      } catch (error) {
        write(error instanceof Error ? error.message : String(error));
        return 1;
      }
    })();
  }

  if (rootCommand === "providers") {
    return (async () => {
      try {
        const usage = "Usage: vanillasky providers add <speech|transcription> or vanillasky providers add video [fal|google|runway|custom]";
        if (rootArgs[0] !== "add" || rootArgs.length < 2 || rootArgs.length > 3) throw new Error(usage);
        const vendor = rootArgs[2];
        if (vendor !== undefined && (rootArgs[1] !== "video" || !["fal", "google", "runway", "custom"].includes(vendor))) throw new Error(usage);
        write(await addVideoChatProvider(rootArgs[1], {
          cwd, starterRoot: environment.starterRoot, installDependencies: environment.installDependencies,
          vendor: vendor as "fal" | "google" | "runway" | "custom" | undefined,
        }));
        return 0;
      } catch (error) {
        write(error instanceof Error ? error.message : String(error));
        return 1;
      }
    })();
  }

  if (rootCommand === "doctor") {
    const unknown = unknownOption("doctor", rootArgs, []);
    if (unknown) {
      write(unknown);
      return 1;
    }
    if (rootArgs.length > 0) {
      write(`Unexpected doctor argument: ${rootArgs[0]}`);
      return 1;
    }
    const result = doctorVideoChatApp(cwd);
    for (const line of result.lines) write(line);
    return result.ok ? 0 : 1;
  }

  write(help());
  return rootCommand == null || rootCommand === "help" || rootCommand === "--help" || rootCommand === "-h" ? 0 : 1;
}
