import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// Singleton DynamoDB Document Client
let documentClient: DynamoDBDocumentClient | null = null;

/**
 * Check if we're running in local development mode.
 * Uses DynamoDB Local when DYNAMODB_LOCAL=true or NODE_ENV=development with no AWS credentials.
 *
 * Shared across lib/dynamodb — also used by conversation-storage.ts to decide
 * whether to talk to a local S3-compatible store (S3 emulator) instead of AWS S3.
 */
export function isLocalDevelopment(): boolean {
  if (process.env.DYNAMODB_LOCAL === "true") {
    return true;
  }
  // In development, default to local if no explicit AWS region is configured
  if (process.env.NODE_ENV === "development" && !process.env.AWS_REGION) {
    return true;
  }
  return false;
}

/**
 * Returns a singleton DynamoDB Document Client.
 * In local development, connects to DynamoDB Local on port 8000.
 * In production, connects to AWS DynamoDB in us-east-1.
 */
export function getDynamoDBClient(): DynamoDBDocumentClient {
  if (!documentClient) {
    const isLocal = isLocalDevelopment();

    const clientConfig: ConstructorParameters<typeof DynamoDBClient>[0] =
      isLocal
        ? {
            region: "local",
            endpoint: process.env.DYNAMODB_ENDPOINT || "http://localhost:8001",
            credentials: {
              accessKeyId: "local",
              secretAccessKey: "local",
            },
          }
        : {
            region: "us-east-1",
          };

    const client = new DynamoDBClient(clientConfig);

    documentClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        // Convert empty strings to null (DynamoDB doesn't allow empty strings)
        convertEmptyValues: true,
        // Remove undefined values from objects before sending
        removeUndefinedValues: true,
      },
      unmarshallOptions: {
        // Return numbers as native JavaScript numbers
        wrapNumbers: false,
      },
    });
  }

  return documentClient;
}

/**
 * Get table names based on environment.
 * Table naming convention: isabel-{environment}-{table}
 */
export function getTableNames() {
  const environment = process.env.ENVIRONMENT || "local";
  const project = "isabel";

  return {
    conversations: `${project}-${environment}-conversations`,
    savedQueries: `${project}-${environment}-saved-queries`,
    userProfiles: `${project}-${environment}-user-profiles`,
  };
}
