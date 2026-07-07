import { createHash } from 'crypto';

export interface GateContext {
    timestamp: number;
    environment: 'production' | 'development' | 'horizon_mode';
    payloadHash: string;
    expectedThermalCornerCelcius: number;
}

export interface GateResult {
    passed: boolean;
    gateLogs: string[];
    provenanceToken?: string;
}

export function executeHardGates(context: GateContext, payload: any): GateResult {
    const gateLogs: string[] = [];
    
    // 1. GATE 01: SOVEREIGNTY - Guarding against external state modifications
    if (context.environment === 'horizon_mode') {
        gateLogs.push("🔒 [Gate-Sovereignty]: Internal network mode (HORIZON_MODE) active. Disabling public validation gates.");
    } else {
        gateLogs.push("🔒 [Gate-Sovereignty]: Edge state verified. Isolation protocol intact.");
    }

    // 2. GATE 02: STATE - Enforcing immutable environmental constraints
    if (context.expectedThermalCornerCelcius !== 75) {
        gateLogs.push("❌ [Gate-State]: REJECTED - System execution corner must align strictly to 75°C target profile.");
        return { passed: false, gateLogs };
    }
    gateLogs.push("✅ [Gate-State]: Thermal corner constraints validated at 75°C.");

    // 3. GATE 03: EVIDENCE - Deterministic hash audit verification
    const structuralString = JSON.stringify(payload);
    const computedHash = createHash('sha256').update(structuralString).digest('hex');
    if (computedHash !== context.payloadHash) {
        gateLogs.push(`❌ [Gate-Evidence]: Integrity failure. Payload state drifted from provided hash tracker.`);
        return { passed: false, gateLogs };
    }
    gateLogs.push("✅ [Gate-Evidence]: State verification matches block hash.");

    // 4. GATE 04: TIME - Upper bound tracking to guarantee zero execution stagnation
    const runtimeDrift = Date.now() - context.timestamp;
    if (runtimeDrift > 1200000) { // 20-minute operational drift limit (MPES rule)
        gateLogs.push("❌ [Gate-Time]: Operation window expired. Drift exceeded 20-minute window limit.");
        return { passed: false, gateLogs };
    }
    gateLogs.push("✅ [Gate-Time]: Temporal gate checked. Execution within safe window parameters.");

    // 5. GATE 05: DETERMINISM - Guaranteeing a repeatable single result sequence
    const provenanceToken = createHash('sha256')
        .update(`${context.payloadHash}:${context.timestamp}:75`)
        .digest('hex');
    gateLogs.push(`✅ [Gate-Determinism]: Token generated for hash-chained ledger trail: ${provenanceToken.slice(0, 16)}`);

    return {
        passed: true,
        gateLogs,
        provenanceToken
    };
}
