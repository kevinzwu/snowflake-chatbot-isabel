# Deploying Isabel to AWS

Terraform that runs Isabel on ECS Fargate behind an Application Load Balancer.
It is self-contained: given an AWS account and a region it creates everything,
and every piece you may already own (VPC, domain, IAM boundary) is an optional
override.

| Root         | Creates                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bootstrap/` | The S3 bucket for Terraform state. Run once per account.                                                                                                                             |
| `app/`       | VPC (optional), load balancer, ECS cluster and service, ECR repository, DynamoDB tables, conversation S3 bucket, Secrets Manager secret containers, IAM roles, optional ACM and DNS. |

Cost while running is roughly an ALB, one 1 vCPU / 2 GB Fargate task and
small DynamoDB and S3 usage. There is no NAT gateway.

## Prerequisites

- Terraform 1.10 or newer, AWS CLI, Docker, `jq`
- AWS credentials in your environment: `export AWS_PROFILE=<profile>` (the
  Terraform provider has no profile setting of its own)
- A Snowflake account with the sample data or your own (see
  [docs/snowflake-setup.md](../../docs/snowflake-setup.md))
- An Azure AD app registration for sign-in

## 1. State bucket

```bash
cd deploy/aws/bootstrap
terraform init
terraform apply -var region=us-east-1
terraform output state_bucket
```

## 2. Configure the app root

```bash
cd ../app
cp backend.hcl.example backend.hcl      # set bucket (from step 1), key and region
cp example.tfvars staging.tfvars        # set region; everything else is optional
terraform init -backend-config=backend.hcl
terraform plan -var-file=staging.tfvars
```

Both copied files are gitignored. Use a different `key` in `backend.hcl` and a
different `environment` in the tfvars for each environment.

### Options

| Variable                                            | Effect                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `name`, `environment`                               | Resources are `<name>-<environment>`; secrets live under `<name>/<environment>/`.                                      |
| `domain_name` + `route53_zone_id`                   | DNS-validated ACM certificate, HTTPS listener and an alias record. Without them the ALB serves plain HTTP (demo only). |
| `vpc_id`, `public_subnet_ids`, `private_subnet_ids` | Use an existing VPC. Leave unset to create one. Created subnets are public and tasks get public IPs (no NAT).          |
| `internal`                                          | Make the load balancer reachable only inside the VPC.                                                                  |
| `allowed_ingress_cidrs`                             | Restrict who can reach the load balancer. Default is the whole internet.                                               |
| `permissions_boundary_arn`, `iam_role_path`         | Attach a boundary and path to the IAM roles. None by default.                                                          |

## 3. Create the infrastructure

```bash
terraform apply -var-file=staging.tfvars
```

This creates empty secret containers and an empty ECR repository. The ECS
service cannot start tasks until the secrets are filled and an image is pushed,
so it reports failing deployments until steps 4 and 5 are done. That is expected.

## 4. Fill the secrets

Terraform creates the secret names and never sees their values, so nothing
sensitive is in Terraform state. Set them with `bin/secrets.sh`, which reads
values from stdin:

```bash
export AWS_PROFILE=<profile> AWS_REGION=<region> SECRETS_PREFIX=isabel   # SECRETS_PREFIX must equal var.name
bin/secrets.sh set staging snowflake-account < value.txt
bin/secrets.sh set staging app-config < app-config.staging.json
bin/secrets.sh check staging        # all 11 credential secrets and app-config keys
```

Register `terraform output azure_ad_redirect_uri` as a redirect URI on the
Azure AD app registration.

## 5. Build, push and deploy

```bash
bin/deploy.sh staging
```

This deploys the Cortex agent, offers to apply Terraform, builds the image,
pushes it to ECR and rolls the ECS service.

## Teardown

```bash
terraform destroy -var-file=staging.tfvars
```

Secrets are scheduled for deletion after `secret_recovery_window_days`
(default 7; set 0 in the tfvars before destroying for an immediate delete). The
state bucket in `bootstrap/` has `prevent_destroy`; empty and delete it by hand.

## Checks

CI runs `terraform fmt -check`, `terraform validate`, `tflint`, `trivy config`
and `checkov` on every change under `deploy/aws/`. It never runs `plan` or
`apply`; those need credentials and are always a person's decision.

```bash
terraform fmt -check -recursive deploy/aws
tflint --chdir deploy/aws/app
trivy config deploy/aws
checkov -d deploy/aws
```
