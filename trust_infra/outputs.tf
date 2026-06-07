# ---------------------------------------------------------------------------
# Receipt bucket
# ---------------------------------------------------------------------------
output "receipt_bucket" {
  description = "S3 bucket name for WORM Trust Receipts."
  value       = aws_s3_bucket.receipts.id
}

output "receipt_bucket_arn" {
  description = "ARN of the WORM receipt bucket."
  value       = aws_s3_bucket.receipts.arn
}

# ---------------------------------------------------------------------------
# KMS signing key
# ---------------------------------------------------------------------------
output "kms_key_arn" {
  description = "KMS receipt signing key ARN. Set KMS_KEY_ARN env var on the gateway to this value."
  value       = aws_kms_key.receipt_signing.arn
}

output "kms_key_alias" {
  description = "KMS key alias."
  value       = aws_kms_alias.receipt_signing.name
}

# ---------------------------------------------------------------------------
# PCR0 pin
# ---------------------------------------------------------------------------
output "pinned_pcr0_cmd" {
  description = <<-DESC
    Run this command on the Nitro host after the first enclave boot to get
    the 96-char hex PCR0 measurement and update the SSM parameter:

      aws nitro-enclaves-cli describe-enclave \
        --query 'Measurements.PCR0' --output text | \
      aws ssm put-parameter \
        --name "${aws_ssm_parameter.pinned_pcr0.name}" \
        --value "$(cat)" \
        --type String --overwrite

    Then redeploy the gateway so it picks up the real PCR0 from SSM.
  DESC
  value = join(" ", [
    "aws nitro-enclaves-cli describe-enclave",
    "--query 'Measurements.PCR0' --output text |",
    "aws ssm put-parameter",
    "--name '${aws_ssm_parameter.pinned_pcr0.name}'",
    "--value \"$(cat)\"",
    "--type String --overwrite",
  ])
}

output "pinned_pcr0_ssm_path" {
  description = "SSM parameter path for the pinned PCR0 measurement."
  value       = aws_ssm_parameter.pinned_pcr0.name
}

# ---------------------------------------------------------------------------
# Public key PEM
# ---------------------------------------------------------------------------
output "pubkey_pem_export_cmd" {
  description = <<-DESC
    Run this command once after first apply to export the KMS public key into
    SSM so the gateway can load SKYLARS_PUBKEY_PEM at startup:

      aws kms get-public-key --key-id <kms_key_arn> \
        --query 'PublicKey' --output text | \
      python3 -c "
      import sys, base64, textwrap
      der = base64.b64decode(sys.stdin.read())
      b64 = base64.b64encode(der).decode()
      print('-----BEGIN PUBLIC KEY-----')
      print(textwrap.fill(b64, 64))
      print('-----END PUBLIC KEY-----')
      " | \
      aws ssm put-parameter \
        --name '${aws_ssm_parameter.pubkey_pem.name}' \
        --value "$(cat)" --type String --overwrite
  DESC
  value = aws_ssm_parameter.pubkey_pem.name
}

output "pubkey_pem_ssm_path" {
  description = "SSM parameter path for the receipt signing public key PEM."
  value       = aws_ssm_parameter.pubkey_pem.name
}

# ---------------------------------------------------------------------------
# Rekor Lambda
# ---------------------------------------------------------------------------
output "rekor_lambda_arn" {
  description = "ARN of the Rekor-submit Lambda."
  value       = aws_lambda_function.rekor_submit.arn
}

# ---------------------------------------------------------------------------
# ECS
# ---------------------------------------------------------------------------
output "ecs_cluster_arn" {
  description = "ECS cluster ARN."
  value       = aws_ecs_cluster.trust_rail.arn
}

output "gateway_task_definition_arn" {
  description = "Latest active ECS task definition ARN for the compliance gateway."
  value       = aws_ecs_task_definition.gateway.arn
}
