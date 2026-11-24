#!/usr/bin/env node
/**
 * Setup local DynamoDB tables for development
 * Run this after starting: docker compose up -d dynamodb-local
 *
 * Uses native fetch to avoid AWS SDK credential chain issues on corporate networks
 */

const ENDPOINT = process.env.DYNAMODB_ENDPOINT || "http://127.0.0.1:8001";

async function dynamoRequest(target, body = {}) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.0",
      "X-Amz-Target": `DynamoDB_20120810.${target}`,
      // DynamoDB Local accepts any auth header
      Authorization:
        "AWS4-HMAC-SHA256 Credential=local/20260226/local/dynamodb/aws4_request, SignedHeaders=host, Signature=local",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  // ResourceInUseException means table already exists - that's OK
  if (
    !response.ok &&
    data.__type &&
    !data.__type.includes("ResourceInUseException")
  ) {
    throw new Error(data.Message || data.__type);
  }

  return { ok: response.ok, data };
}

const TABLES = [
  {
    TableName: "isabel-local-conversations",
    KeySchema: [
      { AttributeName: "userId", KeyType: "HASH" },
      { AttributeName: "conversationId", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "userId", AttributeType: "S" },
      { AttributeName: "conversationId", AttributeType: "S" },
      { AttributeName: "updatedAt", AttributeType: "N" },
      { AttributeName: "shareToken", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "userId-updatedAt-index",
        KeySchema: [
          { AttributeName: "userId", KeyType: "HASH" },
          { AttributeName: "updatedAt", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "shareToken-index",
        KeySchema: [{ AttributeName: "shareToken", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: "isabel-local-saved-queries",
    KeySchema: [
      { AttributeName: "userId", KeyType: "HASH" },
      { AttributeName: "queryId", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "userId", AttributeType: "S" },
      { AttributeName: "queryId", AttributeType: "S" },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: "isabel-local-user-profiles",
    KeySchema: [
      { AttributeName: "userId", KeyType: "HASH" },
      { AttributeName: "profileId", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "userId", AttributeType: "S" },
      { AttributeName: "profileId", AttributeType: "S" },
      { AttributeName: "shareToken", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "shareToken-index",
        KeySchema: [{ AttributeName: "shareToken", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
];

async function createTable(tableConfig) {
  const { TableName } = tableConfig;

  console.log(`  Creating ${TableName}...`);
  const { ok } = await dynamoRequest("CreateTable", tableConfig);

  if (ok) {
    console.log(`  ✓ ${TableName} created`);
  } else {
    console.log(`  ✓ ${TableName} already exists`);
  }
}

async function listTables() {
  const { data } = await dynamoRequest("ListTables", {});
  return data.TableNames || [];
}

async function scanTable(tableName) {
  const { data } = await dynamoRequest("Scan", { TableName: tableName });
  return data.Items || [];
}

async function main() {
  console.log("🗄️  Setting up local DynamoDB tables...");
  console.log(`   Endpoint: ${ENDPOINT}\n`);

  try {
    // Test connection
    await listTables();
  } catch (err) {
    console.error("❌ Cannot connect to DynamoDB Local at", ENDPOINT);
    console.error(
      "   Make sure Docker is running: docker compose up -d dynamodb-local\n",
    );
    console.error("   Error:", err.message);
    process.exit(1);
  }

  // Create tables
  for (const tableConfig of TABLES) {
    await createTable(tableConfig);
  }

  // List all tables
  const tables = await listTables();
  console.log("\n✅ Local DynamoDB setup complete!");
  console.log("\nTables:", tables.join(", "));
  console.log("\nTo view data:");
  console.log("  node bin/setup-local-dynamodb.js --scan conversations");
  console.log("  node bin/setup-local-dynamodb.js --scan saved-queries");
}

// Handle --scan flag for debugging
if (process.argv.includes("--scan")) {
  const tableArg = process.argv[process.argv.indexOf("--scan") + 1];
  const tableName =
    tableArg === "conversations"
      ? "isabel-local-conversations"
      : "isabel-local-saved-queries";

  scanTable(tableName)
    .then((items) => {
      console.log(`\n📋 ${tableName} (${items.length} items):\n`);
      items.forEach((item, i) => {
        console.log(`[${i + 1}]`, JSON.stringify(item, null, 2));
      });
    })
    .catch((err) => {
      console.error("Error scanning table:", err.message);
      process.exit(1);
    });
} else {
  main().catch((err) => {
    console.error("Setup failed:", err.message);
    process.exit(1);
  });
}
