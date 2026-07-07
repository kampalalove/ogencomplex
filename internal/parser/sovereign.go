package parser

import (
"errors"
"runtime/debug"
)

func VerifyRuntimeIntegrity() error {
info, ok := debug.ReadBuildInfo()
if !ok {
return errors.New("failed to read build info data from execution runtime")
}

for _, setting := range info.Settings {
if setting.Key == "vcs.modified" && setting.Value == "true" {
return errors.New("invariant violation: binary compiled from modified source control tree")
}
}
return nil
}