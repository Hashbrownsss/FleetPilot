from sqlalchemy import Column, Integer, String
from app.database import Base

class Fleet(Base):
    __tablename__ = "fleets"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    description = Column(String, default="")
    config_name = Column(String, default="Default")
