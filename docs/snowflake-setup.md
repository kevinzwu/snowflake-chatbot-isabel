# Snowflake setup

Isabel talks to Snowflake [Cortex Agents](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents).
This repo ships a small synthetic dataset and three agents so you can try it
without your own data. A free trial account is enough to start; trial accounts
cap Cortex usage at a few credits, so expect to run out if you test heavily.

## What you get

`examples/sql/` and `examples/` create, in database `ISABEL_SAMPLE`, schema `SECURITY`:

| Object                                       | Purpose                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `TEAMS`, `APPLICATIONS`                      | 12 teams and 40 applications.                                                       |
| `VULNERABILITY_CATALOG`                      | 150 CVE-style entries with title, summary, threat and solution text.                |
| `HOST_VULNERABILITIES`, `CODE_FINDINGS`      | 2,000 host findings and 800 code findings, generated deterministically.             |
| `VULNERABILITY_CATALOG_SEARCH`               | Cortex Search service over the catalog text.                                        |
| `MODELS` stage + `semantic_model.yaml`       | Semantic model for Cortex Analyst (5 tables, relationships, verified queries).      |
| `ISABEL`, `ISABEL_OPUS`, `ISABEL_HAIKU`      | Agents: one Analyst tool and one Search tool, on three orchestration models.        |
| `ISABEL_WH`, `ISABEL_APP_ROLE`, `ISABEL_APP` | Warehouse, a least-privilege role, and a key-pair service user the app signs in as. |

All data is invented. Hostnames use `example.com` and IPs use the documentation ranges.

## 1. Make a key pair

```bash
mkdir -p .key
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out .key/rsa_key.p8
openssl rsa -in .key/rsa_key.p8 -pubout -out .key/rsa_key.pub
```

`.key/` is gitignored. Use `-v2 aes256` instead of `-nocrypt` for an encrypted key
and set `SNOWFLAKE_RSA_PASSPHRASE`.

## 2. Create the objects

Run the four files in order in a Snowsight worksheet or with SnowSQL, as
`ACCOUNTADMIN` (or a role that can create users, roles and warehouses):

1. `examples/sql/01_setup.sql`. First replace `<RSA_PUBLIC_KEY>` with the body of
   `rsa_key.pub`: the base64 lines between the BEGIN and END markers, joined, without the dashes.
2. `examples/sql/02_tables.sql`
3. `examples/sql/03_data.sql`
4. `examples/sql/04_search.sql`

Then upload `examples/semantic_model.yaml` to the stage
`@ISABEL_SAMPLE.SECURITY.MODELS` (Snowsight: Data, Databases, the stage, `+ Files`; or
`PUT file://examples/semantic_model.yaml @ISABEL_SAMPLE.SECURITY.MODELS AUTO_COMPRESS=FALSE OVERWRITE=TRUE`).

## 3. Create the agents

`examples/agent.json` is the agent specification. Create each agent from it with
`CREATE OR REPLACE AGENT ... FROM SPECIFICATION $$<json>$$`, or run
`bin/deploy-agent.sh <environment>`, which reads the same configuration the app
uses from Secrets Manager (see [configuration.md](configuration.md)) and
creates `AGENT_NAME`, `OPUS_AGENT_NAME` and `HAIKU_AGENT_NAME` with the right
models and your warehouse, stage and search service substituted in.

Grant the app role usage on the agents:

```sql
GRANT USAGE ON AGENT ISABEL_SAMPLE.SECURITY.ISABEL TO ROLE ISABEL_APP_ROLE;
```

Repeat for `ISABEL_OPUS` and `ISABEL_HAIKU` if you use them.

## 4. Point the app at it

In `.env.local` (copy `.env.example`; the sample values are already filled in):

```
SNOWFLAKE_URL=https://<your-account>.snowflakecomputing.com
SNOWFLAKE_ACCOUNT=<ORGANIZATION>-<ACCOUNT>
SNOWFLAKE_USER=ISABEL_APP
SNOWFLAKE_RSA_KEY_PATH=.key/rsa_key.p8
```

Then ask: "How many open host vulnerabilities are there by severity?" With the
shipped data the answer is 1,519 open: Critical 605, High 538, Medium 220, Low 156.

## Network policies

If your account restricts which networks can connect, allow the machine that
runs the app (or its NAT egress IP) for the `ISABEL_APP` user. A `Network policy
is required` or `IP not allowed` error on the first call means this.

## Using your own data

Replace the tables and `semantic_model.yaml` with yours, keep the structure
(tables, dimensions with `expr`, relationships, verified queries), and update
the agent's instructions in `examples/agent.json`. Give `ISABEL_APP_ROLE`
`SELECT` on your tables only. The app never needs write access to data.
