package policy

import (
"encoding/json"
"os"
"path/filepath"

"github.com/kampalalove/ogencomplex/models"
)

type Enforcer struct {
BasePath   string
PolicyRail *models.PolicyRail
Canonical  *models.CanonicalPayload
}

func NewEnforcer(basePath string) (*Enforcer, error) {
e := &Enforcer{BasePath: basePath}

policyPath := filepath.Join(basePath, "policy_rail_v1.json")
if data, err := os.ReadFile(policyPath); err == nil {
var rail models.PolicyRail
if err := json.Unmarshal(data, &rail); err == nil {
e.PolicyRail = &rail
}
}

canonicalPath := filepath.Join(basePath, "canonical_payload.json")
if data, err := os.ReadFile(canonicalPath); err == nil {
var canon models.CanonicalPayload
if err := json.Unmarshal(data, &canon); err == nil {
e.Canonical = &canon
}
}

return e, nil
}

func (e *Enforcer) Evaluate(payload models.IngestPayload) (bool, string) {
if e.PolicyRail == nil {
return false, "No policy rail loaded - fail-closed default"
}

for _, rule := range e.PolicyRail.Rules {
if rule.Condition == "true" {
if rule.Effect == "DENY" {
return false, rule.ID
}
if rule.Effect == "ALLOW" {
return true, rule.ID
}
}
}

return false, "fail_closed_default"
}

func (e *Enforcer) GetCanonical() *models.CanonicalPayload {
return e.Canonical
}