import time
from sqlalchemy import Column, String, Text, Float
from app.database import Base

class Agent(Base):
    __tablename__ = "agents"
    
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    status = Column(String, default="Offline")
    os = Column(String, default="linux")
    ip = Column(String, default="127.0.0.1")
    type = Column(String, default="virtual")
    environment = Column(String, default="dev")
    region = Column(String, default="us")
    deployment_type = Column(String, default="on-prem")
    custom_config_override = Column(Text, default="")
    fleet_name = Column(String, default="Default")
    last_seen = Column(Float, default=time.time)
