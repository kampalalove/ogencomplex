package main

import (
"fmt"
"os"
"github.com/kampalalove/ogencomplex/internal/parser"
)

func main() {
fmt.Println("Executing localized hardware-software ecosystem integrity validation...")
if err := parser.VerifyRuntimeIntegrity(); err != nil {
fmt.Fprintf(os.Stderr, "Integrity check failed: %v\n", err)
os.Exit(1)
}
fmt.Println("Sovereignty verified. No dirty or modified source invariants detected.")
}