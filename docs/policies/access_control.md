# Access Control Policy

## Principle
Least privilege. No shared accounts.

## Roles
- **Operator**: Read‑only dashboard access
- **Engineer**: Modify playbooks, view telemetry
- **Admin**: Change edge configuration, manage users

## Authentication
- MFA required for all interactive access
- Personal Access Tokens (GitHub) for automation

## Reviews
- Quarterly access review; log maintained in `/security/access_reviews/`
- Termination: immediate revocation
