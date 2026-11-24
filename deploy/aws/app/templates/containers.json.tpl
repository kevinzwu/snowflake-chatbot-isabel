[
  {
    "name": "nextjs",
    "image": "${image_uri}",
    "cpu": ${container_cpu},
    "memory": ${container_memory},
    "memoryReservation": ${container_memory_soft_limit},
    "networkMode": "awsvpc",
    "essential": true,
    "command": ["node", "server.js"],
    "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/${log_group}",
          "awslogs-region": "${aws_region}",
          "awslogs-stream-prefix": "default"
        }
    },
    "environment": [
      {"name": "NODE_ENV", "value": "production"},
      {"name": "ENVIRONMENT", "value": "${environment}"},
      {"name": "PORT", "value": "3000"},
      {"name": "AWS_REGION", "value": "${aws_region}"},
      {"name": "NEXTAUTH_URL", "value": "${app_url}"},
      {"name": "CONVERSATION_S3_BUCKET", "value": "${conversation_s3_bucket}"}
    ],
    "secrets": [
%{ for key in ["SNOWFLAKE_URL", "SNOWFLAKE_DATABASE", "SNOWFLAKE_SCHEMA", "SNOWFLAKE_WAREHOUSE", "AGENT_NAME", "OPUS_AGENT_NAME", "HAIKU_AGENT_NAME", "SEMANTIC_MODEL_PATH", "SEARCH_SERVICE_PATH", "SUGGESTED_QUERIES", "SUPPORT_URL", "MIP_LABEL_ID", "MIP_TENANT_ID", "MIP_LABEL_NAME"] ~}
      {
        "name": "${key}",
        "valueFrom": "${secret_arns["app-config"]}:${key}::"
      },
%{ endfor ~}
      {
        "name": "SNOWFLAKE_ACCOUNT",
        "valueFrom": "${secret_arns["snowflake-account"]}"
      },
      {
        "name": "SNOWFLAKE_USER",
        "valueFrom": "${secret_arns["snowflake-user"]}"
      },
      {
        "name": "SNOWFLAKE_RSA_KEY",
        "valueFrom": "${secret_arns["rsa-key"]}"
      },
      {
        "name": "SNOWFLAKE_RSA_PASSPHRASE",
        "valueFrom": "${secret_arns["snowflake-rsa-passphrase"]}"
      },
      {
        "name": "NEXTAUTH_SECRET",
        "valueFrom": "${secret_arns["nextauth-secret"]}"
      },
      {
        "name": "AZURE_AD_CLIENT_ID",
        "valueFrom": "${secret_arns["azure-ad-client-id"]}"
      },
      {
        "name": "AZURE_AD_CLIENT_SECRET",
        "valueFrom": "${secret_arns["azure-ad-client-secret"]}"
      },
      {
        "name": "AZURE_AD_TENANT_ID",
        "valueFrom": "${secret_arns["azure-ad-tenant-id"]}"
      },
      {
        "name": "ALLOWED_AZURE_AD_GROUPS",
        "valueFrom": "${secret_arns["allowed-azure-ad-groups"]}"
      },
      {
        "name": "ADMIN_AZURE_AD_GROUPS",
        "valueFrom": "${secret_arns["admin-azure-ad-groups"]}"
      },
      {
        "name": "OAUTH_SERVICE_ACCOUNTS",
        "valueFrom": "${secret_arns["oauth-service-accounts"]}"
      }
    ],
    "portMappings": [
      {
        "containerPort": 3000,
        "hostPort": 3000
      }
    ]
  }
]