#!/usr/bin/env node
/**
 * One-time (and safe to repeat) setup for demo mode:
 *   1. .env.local from .env.demo.example, with a generated NEXTAUTH_SECRET
 *   2. a throwaway PKCS#8 RSA key at .key/rsa_key.p8
 *   3. DynamoDB Local and a local S3 store (docker compose), then the table and bucket
 *
 * Nothing is overwritten: an existing .env.local or key is kept.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env.local");
const ENV_EXAMPLE = path.join(ROOT, ".env.demo.example");
const KEY_FILE = path.join(ROOT, ".key", "rsa_key.p8");

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

function ensureEnvFile() {
  if (fs.existsSync(ENV_FILE)) {
    const env = parseEnv(fs.readFileSync(ENV_FILE, "utf8"));
    if (env.DEV_AUTH !== "true" || env.MOCK_SNOWFLAKE !== "true") {
      console.warn(
        "Keeping the existing .env.local, but it does not set DEV_AUTH=true and MOCK_SNOWFLAKE=true.\n" +
          "Delete it and run this again to get the demo settings.",
      );
    } else {
      console.log("Keeping the existing .env.local");
    }
    return env;
  }

  const secret = crypto.randomBytes(32).toString("base64");
  const text = fs
    .readFileSync(ENV_EXAMPLE, "utf8")
    .replace(/^NEXTAUTH_SECRET=.*$/m, `NEXTAUTH_SECRET=${secret}`);
  fs.writeFileSync(ENV_FILE, text);
  console.log("Created .env.local from .env.demo.example");
  return parseEnv(text);
}

function ensureKey() {
  if (fs.existsSync(KEY_FILE)) {
    console.log("Keeping the existing .key/rsa_key.p8");
    return;
  }
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, privateKey, { mode: 0o600 });
  console.log("Created a throwaway key at .key/rsa_key.p8");
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

async function waitFor(url, label) {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`${label} did not start within 60 seconds`);
}

async function main() {
  const env = ensureEnvFile();
  ensureKey();

  console.log("Starting DynamoDB Local and the local S3 store...");
  try {
    run("docker", ["compose", "up", "-d", "dynamodb-local", "s3"]);
  } catch {
    console.error(
      "Could not start the local services. Is Docker running? Install it from https://docs.docker.com/get-docker/",
    );
    process.exit(1);
  }

  await waitFor("http://127.0.0.1:8001", "DynamoDB Local");
  await waitFor("http://127.0.0.1:9000", "the local S3 store");

  run("node", ["bin/setup-local-dynamodb.js"]);
  run("node", ["bin/setup-local-s3.js"], {
    S3_LOCAL_ACCESS_KEY: env.S3_LOCAL_ACCESS_KEY,
    S3_LOCAL_SECRET_KEY: env.S3_LOCAL_SECRET_KEY,
    CONVERSATION_S3_BUCKET: env.CONVERSATION_S3_BUCKET,
    S3_ENDPOINT: env.S3_ENDPOINT,
  });

  console.log("\nDemo setup is done. Start the app with: pnpm demo");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
