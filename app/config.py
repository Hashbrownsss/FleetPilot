import os

class Settings:
    # OpAMP Server connection
    OPAMP_SERVER_URL = os.getenv("OPAMP_SERVER_URL", "http://127.0.0.1:4321")
    
    # SQLite Database connection
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///opamp.db")
    
    # Kafka Broker connection
    KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9094")
    
    # Secret keys and sessions
    JWT_SECRET = os.getenv("JWT_SECRET", "AIOPs_WT_Key_456!")
    JWT_ALGORITHM = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 24 hours
    
    # Keycloak SSO Configurations
    KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://localhost:8080")
    KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "aiops-realm")
    KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "aiops-portal")
    
    # Telemetry and ML History
    HISTORY_FILE = "ml_history.json"
    ANOMALIES_LOG_FILE = "anomalies_log.json"
    SERVICENOW_INCIDENTS_FILE = "servicenow_incidents.json"
    
settings = Settings()
