import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  APP_CONFIG_SECRET_KEYS,
  AppConfigError,
  getAppConfig,
} from "./app-config";

const root = path.resolve(__dirname, "../..");

describe("app-config secret keys stay in sync", () => {
  it("matches the ECS container template", () => {
    const template = fs.readFileSync(
      path.join(root, "deploy/aws/app/templates/containers.json.tpl"),
      "utf-8",
    );
    const list = template.match(/%\{ for key in (\[[^\]]*\]) ~\}/);
    expect(list).not.toBeNull();
    expect(JSON.parse(list![1]).sort()).toEqual(
      [...APP_CONFIG_SECRET_KEYS].sort(),
    );
  });

  it("matches bin/secrets.sh", () => {
    const script = fs.readFileSync(path.join(root, "bin/secrets.sh"), "utf-8");
    const keys = ["APP_CONFIG_REQUIRED", "APP_CONFIG_OPTIONAL"].flatMap(
      (name) => {
        const block = script.match(new RegExp(`${name}=\\(([^)]*)\\)`));
        expect(block).not.toBeNull();
        return block![1].split(/\s+/).filter(Boolean);
      },
    );
    expect(keys.sort()).toEqual([...APP_CONFIG_SECRET_KEYS].sort());
  });
});

const validEnv = {
  SNOWFLAKE_URL: "https://acct.snowflakecomputing.com/",
  SNOWFLAKE_DATABASE: "DB",
  SNOWFLAKE_SCHEMA: "SCH",
  SNOWFLAKE_WAREHOUSE: "WH",
  AGENT_NAME: "AGENT",
  SEMANTIC_MODEL_PATH: "@DB.SCH.STAGE/model.yml",
  SEARCH_SERVICE_PATH: "DB.SCH.SEARCH",
  NEXTAUTH_URL: "https://app.example.com",
};

function errorOf(env: Record<string, string | undefined>): AppConfigError {
  try {
    getAppConfig(env);
  } catch (error) {
    if (error instanceof AppConfigError) return error;
    throw error;
  }
  throw new Error("expected getAppConfig to throw");
}

describe("getAppConfig", () => {
  it("maps a valid environment", () => {
    const config = getAppConfig(validEnv);
    expect(config.snowflakeUrl).toBe("https://acct.snowflakecomputing.com");
    expect(config.database).toBe("DB");
    expect(config.agentNames).toEqual({
      sonnet: "AGENT",
      opus: "",
      haiku: "",
    });
    expect(config.baseUrl).toBe("https://app.example.com");
    expect(config.suggestedQueries).toEqual([]);
    expect(config.mipLabel.enabled).toBe(false);
  });

  it("lists every missing required key", () => {
    const error = errorOf({});
    const keys = error.issues.map((issue) => issue.split(" ")[0]);
    expect(keys).toEqual(
      expect.arrayContaining([
        "SNOWFLAKE_URL",
        "SNOWFLAKE_DATABASE",
        "SNOWFLAKE_SCHEMA",
        "SNOWFLAKE_WAREHOUSE",
        "AGENT_NAME",
        "SEMANTIC_MODEL_PATH",
        "SEARCH_SERVICE_PATH",
        "NEXTAUTH_URL",
      ]),
    );
    expect(error.issues).toContain("SNOWFLAKE_DATABASE is required");
  });

  it("rejects a blank required key", () => {
    const error = errorOf({ ...validEnv, SNOWFLAKE_SCHEMA: "  " });
    expect(error.message).toContain("SNOWFLAKE_SCHEMA");
  });

  it("rejects a relative Snowflake URL", () => {
    const error = errorOf({ ...validEnv, SNOWFLAKE_URL: "/api/mock" });
    expect(error.message).toContain("SNOWFLAKE_URL");
  });

  it("parses suggested queries", () => {
    const config = getAppConfig({
      ...validEnv,
      SUGGESTED_QUERIES: '["a","b"]',
    });
    expect(config.suggestedQueries).toEqual(["a", "b"]);
  });

  it.each(["not json", '{"a":1}', "[1,2]"])(
    "rejects invalid suggested queries %s",
    (value) => {
      const error = errorOf({ ...validEnv, SUGGESTED_QUERIES: value });
      expect(error.message).toContain(
        "SUGGESTED_QUERIES must be a JSON array of strings",
      );
    },
  );

  it("accepts empty optional keys", () => {
    const config = getAppConfig({
      ...validEnv,
      OPUS_AGENT_NAME: "",
      MIP_LABEL_ID: "",
      SUGGESTED_QUERIES: "",
    });
    expect(config.agentNames.opus).toBe("");
    expect(config.mipLabel.enabled).toBe(false);
    expect(config.suggestedQueries).toEqual([]);
  });

  it("enables MIP labels when label and tenant are set", () => {
    const config = getAppConfig({
      ...validEnv,
      MIP_LABEL_ID: "label",
      MIP_TENANT_ID: "tenant",
    });
    expect(config.mipLabel).toEqual({
      labelId: "label",
      siteId: "tenant",
      labelName: "Confidential",
      enabled: true,
    });
  });

  it("does not expose authorization groups", () => {
    const config = getAppConfig({
      ...validEnv,
      ALLOWED_AZURE_AD_GROUPS: "g1",
      ADMIN_AZURE_AD_GROUPS: "g2",
    });
    expect(JSON.stringify(config)).not.toMatch(/g1|g2/);
  });
});
