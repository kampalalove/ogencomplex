package main

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
}
