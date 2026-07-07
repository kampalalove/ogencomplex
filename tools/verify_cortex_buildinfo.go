<<<<<<< HEAD
﻿package main

import (
"debug/buildinfo"
"fmt"
"os"
)

func main() {
if len(os.Args) < 2 {
fmt.Println("❌ Error: Missing binary path target argument")
os.Exit(1)
}

binaryPath := os.Args[1]
info, err := buildinfo.ReadFile(binaryPath)
if err != nil {
fmt.Printf("❌ Failed to parse Go structural build info from binary: %v\n", err)
os.Exit(1)
}

fmt.Printf("✅ Verification Pass: Built via go compiler version: %s\n", info.GoVersion)
for _, setting := range info.Settings {
if setting.Key == "vcs.modified" && setting.Value == "true" {
fmt.Println("❌ Failure Invariant: Source code directory tree was dirty during compile pass.")
os.Exit(1)
}
}
fmt.Println("🔒 Secure Anchor Match: VCS metadata validates system integrity.")
=======
package main

import (
	"debug/buildinfo"
	"fmt"
	"os"
)

const shortCommitLength = 12

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: verify_cortex_buildinfo <binary>\n")
		os.Exit(1)
	}
	path := os.Args[1]

	info, err := buildinfo.ReadFile(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ buildinfo read failed: %v\n", err)
		os.Exit(1)
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
		fmt.Fprintf(os.Stderr, "❌ missing vcs.revision — build not reproducible?\n")
		os.Exit(1)
	}
	short := commit
	if len(short) > shortCommitLength {
		short = short[:shortCommitLength]
	}
	if modified == "true" {
		fmt.Fprintf(os.Stderr, "❌ dirty git tree (%s) — uncommitted changes\n", short)
		os.Exit(1)
	}

	fmt.Printf("✅ verified: commit %s, clean tree\n", short)
	os.Exit(0)
>>>>>>> pr-22-fix
}
