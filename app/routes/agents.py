from app.models.config import ConfigurationRevision
import os
import time
import json
import requests
import yaml
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from html.parser import HTMLParser
from app.database import get_db
from app.config import settings
from app.models.agent import Agent
from app.models.config import Configuration, ConfigurationRevision
from app.routes.auth import verify_admin_role, verify_any_role
from app.services.config_utils import merge_otel_configs, validate_config_guards
from app.services.audit import log_audit

router = APIRouter(tags=["agents"])

# ----------------------------------------------------
# OpAMP Server HTML Parsers
# ----------------------------------------------------
class RootHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.agents = []
    
    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            attrs_dict = dict(attrs)
            href = attrs_dict.get('href', '')
            if 'instanceid=' in href:
                instance_id = href.split('instanceid=')[-1]
                self.agents.append(instance_id)

class HeaderDrivenParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.current_header = ""
        self.in_h3 = False
        self.in_table = False
        self.in_td = False
        self.in_pre = False
        self.in_textarea = False
        self.in_span = False
        self.current_table = []
        self.current_row = []
        self.current_data = ""
        
        # Parsed sections
        self.agent_details = {}
        self.attributes = {}
        self.effective_config = ""
        self.custom_config = ""
        self.client_cert = {}
        self.custom_messages = []
        self.current_textarea_name = ""
        self.config_error = ""
        self.cert_error = ""
        self.health_error = ""

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        if tag in ('h3', 'h4'):
            self.in_h3 = True
            self.current_data = ""
        elif tag == 'table':
            self.in_table = True
            self.current_table = []
            self.current_row = []
        elif tag == 'td' and self.in_table:
            self.in_td = True
            self.current_data = ""
        elif tag == 'pre':
            self.in_pre = True
            self.current_data = ""
        elif tag == 'textarea':
            self.in_textarea = True
            self.current_textarea_name = attrs_dict.get('name', '')
            self.current_data = ""
        elif tag == 'span':
            self.in_span = True
            self.current_data = ""

    def handle_endtag(self, tag):
        if tag in ('h3', 'h4'):
            self.in_h3 = False
            self.current_header = self.current_data.strip()
        elif tag == 'table':
            self.in_table = False
            if self.current_row:
                self.current_table.append(self.current_row)
                self.current_row = []
            
            # Store parsed table data based on current header
            if self.current_header == "Agent":
                for row in self.current_table:
                    if len(row) >= 2:
                        key = row[0].replace(":", "").strip()
                        self.agent_details[key] = row[1].strip()
            elif self.current_header == "Attributes":
                for row in self.current_table:
                    if len(row) >= 2:
                        val = row[1].strip()
                        if val.startswith('string_value:"') and val.endswith('"'):
                            val = val[14:-1]
                        self.attributes[row[0].strip()] = val
            elif self.current_header == "Client Certificate":
                for row in self.current_table:
                    if len(row) >= 2:
                        key = row[0].replace(":", "").strip()
                        self.client_cert[key] = row[1].strip()
                    elif len(row) == 1:
                        self.client_cert["status"] = row[0].strip()
        elif tag == 'td' and self.in_table:
            self.in_td = False
            self.current_row.append(self.current_data.strip())
            if len(self.current_row) == 2:
                self.current_table.append(self.current_row)
                self.current_row = []
        elif tag == 'pre':
            self.in_pre = False
            if self.current_header == "Configuration":
                self.effective_config = self.current_data.strip()
            elif self.current_header == "Received Messages":
                self.custom_messages = [line.strip() for line in self.current_data.split('\n') if line.strip()]
        elif tag == 'textarea':
            self.in_textarea = False
            if self.current_textarea_name == 'config':
                self.custom_config = self.current_data.strip()
        elif tag == 'span':
            self.in_span = False
            text = self.current_data.strip()
            if self.current_header == "Agent":
                self.health_error = text
            elif text.startswith("Failed:"):
                self.config_error = text.replace("Failed:", "").strip()
            elif text.startswith("Cannot apply offered certificate:"):
                self.cert_error = text.replace("Cannot apply offered certificate:", "").strip()

    def handle_data(self, data):
        if self.in_h3:
            self.current_data += data
        elif self.in_td and self.in_table:
            self.current_data += data
        elif self.in_pre:
            self.current_data += data
        elif self.in_textarea:
            self.current_data += data
        elif self.in_span:
            self.current_data += data

# ----------------------------------------------------
# Configuration History Helpers
# ----------------------------------------------------
def log_config_history(instance_id: str, config: str, author: str):
    history_file = "config_history.json"
    try:
        if os.path.exists(history_file):
            with open(history_file, "r") as f:
                history = json.load(f)
        else:
            history = []
    except:
        history = []
        
    revision = len(history) + 1
    history.append({
        "revision": revision,
        "timestamp": time.time(),
        "target_id": instance_id,
        "config": config,
        "author": author
    })
    try:
        with open(history_file, "w") as f:
            json.dump(history, f, indent=2)
    except Exception as e:
        print(f"Failed to log config history: {e}")

# ----------------------------------------------------
# API Endpoints
# ----------------------------------------------------
@router.get("/api/opamp/agents")
def get_opamp_agents(
    group: str = None,
    environment: str = None,
    region: str = None,
    deployment_type: str = None,
    os: str = None,
    db: Session = Depends(get_db),
    current_user = Depends(verify_any_role)
):
    physical_ids = []
    try:
        res = requests.get(f"{settings.OPAMP_SERVER_URL}/", timeout=2.0)
        if res.status_code == 200:
            parser = RootHTMLParser()
            parser.feed(res.text)
            physical_ids = parser.agents
    except Exception as e:
        print(f"Backend: Failed to proxy agents list from OpAMP: {e}")
        # Fallback to physical agents currently in the database
        db_phys = db.query(Agent).filter(Agent.type == "physical").all()
        physical_ids = [a.id for a in db_phys]

    # Synchronize physical agents with the database
    for pid in physical_ids:
        agent = db.query(Agent).filter(Agent.id == pid).first()
        if not agent:
            agent = Agent(
                id=pid,
                name=f"physical-agent-{pid[:8]}",
                fleet_name="Default",
                status="Healthy",
                os="windows",
                ip="127.0.0.1",
                type="physical",
                environment="prod",
                region="apac",
                deployment_type="on-prem",
                custom_config_override="",
                last_seen=time.time()
            )
            db.add(agent)
            db.commit()

    all_agents = db.query(Agent).all()
    filtered = []
    for a in all_agents:
        # Compatibility mapping for groups (frontend expects a list)
        groups_list = [a.fleet_name] if a.fleet_name else ["Default"]
        
        # Apply filtering
        if group and group not in groups_list:
            continue
        if environment and a.environment != environment:
            continue
        if region and a.region != region:
            continue
        if deployment_type and a.deployment_type != deployment_type:
            continue
        if os and a.os != os:
            continue
            
        filtered.append({
            "id": a.id,
            "name": a.name,
            "groups": groups_list,
            "status": a.status,
            "os": a.os,
            "ip": a.ip,
            "type": a.type,
            "environment": a.environment,
            "region": a.region,
            "deployment_type": a.deployment_type,
            "custom_config_override": a.custom_config_override
        })

    return {"agents": filtered}

@router.get("/api/opamp/agent/{instance_id}")
def get_opamp_agent_details(instance_id: str, db: Session = Depends(get_db), current_user = Depends(verify_any_role)):
    agent = db.query(Agent).filter(Agent.id == instance_id).first()
    if not agent:
        agent = Agent(
            id=instance_id,
            name=f"agent-{instance_id[:8]}",
            fleet_name="Default",
            status="Healthy",
            os="windows",
            ip="127.0.0.1",
            type="physical",
            environment="prod",
            region="apac",
            deployment_type="on-prem",
            custom_config_override="",
            last_seen=time.time()
        )
        db.add(agent)
        db.commit()
        db.refresh(agent)

    # Fetch configuration templates
    configs = db.query(Configuration).all()
    templates = {}
    for c in configs:
        sorted_revs = sorted(c.revisions, key=lambda x: x.version)
        templates[c.name] = sorted_revs[-1].config if sorted_revs else ""

    group_names = [agent.fleet_name] if agent.fleet_name else ["Default"]
    group_base_config = ""
    for g in group_names:
        base = templates.get(g, "")
        if base:
            group_base_config = merge_otel_configs(group_base_config, base)

    real_details = {
        "details": {},
        "attributes": {},
        "effective_config": "",
        "custom_config": "",
        "client_cert": {},
        "custom_messages": [],
        "config_error": "",
        "cert_error": "",
        "health_error": ""
    }
    try:
        res = requests.get(f"{settings.OPAMP_SERVER_URL}/agent?instanceid={instance_id}", timeout=2.0)
        if res.status_code == 200:
            parser = HeaderDrivenParser()
            parser.feed(res.text)
            real_details = {
                "details": parser.agent_details,
                "attributes": parser.attributes,
                "effective_config": parser.effective_config,
                "custom_config": parser.custom_config,
                "client_cert": parser.client_cert,
                "custom_messages": parser.custom_messages,
                "config_error": parser.config_error,
                "cert_error": parser.cert_error,
                "health_error": parser.health_error
            }
    except Exception as e:
        print(f"Backend: Failed to fetch physical agent details from OpAMP: {e}")

    custom_config = agent.custom_config_override if agent.custom_config_override else real_details.get("custom_config", "")
    effective_config = merge_otel_configs(group_base_config, custom_config)

    real_details["details"]["Groups"] = group_names
    real_details["details"]["Type"] = "Physical Agent"
    real_details["details"]["Environment"] = agent.environment
    real_details["details"]["Region"] = agent.region
    real_details["details"]["Deployment Type"] = agent.deployment_type
    real_details["details"]["OS"] = agent.os
    real_details["details"]["Version"] = real_details.get("attributes", {}).get("service.version", "0.153.0")
    real_details["group_config"] = group_base_config
    real_details["custom_config"] = custom_config
    real_details["effective_config"] = effective_config
    return real_details

class ConfigPayload(BaseModel):
    config: str

@router.post("/api/opamp/agent/{instance_id}/config")
def save_agent_config(instance_id: str, payload: ConfigPayload, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    agent = db.query(Agent).filter(Agent.id == instance_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found in registry")

    agent_os = agent.os or "linux"
    env = agent.environment or "dev"

    # Fetch configuration templates
    configs = db.query(Configuration).all()
    templates = {}
    for c in configs:
        sorted_revs = sorted(c.revisions, key=lambda x: x.version)
        templates[c.name] = sorted_revs[-1].config if sorted_revs else ""

    group_names = [agent.fleet_name] if agent.fleet_name else ["Default"]
    group_base = ""
    for g in group_names:
        base = templates.get(g, "")
        if base:
            group_base = merge_otel_configs(group_base, base)
            
    effective_config = merge_otel_configs(group_base, payload.config)

    # Perform Guard Verification
    guard_error = validate_config_guards(effective_config, agent_os, env)
    if guard_error:
        raise HTTPException(status_code=400, detail=guard_error)

    agent.custom_config_override = payload.config
    db.commit()
    
    # Log this config deployment to history for rollbacks
    log_config_history(instance_id, payload.config, current_user.get("username", "admin"))

    if agent.type == "physical":
        try:
            data = {"instanceid": instance_id, "config": effective_config}
            res = requests.post(f"{settings.OPAMP_SERVER_URL}/save_config", data=data, timeout=6.0)
            if res.status_code not in (200, 303):
                raise HTTPException(status_code=res.status_code, detail="Failed to save physical config on OpAMP server.")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Proxy error writing physical agent config: {e}")

    return {"status": "success", "message": f"Configuration updated successfully for agent {instance_id}."}

class RollbackPayload(BaseModel):
    revision: int

@router.post("/api/opamp/agent/{instance_id}/rollback")
def rollback_agent_config(instance_id: str, payload: RollbackPayload, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    history_file = "config_history.json"
    if not os.path.exists(history_file):
        raise HTTPException(status_code=404, detail="No configuration history found.")
        
    try:
        with open(history_file, "r") as f:
            history = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read configuration history: {e}")

    target_entry = None
    for entry in history:
        if entry.get("revision") == payload.revision and entry.get("target_id") == instance_id:
            target_entry = entry
            break

    if not target_entry:
        raise HTTPException(status_code=404, detail=f"Revision {payload.revision} not found for agent {instance_id}")

    agent = db.query(Agent).filter(Agent.id == instance_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found in registry")

    target_config = target_entry.get("config", "")
    agent_os = agent.os or "linux"
    env = agent.environment or "dev"

    # Fetch templates
    configs = db.query(Configuration).all()
    templates = {}
    for c in configs:
        sorted_revs = sorted(c.revisions, key=lambda x: x.version)
        templates[c.name] = sorted_revs[-1].config if sorted_revs else ""

    group_names = [agent.fleet_name] if agent.fleet_name else ["Default"]
    group_base = ""
    for g in group_names:
        base = templates.get(g, "")
        if base:
            group_base = merge_otel_configs(group_base, base)

    effective_config = merge_otel_configs(group_base, target_config)

    # Perform Guard Verification
    guard_error = validate_config_guards(effective_config, agent_os, env)
    if guard_error:
        raise HTTPException(status_code=400, detail=f"Rollback blocked by safety guards: {guard_error}")

    agent.custom_config_override = target_config
    db.commit()
    
    # Log the rollback as a new history record
    log_config_history(instance_id, target_config, f"{current_user.get('username', 'admin')} (Rollback to Rev {payload.revision})")

    if agent.type == "physical":
        try:
            data = {"instanceid": instance_id, "config": effective_config}
            res = requests.post(f"{settings.OPAMP_SERVER_URL}/save_config", data=data, timeout=6.0)
            if res.status_code not in (200, 303):
                raise HTTPException(status_code=res.status_code, detail="Failed to save physical config during rollback on OpAMP server.")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Proxy error deploying physical agent rollback config: {e}")

    return {"status": "success", "message": f"Successfully rolled back configuration for agent {instance_id} to revision {payload.revision}."}

class ChangeGroupsPayload(BaseModel):
    groups: list

@router.post("/api/opamp/agent/{instance_id}/group")
def change_agent_group(instance_id: str, payload: ChangeGroupsPayload, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    agent = db.query(Agent).filter(Agent.id == instance_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found in registry")

    # Fetch configuration templates to check valid groups
    configs = db.query(Configuration).all()
    available_groups = [c.name for c in configs]
    
    for g in payload.groups:
        if g not in available_groups:
            raise HTTPException(status_code=400, detail=f"Invalid group '{g}'. Available groups: {available_groups}")

    # Set new group (we take first group as fleet_name)
    agent.fleet_name = payload.groups[0] if payload.groups else "Default"
    db.commit()

    if agent.type == "physical":
        templates = {}
        for c in configs:
            sorted_revs = sorted(c.revisions, key=lambda x: x.version)
            templates[c.name] = sorted_revs[-1].config if sorted_revs else ""

        group_base = ""
        for g in payload.groups:
            base = templates.get(g, "")
            if base:
                group_base = merge_otel_configs(group_base, base)
                
        custom_config = agent.custom_config_override or ""
        effective_config = merge_otel_configs(group_base, custom_config)
        try:
            data = {"instanceid": instance_id, "config": effective_config}
            requests.post(f"{settings.OPAMP_SERVER_URL}/save_config", data=data, timeout=6.0)
        except Exception as e:
            print(f"Backend: Failed to apply physical agent config on group change: {e}")

    ip = request.client.host if request.client else "unknown"
    user = current_user.get("username", "admin")
    log_audit(db, username=user, action="UPDATE_AGENT", target=instance_id, details=f"Moved agent to groups: {payload.groups}.", ip_address=ip)

    return {"status": "success", "message": f"Agent {instance_id} moved to groups {payload.groups}."}

class EnvironmentPayload(BaseModel):
    environment: str

@router.post("/api/opamp/agent/{instance_id}/environment")
def change_agent_environment(instance_id: str, payload: EnvironmentPayload, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    agent = db.query(Agent).filter(Agent.id == instance_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found in registry")

    if payload.environment not in ("dev", "uat", "prod"):
        raise HTTPException(status_code=400, detail="Invalid environment: must be dev, uat, or prod")

    agent.environment = payload.environment
    db.commit()
    
    ip = request.client.host if request.client else "unknown"
    user = current_user.get("username", "admin")
    log_audit(db, username=user, action="UPDATE_AGENT", target=instance_id, details=f"Changed agent environment to '{payload.environment}'.", ip_address=ip)

    return {"status": "success", "message": f"Agent {instance_id} environment updated to {payload.environment}."}

class OSPayload(BaseModel):
    os: str

@router.post("/api/opamp/agent/{instance_id}/os")
def change_agent_os(instance_id: str, payload: OSPayload, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    agent = db.query(Agent).filter(Agent.id == instance_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found in registry")

    if payload.os not in ("windows", "linux", "mac"):
        raise HTTPException(status_code=400, detail="Invalid OS: must be windows, linux, or mac")

    agent.os = payload.os
    db.commit()
    
    ip = request.client.host if request.client else "unknown"
    user = current_user.get("username", "admin")
    log_audit(db, username=user, action="UPDATE_AGENT", target=instance_id, details=f"Changed agent OS type to '{payload.os}'.", ip_address=ip)

    return {"status": "success", "message": f"Agent {instance_id} OS type updated to {payload.os}."}

class StatusPayload(BaseModel):
    status: str

@router.post("/api/opamp/agent/{instance_id}/status")
def change_agent_status(instance_id: str, payload: StatusPayload, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    agent = db.query(Agent).filter(Agent.id == instance_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found in registry")

    if payload.status not in ("Healthy", "Warning", "Offline"):
        raise HTTPException(status_code=400, detail="Invalid status: must be Healthy, Warning, or Offline")

    agent.status = payload.status
    db.commit()

    ip = request.client.host if request.client else "unknown"
    user = current_user.get("username", "admin")
    log_audit(db, username=user, action="UPDATE_AGENT_STATUS", target=instance_id, details=f"Changed agent status to '{payload.status}'.", ip_address=ip)

    return {"status": "success", "message": f"Agent {instance_id} status updated to {payload.status}."}

@router.get("/api/opamp/groups")
def get_groups_list(db: Session = Depends(get_db), current_user = Depends(verify_any_role)):
    configs = db.query(Configuration).all()
    return {"groups": [c.name for c in configs]}

@router.get("/api/opamp/templates")
def get_templates(db: Session = Depends(get_db), current_user = Depends(verify_any_role)):
    configs = db.query(Configuration).all()
    templates = {}
    for c in configs:
        sorted_revs = sorted(c.revisions, key=lambda x: x.version)
        templates[c.name] = sorted_revs[-1].config if sorted_revs else ""
    return templates

class TemplatePayload(BaseModel):
    template: str

@router.post("/api/opamp/group/{group_name}/template")
def update_group_template(group_name: str, payload: TemplatePayload, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    config_obj = db.query(Configuration).filter(Configuration.name == group_name).first()
    if not config_obj:
        # Create it if it doesn't exist
        config_obj = Configuration(name=group_name, description="", platform="Cross-Platform", version=1)
        db.add(config_obj)
        db.flush()
        new_rev = ConfigurationRevision(
            config_id=config_obj.id, version=1, timestamp=time.time(),
            config=payload.template, description="Updated group template", author="admin"
        )
        db.add(new_rev)
    else:
        next_ver = config_obj.version + 1
        config_obj.version = next_ver
        new_rev = ConfigurationRevision(
            config_id=config_obj.id, version=next_ver, timestamp=time.time(),
            config=payload.template, description="Updated group template", author="admin"
        )
        db.add(new_rev)
    db.commit()

    # Re-apply to physical agents
    configs = db.query(Configuration).all()
    templates = {}
    for c in configs:
        sorted_revs = sorted(c.revisions, key=lambda x: x.version)
        templates[c.name] = sorted_revs[-1].config if sorted_revs else ""

    agents = db.query(Agent).filter(Agent.fleet_name == group_name).all()
    for a in agents:
        if a.type == "physical":
            group_base = ""
            # Remerge groups base config (here we just have fleet_name)
            group_names = [a.fleet_name] if a.fleet_name else ["Default"]
            for g in group_names:
                base = templates.get(g, "")
                if base:
                    group_base = merge_otel_configs(group_base, base)
            custom_config = a.custom_config_override or ""
            effective_config = merge_otel_configs(group_base, custom_config)
            try:
                data = {"instanceid": a.id, "config": effective_config}
                requests.post(f"{settings.OPAMP_SERVER_URL}/save_config", data=data, timeout=6.0)
            except Exception as e:
                print(f"Backend: Failed to apply updated template to physical agent {a.id}: {e}")

    ip = request.client.host if request.client else "unknown"
    user = current_user.get("username", "admin")
    log_audit(db, username=user, action="UPDATE_GROUP_TEMPLATE", target=group_name, details="Updated template for group.", ip_address=ip)

    return {"status": "success", "message": f"Template updated for group {group_name} and propagated to physical nodes."}

class BulkApplyPayload(BaseModel):
    agent_ids: list
    group: str

@router.post("/api/opamp/groups/bulk_apply_template")
def bulk_apply_template(payload: BulkApplyPayload, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    config_obj = db.query(Configuration).filter(Configuration.name == payload.group).first()
    if not config_obj:
        raise HTTPException(status_code=400, detail=f"Invalid group: {payload.group}")

    db.query(Agent).filter(Agent.id.in_(payload.agent_ids)).update(
        {Agent.fleet_name: payload.group}, synchronize_session=False
    )
    db.commit()

    # Propagation loop
    sorted_revs = sorted(config_obj.revisions, key=lambda x: x.version)
    group_base = sorted_revs[-1].config if sorted_revs else ""

    agents = db.query(Agent).filter(Agent.id.in_(payload.agent_ids)).all()
    updated_count = len(agents)
    
    for a in agents:
        if a.type == "physical":
            custom_config = a.custom_config_override or ""
            effective_config = merge_otel_configs(group_base, custom_config)
            try:
                data = {"instanceid": a.id, "config": effective_config}
                requests.post(f"{settings.OPAMP_SERVER_URL}/save_config", data=data, timeout=6.0)
            except Exception as e:
                print(f"Backend: Bulk apply propagation failed for physical agent {a.id}: {e}")

    ip = request.client.host if request.client else "unknown"
    user = current_user.get("username", "admin")
    log_audit(db, username=user, action="BULK_APPLY_TEMPLATE", target=payload.group, details=f"Applied group template to agents: {', '.join(payload.agent_ids)}", ip_address=ip)

    return {"status": "success", "message": f"Successfully moved {updated_count} agents to group {payload.group}."}

@router.get("/api/opamp/config_history/{instance_id}")
def get_config_history(instance_id: str, current_user = Depends(verify_any_role)):
    history_file = "config_history.json"
    if not os.path.exists(history_file):
        return []
    try:
        with open(history_file, "r") as f:
            history = json.load(f)
        return [h for h in history if h.get("target_id") == instance_id]
    except:
        return []

@router.post("/api/opamp/agent/{instance_id}/rotate_cert")
def rotate_agent_cert(instance_id: str, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    agent = db.query(Agent).filter(Agent.id == instance_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    try:
        data = {"instanceid": instance_id}
        res = requests.post(f"{settings.OPAMP_SERVER_URL}/rotate_client_cert", data=data, timeout=6.0)
        if res.status_code not in (200, 303):
            raise HTTPException(status_code=res.status_code, detail="Failed to rotate certificate.")

        ip = request.client.host if request.client else "unknown"
        user = current_user.get("username", "admin")
        log_audit(db, username=user, action="ROTATE_AGENT_CERT", target=instance_id, details="Initiated client certificate rotation.", ip_address=ip)

        return {"status": "success", "message": "Client certificate offered and rotated."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ConnectionSettingsPayload(BaseModel):
    tls_min: str
    proxy_url: str = ""

@router.post("/api/opamp/agent/{instance_id}/connection_settings")
def set_connection_settings(instance_id: str, payload: ConnectionSettingsPayload, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    agent = db.query(Agent).filter(Agent.id == instance_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    try:
        data = {
            "instanceid": instance_id,
            "tls_min": payload.tls_min,
            "proxy_url": payload.proxy_url
        }
        res = requests.post(f"{settings.OPAMP_SERVER_URL}/opamp_connection_settings", data=data, timeout=6.0)
        if res.status_code not in (200, 303):
            raise HTTPException(status_code=res.status_code, detail="Failed to set connection settings.")
        
        ip = request.client.host if request.client else "unknown"
        user = current_user.get("username", "admin")
        log_audit(db, username=user, action="SET_CONNECTION_SETTINGS", target=instance_id, details=f"Set connection settings: tls_min={payload.tls_min}, proxy_url={payload.proxy_url}", ip_address=ip)

        return {"status": "success", "message": "Connection settings applied."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class CustomMessagePayload(BaseModel):
    capability: str
    type: str
    data: str = ""

@router.post("/api/opamp/agent/{instance_id}/custom_message")
def send_custom_message(instance_id: str, payload: CustomMessagePayload, request: Request, db: Session = Depends(get_db), current_user = Depends(verify_admin_role)):
    agent = db.query(Agent).filter(Agent.id == instance_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    try:
        data = {
            "instanceid": instance_id,
            "capability": payload.capability,
            "type": payload.type,
            "data": payload.data
        }
        res = requests.post(f"{settings.OPAMP_SERVER_URL}/send_custom_message", data=data, timeout=6.0)
        if res.status_code not in (200, 303):
            raise HTTPException(status_code=res.status_code, detail="Failed to send custom message.")
        
        ip = request.client.host if request.client else "unknown"
        user = current_user.get("username", "admin")
        log_audit(db, username=user, action="SEND_CUSTOM_MESSAGE", target=instance_id, details=f"Sent custom message: capability={payload.capability}, type={payload.type}", ip_address=ip)

        return {"status": "success", "message": "Custom message successfully queued to agent."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/opamp/ack/{agent_name}")
def get_agent_ack(agent_name: str, db: Session = Depends(get_db), current_user = Depends(verify_any_role)):
    norm_target = agent_name.lower().replace(" ", "").replace("-", "").replace("_", "")
    
    # Try exact match first
    agent = db.query(Agent).filter(Agent.name == agent_name).first()
    if not agent:
        agent = db.query(Agent).filter(Agent.id == agent_name).first()
        
    # If not found, fuzzy match all agents
    if not agent:
        all_agents = db.query(Agent).all()
        for a in all_agents:
            norm_a_name = a.name.lower().replace(" ", "").replace("-", "").replace("_", "")
            norm_a_id = a.id.lower().replace("-", "")
            if norm_target in norm_a_name or norm_target in norm_a_id:
                agent = a
                break

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
        
    is_healthy = agent.status == "Healthy"
    return {
        "status": "acknowledged" if is_healthy else "pending",
        "acknowledged": is_healthy
    }

