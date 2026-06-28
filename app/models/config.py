from sqlalchemy import Column, Integer, String, Text, Float, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class Configuration(Base):
    __tablename__ = "configurations"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    description = Column(String, default="")
    platform = Column(String, default="Cross-Platform")
    version = Column(Integer, default=1)
    
    # Relationship to revisions (ordered by version)
    revisions = relationship("ConfigurationRevision", back_populates="configuration", cascade="all, delete-orphan", order_by="ConfigurationRevision.version")

class ConfigurationRevision(Base):
    __tablename__ = "configuration_revisions"
    
    id = Column(Integer, primary_key=True, index=True)
    config_id = Column(Integer, ForeignKey("configurations.id", ondelete="CASCADE"), nullable=False)
    version = Column(Integer, nullable=False)
    timestamp = Column(Float, nullable=False)
    config = Column(Text, nullable=False)
    description = Column(String, default="")
    author = Column(String, default="admin")
    
    configuration = relationship("Configuration", back_populates="revisions")
