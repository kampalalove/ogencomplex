variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (staging | prod)."
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be 'staging' or 'prod'."
  }
}

variable "name_prefix" {
  description = "Short prefix applied to every resource name."
  type        = string
  default     = "skylars"
}

variable "receipt_bucket_name" {
  description = "S3 bucket name for WORM Trust Receipt storage. Must be globally unique."
  type        = string
  default     = ""
}

variable "ecr_image_uri" {
  description = "ECR image URI for the compliance gateway container (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/skylars-gateway:latest)."
  type        = string
}

variable "vpc_id" {
  description = "VPC in which ECS tasks and Lambda run."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for ECS tasks and Lambda."
  type        = list(string)
}

variable "rekor_base_url" {
  description = "Sigstore Rekor transparency log base URL."
  type        = string
  default     = "https://rekor.sigstore.dev"
}

variable "worm_retention_days" {
  description = "S3 Object Lock retention period for Trust Receipts (days)."
  type        = number
  default     = 2555 # 7 years — typical healthcare audit requirement
}

variable "log_retention_days" {
  description = "CloudWatch log retention (days)."
  type        = number
  default     = 365
}

variable "gateway_cpu" {
  description = "ECS task CPU units for the compliance gateway."
  type        = number
  default     = 512
}

variable "gateway_memory" {
  description = "ECS task memory (MiB) for the compliance gateway."
  type        = number
  default     = 1024
}
