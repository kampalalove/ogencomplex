package main

import (
	"debug/buildinfo"
	"fmt"
	"os"
)

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
	if modified == "true" {
		fmt.Fprintf(os.Stderr, "❌ dirty git tree (%s) — uncommitted changes\n", commit[:12])
		os.Exit(1)
	}

	fmt.Printf("✅ verified: commit %s, clean tree\n", commit[:12])
	os.Exit(0)
}
