import time
import requests
import yaml
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.config import settings
from app.models.config import Configuration, ConfigurationRevision
from app.models.fleet import Fleet
from app.models.agent import Agent
from app.routes.auth import verify_admin_role, verify_any_role
from app.services.config_utils import merge_otel_configs
from app.services.audit import log_audit

router = APIRouter(tags=["configurations"])

@router.get("/api/configurations")
def get_configurations(db: Session = Depends(get_db), current_user = Depends(verify_any_role)):
    configs = db.query(Configuration).all()
    result = []
    for c in configs:
        # Get latest revision by sorting
        sorted_revs = sorted(c.revisions, key=lambda x: x.version)
        latest_yaml = sorted_revs[-1].config if sorted_revs else ""
        result.append({
            "name": c.name,
            "description": c.description,
            "platform": c.platform,
            "version": c.version,
            "latest_config": latest_yaml
        })
    return {"configurations": result}

class ConfigurationPayload(BaseModel):
    name: str
    description: str = ""
    platform: str = "Cross-Platform"
    config: str
    change_description: str = "Updated configuration parameters"

@router.post("/api/configurations")
def save_configuration(payload: ConfigurationPayload, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Configuration name cannot be empty")
        
    try:
        yaml.safe_load(payload.config)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OTel YAML Syntax Error: {e}")
        
    config_obj = db.query(Configuration).filter(Configuration.name == name).first()
    if config_obj:
        next_ver = config_obj.version + 1
        config_obj.version = next_ver
        config_obj.description = payload.description
        config_obj.platform = payload.platform
        
        new_rev = ConfigurationRevision(
            config_id=config_obj.id,
            version=next_ver,
            timestamp=time.time(),
            config=payload.config,
            description=payload.change_description,
            author=current_user.get("username", "admin")
        )
        db.add(new_rev)
    else:
        config_obj = Configuration(
            name=name,
            description=payload.description,
            platform=payload.platform,
            version=1
        )
        db.add(config_obj)
        db.flush()  # populate ID
        
        new_rev = ConfigurationRevision(
            config_id=config_obj.id,
            version=1,
            timestamp=time.time(),
            config=payload.config,
            description="Initial creation",
            author=current_user.get("username", "admin")
        )
        db.add(new_rev)
        
    db.commit()
    
    # Re-fetch fleets that use this configuration for agent config propagation
    fleets = db.query(Fleet).filter(Fleet.config_name == name).all()
    propagate_count = 0
    
    for f in fleets:
        agents = db.query(Agent).filter(Agent.fleet_name == f.name).all()
        for a in agents:
            if a.type == "physical":
                try:
                    custom_override = a.custom_config_override or ""
                    effective = merge_otel_configs(payload.config, custom_override)
                    
                    data = {"instanceid": a.id, "config": effective}
                    res = requests.post(f"{settings.OPAMP_SERVER_URL}/save_config", data=data, timeout=5.0)
                    if res.status_code in (200, 303):
                        propagate_count += 1
                except Exception as e:
                    print(f"Backend: Fleet update propagation fail for agent {a.id}: {e}")
                    
    ip = request.client.host if request.client else "unknown"
    user = current_user.get("username", "admin")
    log_audit(db, username=user, action="DEPLOY_CONFIG", target=name, details=f"Saved config version {config_obj.version}. Description: {payload.change_description}. Propagated to {propagate_count} agents.", ip_address=ip)

    return {
        "status": "success",
        "message": f"Configuration '{name}' saved as version {config_obj.version}. Propagated to {propagate_count} active fleet agents."
    }

@router.get("/api/configurations/{config_name}/versions")
def get_config_versions(config_name: str, db: Session = Depends(get_db), current_user = Depends(verify_any_role)):
    config_obj = db.query(Configuration).filter(Configuration.name == config_name).first()
    if not config_obj:
        raise HTTPException(status_code=404, detail="Configuration not found")
        
    revisions = []
    for r in config_obj.revisions:
        revisions.append({
            "version": r.version,
            "timestamp": r.timestamp,
            "config": r.config,
            "description": r.description,
            "author": r.author
        })
    return {"revisions": revisions}

class RollbackConfigPayload(BaseModel):
    version: int

@router.post("/api/configurations/{config_name}/rollback")
def rollback_config_version(config_name: str, payload: RollbackConfigPayload, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    config_obj = db.query(Configuration).filter(Configuration.name == config_name).first()
    if not config_obj:
        raise HTTPException(status_code=404, detail="Configuration not found")
        
    target_rev = None
    for r in config_obj.revisions:
        if r.version == payload.version:
            target_rev = r
            break
            
    if not target_rev:
        raise HTTPException(status_code=404, detail=f"Version {payload.version} not found in configuration history")
        
    next_ver = config_obj.version + 1
    config_obj.version = next_ver
    
    new_rev = ConfigurationRevision(
        config_id=config_obj.id,
        version=next_ver,
        timestamp=time.time(),
        config=target_rev.config,
        description=f"Rollback to Version {payload.version}",
        author=current_user.get("username", "admin")
    )
    db.add(new_rev)
    db.commit()
    
    # Propagate rolled back config
    fleets = db.query(Fleet).filter(Fleet.config_name == config_name).all()
    propagate_count = 0
    
    for f in fleets:
        agents = db.query(Agent).filter(Agent.fleet_name == f.name).all()
        for a in agents:
            if a.type == "physical":
                try:
                    custom_override = a.custom_config_override or ""
                    effective = merge_otel_configs(target_rev.config, custom_override)
                    
                    data = {"instanceid": a.id, "config": effective}
                    res = requests.post(f"{settings.OPAMP_SERVER_URL}/save_config", data=data, timeout=5.0)
                    if res.status_code in (200, 303):
                        propagate_count += 1
                except Exception:
                    pass
                    
    ip = request.client.host if request.client else "unknown"
    user = current_user.get("username", "admin")
    log_audit(db, username=user, action="ROLLBACK_CONFIG", target=config_name, details=f"Rolled back configuration '{config_name}' to version {payload.version}. New version is {config_obj.version}. Propagated configuration to {propagate_count} agents.", ip_address=ip)

    return {
        "status": "success",
        "message": f"Successfully rolled back configuration '{config_name}' to version {payload.version}. Propagated to {propagate_count} agents."
    }

class ValidateConfigPayload(BaseModel):
    config: str

@router.post("/api/opamp/validate_config")
def validate_otel_config(payload: ValidateConfigPayload, current_user = Depends(verify_any_role)):
    try:
        parsed = yaml.safe_load(payload.config)
        if not isinstance(parsed, dict):
            return {"valid": False, "error": "Configuration must be a key-value YAML object"}
            
        required_keys = ["receivers", "processors", "exporters", "service"]
        missing = [k for k in required_keys if k not in parsed]
        if missing:
            return {"valid": False, "error": f"Missing top-level OTel collector sections: {', '.join(missing)}"}
            
        return {"valid": True, "message": "Valid OpenTelemetry configuration structure."}
    except Exception as e:
        return {"valid": False, "error": f"YAML Parsing Error: {str(e)}"}
