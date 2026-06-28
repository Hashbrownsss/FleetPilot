from sqlalchemy import Column, Integer, String, Text, Float
from app.database import Base

class AuditLog(Base):
    __tablename__ = "audit_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(Float, nullable=False)
    username = Column(String, index=True, nullable=False)
    action = Column(String, index=True, nullable=False)
    target = Column(String, default="")
    details = Column(Text, default="")
    ip_address = Column(String, default="")
