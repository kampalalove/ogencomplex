package index

import (
"encoding/json"
"fmt"
"os"
"path/filepath"
"time"

"github.com/kampalalove/ogencomplex/models"
)

const IndexDir = "universe.index"

type Writer struct {
BasePath string
}

func NewWriter(basePath string) *Writer {
return &Writer{BasePath: basePath}
}

func (w *Writer) GetProfilePath(systemID string) string {
return filepath.Join(w.BasePath, IndexDir, fmt.Sprintf("%s.json", systemID))
}

func (w *Writer) LoadOrCreate(systemID string) (*models.SystemProfile, bool, error) {
path := w.GetProfilePath(systemID)

if err := os.MkdirAll(filepath.Join(w.BasePath, IndexDir), 0755); err != nil {
return nil, false, err
}

if _, err := os.Stat(path); os.IsNotExist(err) {
profile := &models.SystemProfile{
SystemID: systemID,
Name:     toTitle(systemID),
Version:  "0.0.1",
Layers: models.Layers{
Authority: models.Authority{
SourceOfTruth:  "local_disk",
SchemaDefined:  true,
StackType:      "child",
ParentSystemID: nil,
Children:       []string{},
},
Logic: models.Logic{
Runtime:      "N/A",
Dependencies: []string{},
EntryPoint:   "N/A",
},
Transport: models.Transport{
DeploymentTarget: "local_host",
Pipeline:         "manual",
RepoURL:          nil,
},
Telemetry: models.Telemetry{
HasLogging:       false,
MonitoringMethod: "N/A",
HealthEndpoint:   nil,
},
Sovereignty: models.Sovereignty{
IsAirGapped:      false,
ClosureState:     "active_build",
ContentHash:      nil,
LastVerified:     nil,
InvariantVersion: "1.1",
},
},
Topology: models.Topology{
LocalPaths:  []string{},
AIFragments: []models.AIFragment{},
},
StateTelemetry: models.StateTelemetry{
DriftDetected:    false,
OpenLoopsCount:   0,
LastUpdated:      time.Now().UTC().Format(time.RFC3339),
QuarantineReason: nil,
},
}
return profile, false, nil
}

data, err := os.ReadFile(path)
if err != nil {
return nil, false, err
}

var profile models.SystemProfile
if err := json.Unmarshal(data, &profile); err != nil {
return nil, false, err
}
return &profile, true, nil
}

func (w *Writer) Save(profile *models.SystemProfile) error {
path := w.GetProfilePath(profile.SystemID)
data, err := json.MarshalIndent(profile, "", "  ")
if err != nil {
return err
}
return os.WriteFile(path, data, 0644)
}

func (w *Writer) AppendFragment(systemID string, fragment models.AIFragment) error {
profile, exists, err := w.LoadOrCreate(systemID)
if err != nil {
return err
}
if !exists {
profile.Name = toTitle(systemID)
}

profile.Topology.AIFragments = append(profile.Topology.AIFragments, fragment)
profile.StateTelemetry.LastUpdated = time.Now().UTC().Format(time.RFC3339)

return w.Save(profile)
}

func (w *Writer) UpdateLoops(systemID string, resolvedLoops int) error {
profile, _, err := w.LoadOrCreate(systemID)
if err != nil {
return err
}

current := profile.StateTelemetry.OpenLoopsCount
newCount := current - resolvedLoops
if newCount < 0 {
newCount = 0
}
profile.StateTelemetry.OpenLoopsCount = newCount
profile.StateTelemetry.LastUpdated = time.Now().UTC().Format(time.RFC3339)

return w.Save(profile)
}

func toTitle(s string) string {
result := ""
capitalize := true
for _, ch := range s {
if ch == '-' || ch == '_' {
result += " "
capitalize = true
} else if capitalize {
if ch >= 'a' && ch <= 'z' {
result += string(ch - 32)
} else {
result += string(ch)
}
capitalize = false
} else {
result += string(ch)
}
}
return result
}