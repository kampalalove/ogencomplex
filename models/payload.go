package models

type IngestPayload struct {
SystemID       string `json:"system_id"`
Platform       string `json:"platform,omitempty"`
ContextSummary string `json:"context_summary"`
URL            string `json:"url,omitempty"`
ThreadID       string `json:"thread_id,omitempty"`
ResolvedLoops  int    `json:"resolved_loops,omitempty"`
}

type SystemProfile struct {
SystemID       string         `json:"system_id"`
Name           string         `json:"name"`
Version        string         `json:"version"`
Layers         Layers         `json:"layers"`
Topology       Topology       `json:"topology"`
StateTelemetry StateTelemetry `json:"state_telemetry"`
}

type Layers struct {
Authority   Authority   `json:"authority"`
Logic       Logic       `json:"logic"`
Transport   Transport   `json:"transport"`
Telemetry   Telemetry   `json:"telemetry"`
Sovereignty Sovereignty `json:"sovereignty"`
}

type Authority struct {
SourceOfTruth  string   `json:"source_of_truth"`
SchemaDefined  bool     `json:"schema_defined"`
StackType      string   `json:"stack_type"`
ParentSystemID *string  `json:"parent_system_id"`
Children       []string `json:"children"`
}

type Logic struct {
Runtime      string   `json:"runtime"`
Dependencies []string `json:"dependencies"`
EntryPoint   string   `json:"entry_point"`
}

type Transport struct {
DeploymentTarget string  `json:"deployment_target"`
Pipeline         string  `json:"pipeline"`
RepoURL          *string `json:"repo_url"`
}

type Telemetry struct {
HasLogging       bool    `json:"has_logging"`
MonitoringMethod string  `json:"monitoring_method"`
HealthEndpoint   *string `json:"health_endpoint"`
}

type Sovereignty struct {
IsAirGapped      bool    `json:"is_air_gapped"`
ClosureState     string  `json:"closure_state"`
ContentHash      *string `json:"content_hash"`
LastVerified     *string `json:"last_verified"`
InvariantVersion string  `json:"invariant_version"`
}

type Topology struct {
LocalPaths  []string     `json:"local_paths"`
AIFragments []AIFragment `json:"ai_fragments"`
}

type AIFragment struct {
Platform          string  `json:"platform"`
URL               *string `json:"url"`
ThreadID          *string `json:"thread_id"`
ContextSummary    string  `json:"context_summary"`
LastSyncTimestamp string  `json:"last_sync_timestamp"`
Sha256OfExport    *string `json:"sha256_of_export"`
}

type StateTelemetry struct {
DriftDetected    bool    `json:"drift_detected"`
OpenLoopsCount   int     `json:"open_loops_count"`
LastUpdated      string  `json:"last_updated"`
QuarantineReason *string `json:"quarantine_reason"`
}

type PolicyRail struct {
PolicyID string `json:"policy_id"`
Version  string `json:"version"`
Rules    []Rule `json:"rules"`
}

type Rule struct {
ID        string `json:"id"`
Condition string `json:"condition"`
Effect    string `json:"effect"`
}

type CanonicalPayload struct {
Attestation Attestation `json:"attestation"`
DecisionID  string      `json:"decision_id"`
IssuedAt    string      `json:"issued_at"`
Payload     PayloadData `json:"payload"`
Policy      PolicyRef   `json:"policy"`
ReceiptID   string      `json:"receipt_id"`
}

type Attestation struct {
PCR0     string `json:"pcr0"`
Platform string `json:"platform"`
}

type PayloadData struct {
Decision string `json:"decision"`
RxHash   string `json:"rx_hash"`
}

type PolicyRef struct {
PolicyID   string `json:"policy_id"`
HashSHA256 string `json:"hash_sha256"`
}