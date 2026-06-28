import requests
import yaml
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.config import settings
from app.models.fleet import Fleet
from app.models.agent import Agent
from app.models.config import Configuration
from app.routes.auth import verify_admin_role, verify_any_role
from app.services.config_utils import merge_otel_configs
from app.services.audit import log_audit

# Import simulator module to avoid primitive variable reference issues
import app.routes.simulator

router = APIRouter(prefix="/api/fleets", tags=["fleets"])

@router.get("")
def get_fleets(db: Session = Depends(get_db), current_user = Depends(verify_any_role)):
    fleets = db.query(Fleet).all()
    result = []
    for f in fleets:
        # Get count of agents associated with this fleet
        agents = db.query(Agent).filter(Agent.fleet_name == f.name).all()
        agent_ids = [a.id for a in agents]
        result.append({
            "name": f.name,
            "description": f.description,
            "config_name": f.config_name,
            "agent_ids": agent_ids
        })
    return {"fleets": result}

class FleetPayload(BaseModel):
    name: str
    description: str = ""
    config_name: str = "Default"

@router.post("")
def create_or_update_fleet(payload: FleetPayload, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Fleet name cannot be empty")
        
    fleet = db.query(Fleet).filter(Fleet.name == name).first()
    is_new = fleet is None
    if fleet:
        fleet.description = payload.description
        fleet.config_name = payload.config_name
    else:
        fleet = Fleet(
            name=name,
            description=payload.description,
            config_name=payload.config_name
        )
        db.add(fleet)
    db.commit()
    
    ip = request.client.host if request.client else "unknown"
    user = current_user.get("username", "admin")
    action = "CREATE_FLEET" if is_new else "UPDATE_FLEET"
    log_audit(db, username=user, action=action, target=name, details=f"Saved fleet '{name}' with config: '{payload.config_name}' and description: '{payload.description}'", ip_address=ip)

    return {"status": "success", "message": f"Fleet '{name}' saved successfully."}

@router.delete("/{fleet_name}")
def delete_fleet(fleet_name: str, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    if fleet_name == "Default":
        raise HTTPException(status_code=400, detail="Cannot delete Default fleet")
        
    fleet = db.query(Fleet).filter(Fleet.name == fleet_name).first()
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    # Reassign agents in deleted fleet to Default fleet
    db.query(Agent).filter(Agent.fleet_name == fleet_name).update(
        {Agent.fleet_name: "Default"}, synchronize_session=False
    )
    
    db.delete(fleet)
    db.commit()
    
    ip = request.client.host if request.client else "unknown"
    user = current_user.get("username", "admin")
    log_audit(db, username=user, action="DELETE_FLEET", target=fleet_name, details=f"Deleted fleet '{fleet_name}'. All fleet agents reassigned to Default fleet.", ip_address=ip)

    return {"status": "success", "message": f"Fleet '{fleet_name}' deleted."}

@router.get("/{fleet_name}/telemetry")
def get_fleet_telemetry(fleet_name: str, db: Session = Depends(get_db), current_user = Depends(verify_any_role)):
    fleet = db.query(Fleet).filter(Fleet.name == fleet_name).first()
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    agents = db.query(Agent).filter(Agent.fleet_name == fleet_name).all()
    agent_ids = [a.id for a in agents]
    
    config_profile = db.query(Configuration).filter(Configuration.name == fleet.config_name).first()
    config_yaml = ""
    if config_profile and config_profile.revisions:
        sorted_revs = sorted(config_profile.revisions, key=lambda x: x.version)
        if sorted_revs:
            config_yaml = sorted_revs[-1].config

    collection_interval = 10.0
    active_receivers = ["hostmetrics"]
    logs_pipelines_active = False
    traces_pipelines_active = False
    
    if config_yaml:
        try:
            cfg = yaml.safe_load(config_yaml) or {}
            receivers_cfg = cfg.get("receivers", {})
            if isinstance(receivers_cfg, dict):
                active_receivers = list(receivers_cfg.keys())
                
                hostmetrics_cfg = receivers_cfg.get("hostmetrics", {})
                if isinstance(hostmetrics_cfg, dict):
                    interval_str = hostmetrics_cfg.get("collection_interval", "10s")
                    if isinstance(interval_str, str) and interval_str.endswith("s"):
                        try:
                            collection_interval = float(interval_str[:-1])
                        except ValueError:
                            pass
                            
            pipelines = cfg.get("service", {}).get("pipelines", {})
            if isinstance(pipelines, dict):
                if "logs" in pipelines:
                    logs_pipelines_active = True
                if "traces" in pipelines:
                    traces_pipelines_active = True
        except Exception:
            pass
            
    scrapes_per_hour = 3600.0 / max(1.0, collection_interval)
    bytes_per_scrape = 0.0
    for rec in active_receivers:
        if rec == "hostmetrics":
            bytes_per_scrape += 1536.0
        elif rec == "postgresql":
            bytes_per_scrape += 2560.0
        elif rec == "nginx":
            bytes_per_scrape += 1024.0
        else:
            bytes_per_scrape += 1024.0
            
    base_metrics_rate = scrapes_per_hour * bytes_per_scrape
    
    connected = 0
    warning = 0
    offline = 0
    
    metrics_rate = 0.0
    logs_rate = 0.0
    traces_rate = 0.0
    
    sim_active = False
    with app.routes.simulator.sim_lock:
        sim_active = (app.routes.simulator.simulator_status != "normal")
        sim_type = app.routes.simulator.simulator_status
        
    for a in agents:
        status = a.status or "Offline"
        if status == "Healthy":
            connected += 1
        elif status == "Warning":
            warning += 1
        else:
            offline += 1
            
        if status in ("Healthy", "Warning"):
            a_metrics = base_metrics_rate
            a_logs = 80000.0 if logs_pipelines_active else 0.0
            a_traces = 120000.0 if traces_pipelines_active else 0.0
            
            if sim_active:
                if sim_type == "cpu":
                    a_metrics *= 5.5
                    if logs_pipelines_active:
                        a_logs *= 3.0
                elif sim_type == "memory":
                    a_metrics *= 8.0
                elif sim_type == "disk":
                    a_metrics *= 12.0
                    if logs_pipelines_active:
                        a_logs *= 15.0
                elif sim_type == "network":
                    a_metrics *= 4.0
                    if traces_pipelines_active:
                        a_traces += 24000000.0
                    else:
                        a_traces = 24000000.0
                        
            metrics_rate += a_metrics
            logs_rate += a_logs
            traces_rate += a_traces
            
    return {
        "fleet_name": fleet_name,
        "status": {
            "connected": connected,
            "warning": warning,
            "offline": offline,
            "total": len(agent_ids)
        },
        "telemetry": {
            "metrics_bytes_per_hour": metrics_rate,
            "logs_bytes_per_hour": logs_rate,
            "traces_bytes_per_hour": traces_rate
        }
    }

class AssignConfigPayload(BaseModel):
    config_name: str

@router.post("/{fleet_name}/assign_config")
def assign_fleet_config(fleet_name: str, payload: AssignConfigPayload, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    fleet = db.query(Fleet).filter(Fleet.name == fleet_name).first()
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    configs = db.query(Configuration).filter(Configuration.name == payload.config_name).first()
    if not configs:
        raise HTTPException(status_code=404, detail=f"Configuration '{payload.config_name}' not found")
        
    fleet.config_name = payload.config_name
    db.commit()
    
    sorted_revs = sorted(configs.revisions, key=lambda x: x.version)
    latest_yaml = sorted_revs[-1].config if sorted_revs else ""
    
    agents = db.query(Agent).filter(Agent.fleet_name == fleet_name).all()
    success_count = 0
    fail_count = 0
    
    for a in agents:
        if a.type == "physical":
            try:
                custom_override = a.custom_config_override or ""
                effective_config = merge_otel_configs(latest_yaml, custom_override)
                
                data = {"instanceid": a.id, "config": effective_config}
                res = requests.post(f"{settings.OPAMP_SERVER_URL}/save_config", data=data, timeout=5.0)
                if res.status_code in (200, 303):
                    success_count += 1
                else:
                    fail_count += 1
            except Exception as e:
                print(f"Backend: Config propagation fail for agent {a.id}: {e}")
                fail_count += 1
                
    ip = request.client.host if request.client else "unknown"
    user = current_user.get("username", "admin")
    log_audit(db, username=user, action="ASSIGN_CONFIG", target=fleet_name, details=f"Assigned configuration '{payload.config_name}' to fleet '{fleet_name}'. Propagated config to {success_count} agents ({fail_count} failed).", ip_address=ip)

    return {
        "status": "success",
        "message": f"Config '{payload.config_name}' assigned to fleet '{fleet_name}'. Propagated to {success_count} agents ({fail_count} failed)."
    }

class AssignAgentsPayload(BaseModel):
    agent_ids: list

@router.post("/{fleet_name}/assign_agents")
def assign_fleet_agents(fleet_name: str, payload: AssignAgentsPayload, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    fleet = db.query(Fleet).filter(Fleet.name == fleet_name).first()
    if not fleet:
        raise HTTPException(status_code=404, detail="Fleet not found")
        
    # Move specified agents to the new fleet (they are auto-removed from old fleets)
    db.query(Agent).filter(Agent.id.in_(payload.agent_ids)).update(
        {Agent.fleet_name: fleet_name}, synchronize_session=False
    )
    db.commit()
    
    configs = db.query(Configuration).filter(Configuration.name == fleet.config_name).first()
    latest_yaml = ""
    if configs and configs.revisions:
        sorted_revs = sorted(configs.revisions, key=lambda x: x.version)
        if sorted_revs:
            latest_yaml = sorted_revs[-1].config
            
    agents = db.query(Agent).filter(Agent.id.in_(payload.agent_ids)).all()
    for a in agents:
        if a.type == "physical":
            try:
                custom_override = a.custom_config_override or ""
                effective_config = merge_otel_configs(latest_yaml, custom_override)
                
                data = {"instanceid": a.id, "config": effective_config}
                requests.post(f"{settings.OPAMP_SERVER_URL}/save_config", data=data, timeout=5.0)
            except Exception as e:
                print(f"Backend: Failed to apply new fleet config to agent {a.id}: {e}")
                
    ip = request.client.host if request.client else "unknown"
    user = current_user.get("username", "admin")
    log_audit(db, username=user, action="ASSIGN_AGENTS", target=fleet_name, details=f"Assigned agent IDs: {payload.agent_ids} to fleet '{fleet_name}'.", ip_address=ip)

    return {"status": "success", "message": f"Successfully reassigned {len(payload.agent_ids)} agents to fleet '{fleet_name}'."}
