// Veritas Edge Binary – Offline‑first, static Go binary
// Build: GOOS=linux GOARCH=arm64 go build -o veritas-edge main.go
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
)

type StateVector struct {
	Timestamp string
	SensorID  string
	Value     float64
	PrevHash  string
	Hash      string
}

func computeHash(sv StateVector) string {
	value := strconv.FormatFloat(sv.Value, 'f', -1, 64)
	data := fmt.Sprintf("%s|%s|%s|%s", sv.Timestamp, sv.SensorID, value, sv.PrevHash)
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:])
}

func main() {
	fmt.Println("Veritas Edge Kernel (offline‑first)")
	// Ingest, verify, chain, write‑ahead log, replay
}
