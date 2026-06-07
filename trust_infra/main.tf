terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "skylars-trust-rail"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ---------------------------------------------------------------------------
# Locals
# ---------------------------------------------------------------------------
locals {
  prefix      = "${var.name_prefix}-${var.environment}"
  bucket_name = var.receipt_bucket_name != "" ? var.receipt_bucket_name : "${local.prefix}-trust-receipts"
}

# ---------------------------------------------------------------------------
# KMS — asymmetric signing key (RSA-4096 PSS)
# Used to sign Trust Receipts; public key exported to SSM and to the gateway.
# ---------------------------------------------------------------------------
resource "aws_kms_key" "receipt_signing" {
  description              = "${local.prefix} Trust Receipt signing key (RSA-4096-PSS)"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "RSA_4096"
  enable_key_rotation      = false # asymmetric keys cannot auto-rotate; rotate manually

  deletion_window_in_days = 30

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "KeyAdmins"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "GatewaySign"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.gateway_task.arn
        }
        Action   = ["kms:Sign", "kms:GetPublicKey"]
        Resource = "*"
      },
      {
        Sid    = "RekorLambdaGetKey"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.rekor_lambda.arn
        }
        Action   = ["kms:GetPublicKey"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_kms_alias" "receipt_signing" {
  name          = "alias/${local.prefix}-receipt-signing"
  target_key_id = aws_kms_key.receipt_signing.key_id
}

# Store the KMS key ARN in SSM so the gateway can reference it at runtime
resource "aws_ssm_parameter" "kms_key_arn" {
  name  = "/${local.prefix}/kms/receipt-signing-key-arn"
  type  = "String"
  value = aws_kms_key.receipt_signing.arn
}

# ---------------------------------------------------------------------------
# S3 — WORM receipt bucket (Object Lock, Compliance mode)
# Once a receipt is written it cannot be deleted or overwritten for
# worm_retention_days. Proves history is not deletable.
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "receipts" {
  bucket = local.bucket_name

  # Block all public access
  force_destroy = var.environment == "staging" # allow teardown in staging only
}

resource "aws_s3_bucket_public_access_block" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.worm_retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.receipts]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.receipt_signing.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_logging" "receipts" {
  bucket        = aws_s3_bucket.receipts.id
  target_bucket = aws_s3_bucket.receipts.id
  target_prefix = "access-logs/"
}

# ---------------------------------------------------------------------------
# IAM — ECS task execution role
# ---------------------------------------------------------------------------
data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "gateway_task" {
  name               = "${local.prefix}-gateway-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "gateway_ecr_exec" {
  role       = aws_iam_role.gateway_task.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "gateway_task_policy" {
  # KMS: sign receipts + get public key
  statement {
    effect  = "Allow"
    actions = ["kms:Sign", "kms:GetPublicKey"]
    resources = [aws_kms_key.receipt_signing.arn]
  }

  # S3: write receipts (no delete allowed — Object Lock enforces WORM)
  statement {
    effect  = "Allow"
    actions = ["s3:PutObject", "s3:GetObject"]
    resources = [
      aws_s3_bucket.receipts.arn,
      "${aws_s3_bucket.receipts.arn}/*",
    ]
  }

  # SSM: read config at startup
  statement {
    effect  = "Allow"
    actions = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${local.prefix}/*"
    ]
  }

  # CloudWatch Logs
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.gateway.arn}:*"]
  }
}

resource "aws_iam_role_policy" "gateway_task" {
  name   = "${local.prefix}-gateway-task-policy"
  role   = aws_iam_role.gateway_task.id
  policy = data.aws_iam_policy_document.gateway_task_policy.json
}

# ---------------------------------------------------------------------------
# CloudWatch Log Groups
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/ecs/${local.prefix}/gateway"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "rekor_lambda" {
  name              = "/aws/lambda/${local.prefix}-rekor-submit"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------------------
# ECS Cluster (Nitro-capable; use c6a / c6i / c5n instances for enclave support)
# ---------------------------------------------------------------------------
resource "aws_ecs_cluster" "trust_rail" {
  name = "${local.prefix}-trust-rail"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "trust_rail" {
  cluster_name       = aws_ecs_cluster.trust_rail.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# ---------------------------------------------------------------------------
# ECS Task Definition — compliance gateway
#
# Production Nitro note: Nitro Enclaves require an EC2 launch type with an
# instance that has NitroEnclave=true.  When that instance runs, add:
#   linuxParameters = { initProcessEnabled = true }
#   and an "enclave" container sidecar with the .eif image.
#
# This task definition targets FARGATE for staging. Switch launch_type to
# EC2 + nitro-enabled instance for production PCR0 pinning.
# ---------------------------------------------------------------------------
resource "aws_ecs_task_definition" "gateway" {
  family                   = "${local.prefix}-gateway"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.gateway_cpu
  memory                   = var.gateway_memory
  execution_role_arn       = aws_iam_role.gateway_task.arn
  task_role_arn            = aws_iam_role.gateway_task.arn

  container_definitions = jsonencode([
    {
      name      = "gateway"
      image     = var.ecr_image_uri
      essential = true

      portMappings = [{ containerPort = 8000, protocol = "tcp" }]

      environment = [
        { name = "API_BASE_URL", value = "https://api.skylarsglobal.com" },
        { name = "KMS_KEY_ARN",  value = aws_kms_key.receipt_signing.arn },
        { name = "RECEIPT_BUCKET", value = aws_s3_bucket.receipts.id },
        { name = "REKOR_BASE_URL", value = var.rekor_base_url },
        # PINNED_PCR0 and SKYLARS_PUBKEY_PEM are injected at startup by
        # the init container (see pinned_pcr0_cmd output) or via SSM.
      ]

      secrets = [
        {
          name      = "PINNED_PCR0"
          valueFrom = aws_ssm_parameter.pinned_pcr0.arn
        },
        {
          name      = "SKYLARS_PUBKEY_PEM"
          valueFrom = aws_ssm_parameter.pubkey_pem.arn
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.gateway.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "gateway"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8000/healthz || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }
    }
  ])
}

# ---------------------------------------------------------------------------
# SSM Parameters — PCR0 pin and public key PEM
# Populated manually after first enclave boot; see outputs for helper command.
# ---------------------------------------------------------------------------
resource "aws_ssm_parameter" "pinned_pcr0" {
  name        = "/${local.prefix}/enclave/pinned-pcr0"
  type        = "String"
  value       = "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" # placeholder — 96 zeros
  description = "Nitro Enclave PCR0 measurement. Update with real value after first enclave boot."

  lifecycle {
    ignore_changes = [value] # do not overwrite with placeholder on re-apply
  }
}

resource "aws_ssm_parameter" "pubkey_pem" {
  name        = "/${local.prefix}/kms/receipt-signing-pubkey-pem"
  type        = "String"
  value       = "PLACEHOLDER"
  description = "PEM public key exported from KMS receipt signing key. Update after first apply."

  lifecycle {
    ignore_changes = [value] # populated by the post-apply script
  }
}

# ---------------------------------------------------------------------------
# IAM — Lambda execution role (Rekor submit)
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rekor_lambda" {
  name               = "${local.prefix}-rekor-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "rekor_lambda_basic" {
  role       = aws_iam_role.rekor_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "rekor_lambda_policy" {
  # Read new receipts from S3
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.receipts.arn}/*"]
  }

  # Write Rekor log ID back to the receipt metadata tag
  statement {
    effect    = "Allow"
    actions   = ["s3:PutObjectTagging"]
    resources = ["${aws_s3_bucket.receipts.arn}/*"]
  }

  # KMS: get public key to include in Rekor entry
  statement {
    effect    = "Allow"
    actions   = ["kms:GetPublicKey"]
    resources = [aws_kms_key.receipt_signing.arn]
  }

  # CloudWatch Logs
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.rekor_lambda.arn}:*"]
  }
}

resource "aws_iam_role_policy" "rekor_lambda" {
  name   = "${local.prefix}-rekor-lambda-policy"
  role   = aws_iam_role.rekor_lambda.id
  policy = data.aws_iam_policy_document.rekor_lambda_policy.json
}

# ---------------------------------------------------------------------------
# Lambda — Rekor submit
#
# This function fires on every new receipt written to S3 and submits the
# Merkle root + signature to Sigstore Rekor, then tags the S3 object with
# the returned log entry UUID.
#
# The inline source is a minimal bootstrap; replace with a packaged .zip in
# production (see README.md deploy step 5).
# ---------------------------------------------------------------------------
data "archive_file" "rekor_lambda" {
  type        = "zip"
  output_path = "${path.module}/.terraform/rekor_lambda.zip"

  source {
    content  = <<-PYTHON
      """
      rekor_submit.py — Rekor transparency-log submission Lambda.

      Triggered by S3 PutObject events on the receipt bucket.
      Submits the receipt Merkle root + RSA-PSS signature to Sigstore Rekor
      and tags the S3 object with the returned log entry UUID.

      Environment variables (set by Terraform):
        REKOR_BASE_URL  — Sigstore Rekor base URL
        KMS_KEY_ARN     — KMS key ARN (to export public key for the Rekor entry)
      """
      import json
      import os
      import urllib.error
      import urllib.request

      import boto3

      REKOR_BASE_URL = os.environ.get("REKOR_BASE_URL", "https://rekor.sigstore.dev")
      KMS_KEY_ARN    = os.environ["KMS_KEY_ARN"]

      s3  = boto3.client("s3")
      kms = boto3.client("kms")


      def _get_public_key_pem() -> str:
          resp = kms.get_public_key(KeyId=KMS_KEY_ARN)
          import base64
          der = resp["PublicKey"]
          b64 = base64.b64encode(der).decode()
          pem_body = "\n".join(b64[i:i+64] for i in range(0, len(b64), 64))
          return f"-----BEGIN PUBLIC KEY-----\n{pem_body}\n-----END PUBLIC KEY-----\n"


      def _submit_to_rekor(receipt: dict) -> str:
          """Submit a hashedrekord entry to Rekor; return the log entry UUID."""
          import base64, hashlib
          payload_hash = receipt.get("payload_hash", "")
          signature_hex = receipt.get("signature", "")
          sig_b64 = base64.b64encode(bytes.fromhex(signature_hex)).decode()
          pubkey_pem = _get_public_key_pem()
          pubkey_b64 = base64.b64encode(pubkey_pem.encode()).decode()

          entry = {
              "apiVersion": "0.0.1",
              "kind": "hashedrekord",
              "spec": {
                  "data": {
                      "hash": {
                          "algorithm": "sha256",
                          "value": payload_hash,
                      }
                  },
                  "signature": {
                      "content": sig_b64,
                      "publicKey": {"content": pubkey_b64},
                  },
              },
          }
          body = json.dumps(entry).encode()
          req = urllib.request.Request(
              f"{REKOR_BASE_URL}/api/v1/log/entries",
              data=body,
              headers={"Content-Type": "application/json", "Accept": "application/json"},
              method="POST",
          )
          try:
              with urllib.request.urlopen(req, timeout=15) as resp:
                  data = json.loads(resp.read())
              return list(data.keys())[0]  # entry UUID is the top-level key
          except Exception as exc:
              print(f"WARN: Rekor submission failed: {exc}. Continuing without log ID.")
              return ""


      def handler(event, context):
          for record in event.get("Records", []):
              bucket = record["s3"]["bucket"]["name"]
              key    = record["s3"]["object"]["key"]

              obj  = s3.get_object(Bucket=bucket, Key=key)
              receipt = json.loads(obj["Body"].read())

              log_id = _submit_to_rekor(receipt)
              if log_id:
                  s3.put_object_tagging(
                      Bucket=bucket,
                      Key=key,
                      Tagging={"TagSet": [{"Key": "rekor_log_id", "Value": log_id}]},
                  )
                  print(f"Rekor entry created: {log_id} for s3://{bucket}/{key}")
              else:
                  print(f"WARN: No Rekor log ID for s3://{bucket}/{key} — receipt stored but not time-stamped")

          return {"status": "ok"}
    PYTHON
    filename = "rekor_submit.py"
  }
}

resource "aws_lambda_function" "rekor_submit" {
  function_name    = "${local.prefix}-rekor-submit"
  role             = aws_iam_role.rekor_lambda.arn
  filename         = data.archive_file.rekor_lambda.output_path
  source_code_hash = data.archive_file.rekor_lambda.output_base64sha256
  handler          = "rekor_submit.handler"
  runtime          = "python3.11"
  timeout          = 30

  environment {
    variables = {
      REKOR_BASE_URL = var.rekor_base_url
      KMS_KEY_ARN    = aws_kms_key.receipt_signing.arn
    }
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda_rekor.id]
  }

  depends_on = [aws_cloudwatch_log_group.rekor_lambda]
}

# S3 → Lambda trigger: fire on every new receipt object
resource "aws_s3_bucket_notification" "rekor_trigger" {
  bucket = aws_s3_bucket.receipts.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.rekor_submit.arn
    events              = ["s3:ObjectCreated:Put"]
    filter_prefix       = ""
    filter_suffix       = ".json"
  }

  depends_on = [aws_lambda_permission.s3_invoke_rekor]
}

resource "aws_lambda_permission" "s3_invoke_rekor" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rekor_submit.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.receipts.arn
}

# ---------------------------------------------------------------------------
# Security Groups
# ---------------------------------------------------------------------------
resource "aws_security_group" "lambda_rekor" {
  name        = "${local.prefix}-lambda-rekor-sg"
  description = "Allows the Rekor Lambda to reach Sigstore (HTTPS egress only)."
  vpc_id      = var.vpc_id

  egress {
    description = "HTTPS egress to Sigstore Rekor"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
