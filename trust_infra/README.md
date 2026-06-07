# trust_infra

Terraform module that provisions the Skylars Global Trust Rail staging and production infrastructure.

## What it creates

| Resource | Purpose |
|----------|---------|
| **KMS RSA-4096 key** | Signs every Trust Receipt. Public key exported to SSM. |
| **S3 bucket (Object Lock, COMPLIANCE mode)** | WORM storage for receipts — mathematically provable history. |
| **ECS cluster + task definition** | Nitro-capable cluster running the compliance gateway container. |
| **Lambda: `rekor-submit`** | Fires on every `s3:ObjectCreated:Put`, submits the receipt to Sigstore Rekor, tags the object with the returned log UUID. |
| **SSM parameters** | `pinned_pcr0` and `pubkey_pem` — runtime trust anchors injected into the gateway as secrets. |
| **CloudWatch log groups** | 365-day retention for gateway and Lambda. |
| **IAM roles + policies** | Least-privilege. Gateway can sign + write S3. Lambda can read S3 + tag + get KMS public key. |

## Prerequisites

- Terraform ≥ 1.6
- AWS provider ≥ 5.0
- An existing VPC with private subnets (NAT gateway required for Lambda → Rekor HTTPS egress)
- An ECR image of the compliance gateway pushed to your account

## Deploy to staging

```bash
cd trust_infra

# 1. Create a tfvars file (never commit secrets)
cat > staging.tfvars <<EOF
aws_region         = "us-east-1"
environment        = "staging"
ecr_image_uri      = "123456789.dkr.ecr.us-east-1.amazonaws.com/skylars-gateway:latest"
vpc_id             = "vpc-xxxxxxxx"
private_subnet_ids = ["subnet-aaaa", "subnet-bbbb"]
EOF

# 2. Init and apply
terraform init
terraform apply -var-file=staging.tfvars

# 3. Export public key PEM → SSM (run the command printed by pubkey_pem_export_cmd output)
terraform output -raw pubkey_pem_export_cmd | bash

# 4. Boot a Nitro-enabled EC2 instance and pin PCR0 (run the command printed by pinned_pcr0_cmd output)
#    For staging with FARGATE, this step is skipped — PCR0 stays all-zeros (warning mode).
terraform output -raw pinned_pcr0_cmd

# 5. Verify Object Lock is active
aws s3api get-object-lock-configuration --bucket $(terraform output -raw receipt_bucket)
# Expected: Mode=COMPLIANCE, Days=2555
```

## Verify a receipt end-to-end

```bash
# Write a test receipt (triggers Rekor Lambda automatically)
aws s3 cp test_receipt.json \
  s3://$(terraform output -raw receipt_bucket)/2026/06/15/test_receipt.json

# Check the Rekor tag was applied
aws s3api get-object-tagging \
  --bucket $(terraform output -raw receipt_bucket) \
  --key 2026/06/15/test_receipt.json

# Run the customer verifier
curl -s https://api.skylarsglobal.com/v1/receipt/req_abc | \
  python3 public_verifier.py verify --receipt -
```

## Promote to prod

Change `environment = "prod"` in your tfvars. Object Lock `force_destroy` is disabled for prod — receipts cannot be deleted.

## Trust anchor update procedure (PCR0 rotation)

1. Deploy new enclave image.
2. Run `pinned_pcr0_cmd` output to update SSM.
3. Redeploy gateway (ECS rolling update picks up new SSM secret).
4. Verify: `python3 public_verifier.py verify --receipt <new_receipt.json>`.
