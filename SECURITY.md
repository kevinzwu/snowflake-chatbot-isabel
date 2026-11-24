# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately, in either of these ways:

- Use GitHub's private vulnerability reporting: the **Report a vulnerability**
  button on the repository's **Security** tab.
- Email kevinzw0622@gmail.com.

Include what you found, how to reproduce it, and the version or commit you tested.
You can expect an acknowledgement within 5 business days. We will keep you informed
while we investigate, and agree a disclosure date with you once a fix is ready.
Please give us a reasonable chance to fix the problem before you publish details.

## Scope

In scope: the code in this repository, including the Terraform in `deploy/aws/`
and the scripts in `bin/`.

Out of scope: Snowflake, Azure AD, AWS and other third-party services; problems
that need a malicious administrator or a stolen secret; and findings from
demo mode (`DEV_AUTH`, `MOCK_SNOWFLAKE`), which is disabled in production builds.

## Supported versions

Only the latest release receives security fixes while the project is on 0.x.

## If you run Isabel

- Keep the Snowflake service user read-only and key-pair only.
- Keep the private key in a secrets manager, never in the image or the repository.
- Set `ALLOWED_AZURE_AD_GROUPS`; with no groups set the app denies everyone.
- Never set `DEV_AUTH` or `MOCK_SNOWFLAKE` in a deployed environment.
