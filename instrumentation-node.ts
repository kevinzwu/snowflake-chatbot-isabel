import { getAppConfig } from "./lib/config/app-config";
import { demoFlagsSetInProduction } from "./lib/demo";

const demoFlags = demoFlagsSetInProduction();
if (demoFlags.length > 0) {
  // These flags disable sign-in or replace Snowflake. Refuse to start rather
  // than run a production server with either of them on.
  console.error(
    `Refusing to start: ${demoFlags.join(", ")} must not be set when NODE_ENV is production.`,
  );
  process.exit(1);
}

try {
  getAppConfig();
} catch (error) {
  // Next.js would log this and keep serving 500s; exit so the ECS task stops
  // immediately with the missing keys in its log.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
