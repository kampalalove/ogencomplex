<<<<<<< HEAD
﻿package parser

import (
"debug/buildinfo"
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
=======
package parser

import (
	"debug/buildinfo"
	"log"
	"os"
)

// shortCommitLength is the number of hex characters used when displaying a commit hash.
const shortCommitLength = 12

func init() {
	exe, err := os.Executable()
	if err != nil {
		log.Fatalf("❌ Sovereign: cannot get executable path: %v", err)
	}
	info, err := buildinfo.ReadFile(exe)
	if err != nil {
		log.Fatalf("❌ Sovereign: buildinfo read failed: %v", err)
	}

	var commit, modified string
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			commit = s.Value
		case "vcs.modified":
			modified = s.Value
		}
	}

	if commit == "" {
		log.Fatal("❌ Sovereign: missing vcs.revision — build not reproducible?")
	}
	short := commit
	if len(short) > shortCommitLength {
		short = short[:shortCommitLength]
	}
	if modified == "true" {
		log.Fatalf("❌ Sovereign: dirty git tree (%s) — refusing to run", short)
	}

	log.Printf("🔐 Sovereign: verified commit %s, clean tree", short)
>>>>>>> pr-22-fix
}
