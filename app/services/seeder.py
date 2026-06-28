import os
import json
import time
import hashlib
from sqlalchemy.orm import Session
from app.database import engine, Base, SessionLocal
from app.models.auth import User
from app.models.config import Configuration, ConfigurationRevision
from app.models.fleet import Fleet
from app.models.agent import Agent

DEFAULT_TEMPLATES = {
    "Default": """receivers:
  hostmetrics:
    collection_interval: 10s
    scrapers:
      cpu:
      memory:
      disk:
      network:
      processes:
exporters:
  otlp:
    endpoint: "localhost:4317"
service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: []
      exporters: [otlp]""",
    "Database-Nodes": """receivers:
  hostmetrics:
    collection_interval: 5s
    scrapers:
      cpu:
      memory:
      disk:
      network:
      processes:
  postgresql:
    endpoint: "localhost:5432"
    username: "postgres"
exporters:
  otlp:
    endpoint: "localhost:4317"
service:
  pipelines:
    metrics:
      receivers: [hostmetrics, postgresql]
      processors: []
      exporters: [otlp]""",
    "Web-Servers": """receivers:
  hostmetrics:
    collection_interval: 15s
    scrapers:
      cpu:
      memory:
      disk:
      network:
      processes:
  nginx:
    endpoint: "http://localhost:80/status"
exporters:
  otlp:
    endpoint: "localhost:4317"
service:
  pipelines:
    metrics:
      receivers: [hostmetrics, nginx]
      processors: []
      exporters: [otlp]"""
}

def hash_password(password: str, salt: str = "AIOps_Salt_123!") -> str:
    return hashlib.sha256((password + salt).encode('utf-8')).hexdigest()

def seed_database():
    # 1. Create SQL tables
    Base.metadata.create_all(bind=engine)
    
    db: Session = SessionLocal()
    try:
        # 2. Seed Default Users
        if db.query(User).count() == 0:
            print("DB Seeder: Seeding users...")
            # Try to load existing users.json
            loaded = False
            if os.path.exists("users.json"):
                try:
                    with open("users.json", "r") as f:
                        users_data = json.load(f)
                    for k, u in users_data.items():
                        user_obj = User(
                            username=u["username"],
                            password_hash=u["password_hash"],
                            role=u["role"]
                        )
                        db.add(user_obj)
                    loaded = True
                    print(f"DB Seeder: Imported {len(users_data)} users from users.json")
                except Exception as e:
                    print(f"DB Seeder: Error reading users.json: {e}")
            
            if not loaded:
                admin = User(username="admin", password_hash=hash_password("admin123"), role="admin")
                user = User(username="user", password_hash=hash_password("user123"), role="user")
                db.add(admin)
                db.add(user)
                print("DB Seeder: Created default admin/user accounts")
            db.commit()

        # 3. Seed Default Configurations & Revisions
        if db.query(Configuration).count() == 0:
            print("DB Seeder: Seeding configurations...")
            # Try to load existing configurations_store.json
            loaded = False
            if os.path.exists("configurations_store.json"):
                try:
                    with open("configurations_store.json", "r") as f:
                        configs_data = json.load(f)
                    for name, data in configs_data.items():
                        config_obj = Configuration(
                            name=data["name"],
                            description=data.get("description", ""),
                            platform=data.get("platform", "Cross-Platform"),
                            version=data.get("version", 1)
                        )
                        db.add(config_obj)
                        db.flush() # get config_obj.id
                        
                        for r in data.get("revisions", []):
                            rev = ConfigurationRevision(
                                config_id=config_obj.id,
                                version=r["version"],
                                timestamp=r.get("timestamp", time.time()),
                                config=r["config"],
                                description=r.get("description", "Imported configuration"),
                                author=r.get("author", "system")
                            )
                            db.add(rev)
                    loaded = True
                    print(f"DB Seeder: Imported {len(configs_data)} configurations from configurations_store.json")
                except Exception as e:
                    print(f"DB Seeder: Error reading configurations_store.json: {e}")
            
            if not loaded:
                for name, yaml_str in DEFAULT_TEMPLATES.items():
                    desc = "Standard host metrics." if name == "Default" else f"Scrapers configuration optimized for {name}."
                    platform = "Cross-Platform" if name == "Default" else "Linux"
                    config_obj = Configuration(
                        name=name,
                        description=desc,
                        platform=platform,
                        version=1
                    )
                    db.add(config_obj)
                    db.flush()
                    
                    rev = ConfigurationRevision(
                        config_id=config_obj.id,
                        version=1,
                        timestamp=time.time(),
                        config=yaml_str,
                        description="Initial template generation",
                        author="system"
                    )
                    db.add(rev)
                print("DB Seeder: Created default configurations templates")
            db.commit()

        # 4. Seed Default Fleets
        if db.query(Fleet).count() == 0:
            print("DB Seeder: Seeding fleets...")
            loaded = False
            if os.path.exists("fleets_store.json"):
                try:
                    with open("fleets_store.json", "r") as f:
                        fleets_data = json.load(f)
                    # fleets_store maps fleet_name -> {"name": str, "description": str, "config_name": str, "agent_ids": list}
                    for f_name, f_val in fleets_data.items():
                        fleet_obj = Fleet(
                            name=f_val["name"],
                            description=f_val.get("description", ""),
                            config_name=f_val.get("config_name", "Default")
                        )
                        db.add(fleet_obj)
                    loaded = True
                    print(f"DB Seeder: Imported {len(fleets_data)} fleets from fleets_store.json")
                except Exception as e:
                    print(f"DB Seeder: Error reading fleets_store.json: {e}")
            
            if not loaded:
                for name in ["Default", "Database-Nodes", "Web-Servers"]:
                    desc = f"Group cluster monitoring for {name} nodes."
                    fleet_obj = Fleet(name=name, description=desc, config_name=name)
                    db.add(fleet_obj)
                print("DB Seeder: Created Default, Database-Nodes, and Web-Servers fleets")
            db.commit()

        # 5. Migrate Agents from groups_store.json
        if db.query(Agent).count() == 0:
            print("DB Seeder: Migrating agents...")
            if os.path.exists("groups_store.json"):
                try:
                    with open("groups_store.json", "r") as f:
                        groups_data = json.load(f)
                    agents_dict = groups_data.get("agents", {})
                    for aid, a in agents_dict.items():
                        # Map groups to fleet_name
                        fleet_name = "Default"
                        if a.get("groups") and len(a["groups"]) > 0:
                            fleet_name = a["groups"][0]
                            
                        agent_obj = Agent(
                            id=a["id"],
                            name=a["name"],
                            status=a.get("status", "Healthy"),
                            os=a.get("os", "linux"),
                            ip=a.get("ip", "127.0.0.1"),
                            type=a.get("type", "virtual"),
                            environment=a.get("environment", "dev"),
                            region=a.get("region", "us"),
                            deployment_type=a.get("deployment_type", "on-prem"),
                            custom_config_override=a.get("custom_config_override", ""),
                            fleet_name=fleet_name,
                            last_seen=time.time()
                        )
                        db.add(agent_obj)
                    db.commit()
                    print(f"DB Seeder: Migrated {len(agents_dict)} agents to SQLite agents table")
                except Exception as e:
                    print(f"DB Seeder: Error migrating agents: {e}")

    finally:
        db.close()
