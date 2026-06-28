from sqlalchemy import Column, Integer, String, Float, Text
from app.database import Base

class Anomaly(Base):
    __tablename__ = "anomalies"
    
    id = Column(String, primary_key=True, index=True)
    timestamp = Column(Float, nullable=False, index=True)
    metric = Column(String, nullable=False, index=True)
    value = Column(Float, nullable=True)
    expected = Column(Float, nullable=True)
    anomaly_type = Column(String, nullable=True)
    severity = Column(String, default="warning")
    z_score = Column(Float, nullable=True)
    description = Column(Text, default="")
    tally_count = Column(Integer, default=1)
