import os
import json
import time
from app.database import SessionLocal
from app.models.agent import Agent

def create_servicenow_incident(instance_id: str, description: str, env: str):
    incidents_file = "servicenow_incidents.json"
    try:
        if os.path.exists(incidents_file):
            with open(incidents_file, "r") as f:
                incidents = json.load(f)
        else:
            incidents = []
    except:
        incidents = []
        
    for inc in incidents:
        if inc.get("agent_id") == instance_id and inc.get("status") in ("New", "Assigned"):
            return
            
    inc_id = f"INC{len(incidents) + 1000001}"
    priority = "P1 - Critical" if env == "prod" else "P3 - Moderate"
    
    incidents.append({
        "incident_id": inc_id,
        "timestamp": time.time(),
        "agent_id": instance_id,
        "priority": priority,
        "description": description,
        "status": "New",
        "assigned_to": "Infra Ops Team"
    })
    try:
        with open(incidents_file, "w") as f:
            json.dump(incidents, f, indent=2)
        print(f"ServiceNow Incident Created: {inc_id} (Priority: {priority}) for agent {instance_id}")
    except Exception as e:
        print(f"Failed to create ServiceNow incident: {e}")

def run_servicenow_sync_loop():
    print("ServiceNow Incident Sync Loop started.")
    while True:
        try:
            db = SessionLocal()
            try:
                agents = db.query(Agent).all()
                for a in agents:
                    status = a.status
                    env = a.environment or "dev"
                    if status == "Offline":
                        create_servicenow_incident(
                            instance_id=a.id,
                            description=f"Agent '{a.name}' is OFFLINE. Heartbeat check failed.",
                            env=env
                        )
                    elif status == "Warning":
                        create_servicenow_incident(
                            instance_id=a.id,
                            description=f"Agent '{a.name}' is in WARNING state. Telemetry health degraded.",
                            env=env
                        )
            finally:
                db.close()
        except Exception as e:
            print(f"ServiceNow sync loop error: {e}")
        time.sleep(10)
