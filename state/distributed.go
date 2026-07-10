package state

import (
    "crypto/rand"
    "encoding/base64"
    "net"
    "os"
    "sync"
    "time"
)

type NodeIdentity struct {
    NodeID    string
    Region    string
    PodIP     string
    StartTime time.Time
}

type DistributedState struct {
    mu        sync.RWMutex
    nodeID    string
    region    string
    podIP     string
    startedAt time.Time
}

func NewDistributedState() *DistributedState {
    nodeID := os.Getenv("FLY_MACHINE_ID")
    if nodeID == "" {
        b := make([]byte, 8)
        rand.Read(b)
        nodeID = base64.URLEncoding.EncodeToString(b)
    }
    
    region := os.Getenv("FLY_REGION")
    if region == "" {
        region = "ewr"
    }
    
    podIP := os.Getenv("FLY_PUBLIC_IP")
    if podIP == "" {
        podIP = getLocalIP()
    }
    
    return &DistributedState{
        nodeID:    nodeID,
        region:    region,
        podIP:     podIP,
        startedAt: time.Now(),
    }
}

func getLocalIP() string {
    addrs, err := net.InterfaceAddrs()
    if err != nil {
        return "127.0.0.1"
    }
    for _, addr := range addrs {
        if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
            if ipnet.IP.To4() != nil {
                return ipnet.IP.String()
            }
        }
    }
    return "127.0.0.1"
}

func (ds *DistributedState) GetNodeInfo() NodeIdentity {
    ds.mu.RLock()
    defer ds.mu.RUnlock()
    return NodeIdentity{
        NodeID:    ds.nodeID,
        Region:    ds.region,
        PodIP:     ds.podIP,
        StartTime: ds.startedAt,
    }
}

func (ds *DistributedState) GetStats() map[string]interface{} {
    ds.mu.RLock()
    defer ds.mu.RUnlock()
    return map[string]interface{}{
        "node_id": ds.nodeID,
        "region":  ds.region,
        "uptime":  time.Since(ds.startedAt).String(),
    }
}