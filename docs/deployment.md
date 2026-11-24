# Deployment

The reference deployment is ECS Fargate behind an Application Load Balancer,
built with the Terraform in [`deploy/aws/`](../deploy/aws/README.md). Any
platform that runs a Node.js container and can supply the environment variables
in [configuration.md](configuration.md) will work; the Terraform is one way to
do it, not a requirement.

## The short version

1. Create the Snowflake objects and agents: [snowflake-setup.md](snowflake-setup.md).
2. Create the Terraform state bucket and the stack: [deploy/aws/README.md](../deploy/aws/README.md).
3. Fill the secrets with `bin/secrets.sh` and check them with `bin/secrets.sh check <environment>`.
4. Register the redirect URI that `terraform output azure_ad_redirect_uri` prints on the Azure AD app registration.
5. Run `bin/deploy.sh <environment>`: it deploys the agents, offers to apply Terraform, builds and pushes the image, and rolls the service.

## Scripts

| Script                | Purpose                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `bin/secrets.sh`      | Set, show and check the Secrets Manager secrets.                               |
| `bin/deploy-agent.sh` | Create or replace the Cortex agents from `examples/agent.json`.                |
| `bin/docker-build.sh` | Build the image and push it to ECR, tagged with the environment and a version. |
| `bin/deploy-ecs.sh`   | Force a new ECS deployment of the current image.                               |
| `bin/deploy.sh`       | All of the above in order.                                                     |
| `bin/quick-deploy.sh` | Image and ECS only, when infrastructure and agents have not changed.           |

They read `AWS_PROFILE`, `AWS_REGION` and `SECRETS_PREFIX` from the environment.

## The image

The Dockerfile builds Next.js standalone output and runs `node server.js` on
port 3000 as a non-root user. `/api/health` is the health check. Everything
environment-specific arrives as environment variables at run time, so one image
serves every environment.

## Running somewhere other than AWS

Build the image, then provide the variables from `docs/configuration.md`, set
`NODE_ENV=production`, and put TLS in front of it. You also need DynamoDB (or
change `lib/dynamodb/`) and an S3 bucket for overflow. Do not set `DEV_AUTH` or
`MOCK_SNOWFLAKE`; the server will refuse to start.
