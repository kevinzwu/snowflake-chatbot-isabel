#!/usr/bin/env node
/**
 * Setup local S3 (the local S3 emulator) bucket for conversation message overflow development.
 * Run this after starting: docker compose up -d s3
 *
 * Conversations whose serialized messages exceed 350KB overflow to S3 instead
 * of DynamoDB (see lib/dynamodb/conversation-storage.ts). Without this bucket,
 * saving a large conversation locally fails with a 500
 * ("CONVERSATION_S3_BUCKET environment variable is not configured").
 *
 * Uses explicit static credentials (not the default provider chain) to avoid
 * AWS SDK credential-chain issues on corporate networks, same rationale as
 * bin/setup-local-dynamodb.js. Uses a dynamic import (this file is CommonJS,
 * per the project's package.json) to load the ESM-only @aws-sdk/client-s3.
 */

const ENDPOINT = process.env.S3_ENDPOINT || "http://127.0.0.1:9000";
const BUCKET =
  process.env.CONVERSATION_S3_BUCKET || "isabel-local-conversations";

/**
 * Resolves local S3 (the local S3 emulator) credentials from the environment.
 * No in-code default: hardcoded credential strings (even well-known public
 * defaults like the local S3 emulator's "local") trip static-analysis secret scanners
 * (Snyk CWE-547), so these must be set explicitly — see .env.example.
 */
function getLocalCredentials() {
  const accessKeyId = process.env.S3_LOCAL_ACCESS_KEY;
  const secretAccessKey = process.env.S3_LOCAL_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) {
    console.error(
      "❌ S3_LOCAL_ACCESS_KEY and S3_LOCAL_SECRET_KEY must be set (see .env.example)",
    );
    process.exit(1);
  }
  return { accessKeyId, secretAccessKey };
}

async function bucketExists(client, HeadBucketCommand) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return true;
  } catch (err) {
    if (
      err.name === "NotFound" ||
      err.$metadata?.httpStatusCode === 404 ||
      err.name === "NoSuchBucket"
    ) {
      return false;
    }
    throw err;
  }
}

async function main() {
  const { S3Client, CreateBucketCommand, HeadBucketCommand } =
    await import("@aws-sdk/client-s3");

  const client = new S3Client({
    region: "local",
    endpoint: ENDPOINT,
    forcePathStyle: true,
    credentials: getLocalCredentials(),
  });

  console.log("🪣  Setting up local S3 (the local S3 emulator) bucket...");
  console.log(`   Endpoint: ${ENDPOINT}`);
  console.log(`   Bucket:   ${BUCKET}\n`);

  let exists;
  try {
    exists = await bucketExists(client, HeadBucketCommand);
  } catch (err) {
    console.error("❌ Cannot connect to the local S3 emulator at", ENDPOINT);
    console.error("   Make sure Docker is running: docker compose up -d s3\n");
    console.error("   Error:", err.message);
    process.exit(1);
  }

  if (exists) {
    console.log(`  ✓ ${BUCKET} already exists`);
  } else {
    console.log(`  Creating ${BUCKET}...`);
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    console.log(`  ✓ ${BUCKET} created`);
  }

  console.log("\n✅ Local S3 setup complete!");
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
