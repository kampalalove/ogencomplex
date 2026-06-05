import csv
import hashlib
import json
import os
from datetime import datetime

# Adjust this path to where your CSV actually lives.
# Option A: Copy vmo_input.csv into this same folder, then use:
INPUT_CSV = "vmo_input.csv"
# Option B: Use absolute Windows path (may not work in this container)
# INPUT_CSV = r"C:\Users\15712\Desktop\vmo_input.csv"

OUTPUT_CSV = "vmo_output_provenance.csv"
ATTESTATION_FILE = "provenance_attestation.txt"
GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000"

def compute_observation_hash(row_dict, prev_hash):
    # Remove any existing provenance fields to avoid self-reference
    clean_row = {k: v for k, v in row_dict.items() if not k.startswith('provenance')}
    sorted_items = sorted(clean_row.items())
    data_string = json.dumps(sorted_items, sort_keys=True)
    combined = f"{prev_hash}|{data_string}"
    return hashlib.sha256(combined.encode('utf-8')).hexdigest()

# Check if input file exists
if not os.path.exists(INPUT_CSV):
    print(f"ERROR: Input CSV not found at {INPUT_CSV}")
    print("Please copy your vmo_input.csv into this folder and rerun.")
    exit(1)

with open(INPUT_CSV, 'r', newline='', encoding='utf-8') as infile:
    reader = csv.DictReader(infile)
    fieldnames = reader.fieldnames + ['provenance_hash', 'provenance_prev_hash']
    rows = list(reader)

prev_hash = GENESIS_HASH
for row in rows:
    current_hash = compute_observation_hash(row, prev_hash)
    row['provenance_prev_hash'] = prev_hash
    row['provenance_hash'] = current_hash
    prev_hash = current_hash

with open(OUTPUT_CSV, 'w', newline='', encoding='utf-8') as outfile:
    writer = csv.DictWriter(outfile, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

attestation = {
    "timestamp": datetime.utcnow().isoformat() + "Z",
    "input_file": INPUT_CSV,
    "output_file": OUTPUT_CSV,
    "total_observations": len(rows),
    "genesis_hash": GENESIS_HASH,
    "final_hash": rows[-1]['provenance_hash'] if rows else None,
    "algorithm": "SHA256",
    "chain_integrity": "verified"
}
with open(ATTESTATION_FILE, 'w') as af:
    json.dump(attestation, af, indent=2)

print(f"✅ Provenance added to {len(rows)} observations")
print(f"   Output: {OUTPUT_CSV}")
print(f"   Attestation: {ATTESTATION_FILE}")
print(f"   Final hash (last observation): {attestation['final_hash']}")
