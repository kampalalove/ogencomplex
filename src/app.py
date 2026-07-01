import os
import json
import hashlib
import logging
import importlib
from datetime import datetime, timezone
from flask import Flask, request, jsonify, render_template

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='../static', template_folder='../static')

# In-memory encrypted audit log (simulated)
AUDIT_LOG = []

# Function registries
ETHICS_FUNCS = []
TECH_FUNCS = []

# --- Core Master Functions ---
def EnforceReasoningJudgment(input_data, context):
    """Ensures logic, ethics, and defensible decisions."""
    score = 100
    reasons = []
    for name, func in ETHICS_FUNCS:
        try:
            result = func(input_data, context)
            if not result.get("passed", True):
                score = min(score, result.get("score", 0))
                reasons.append(f"{name}: {result.get('reason', 'Fail')}")
        except Exception as e:
            logger.error(f"Ethics function {name} failed: {e}")
            reasons.append(f"{name}: ERROR")
    return {"score": score, "reasons": reasons, "passed": score >= 70}

def EnforceTaskUnderstanding(task, context):
    """Ensures contextual awareness and accurate execution."""
    # Stub: validates task structure
    if not task or not isinstance(task, dict):
        return {"passed": False, "reason": "Invalid task format"}
    if "action" not in task:
        return {"passed": False, "reason": "Missing 'action' in task"}
    return {"passed": True, "reason": "Task understood"}

# --- TandemMeal Orchestrator ---
def TandemMeal(task, context=None):
    context = context or {}
    # 1. Task Understanding
    task_check = EnforceTaskUnderstanding(task, context)
    if not task_check["passed"]:
        return {"status": "rejected", "reason": task_check["reason"]}
    
    # 2. Technical Execution (Stub)
    tech_result = {"status": "executed", "output": f"Processed {task.get('action')}"}
    for name, func in TECH_FUNCS:
        try:
            tech_result = func(tech_result, context)
        except Exception as e:
            logger.error(f"Tech function {name} failed: {e}")
    
    # 3. Ethical/Reasoning Judgment
    judgment = EnforceReasoningJudgment(tech_result, context)
    if not judgment["passed"]:
        return {"status": "blocked", "reason": judgment["reasons"], "score": judgment["score"]}
    
    # 4. Log to encrypted audit
    log_entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "task": task,
        "result": tech_result,
        "score": judgment["score"],
        "hash": hashlib.sha256(json.dumps(tech_result).encode()).hexdigest()
    }
    AUDIT_LOG.append(log_entry)
    
    return {"status": "approved", "data": tech_result, "audit_hash": log_entry["hash"]}

# --- Auto-load Domain Modules (Law, Medicine, Hardware, Economics) ---
def load_domain_modules():
    for mod_name in ["law", "medicine", "hardware", "economics"]:
        try:
            mod = importlib.import_module(f"src.{mod_name}")
            if hasattr(mod, "register"):
                funcs = mod.register()
                for name, fn, category in funcs:
                    if category == "ethics":
                        ETHICS_FUNCS.append((name, fn))
                    elif category == "tech":
                        TECH_FUNCS.append((name, fn))
                logger.info(f"Loaded {mod_name}")
        except ImportError:
            logger.warning(f"{mod_name} not found – skipping (stub mode)")
        except Exception as e:
            logger.error(f"Error loading {mod_name}: {e}")

# Load modules on startup
load_domain_modules()

# --- Flask Routes ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/process', methods=['POST'])
def process_task():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON"}), 400
    result = TandemMeal(data.get("task", {}), data.get("context", {}))
    return jsonify(result)

@app.route('/api/audit', methods=['GET'])
def get_audit():
    # Return last 50 logs (plaintext in-memory storage for demo)
    return jsonify({"logs": AUDIT_LOG[-50:]})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
