import uuid
import hashlib
import time
# pyrefly: ignore [missing-import]
import jwt
import requests
# pyrefly: ignore [missing-import]
from jwt.algorithms import RSAAlgorithm
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, Depends, Header, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.auth import User
from app.services.audit import log_audit
from app.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

def create_local_jwt(username: str, role: str) -> str:
    payload = {
        "username": username,
        "role": role,
        "exp": time.time() + (settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

def verify_local_jwt(token: str):
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM]
        )
        return {
            "username": payload.get("username"),
            "role": payload.get("role"),
            "provider": "local"
        }
    except Exception:
        return None

# In-memory JWKS cache
_jwks_cache = None
_jwks_last_fetched = 0
JWKS_CACHE_TTL = 300  # 5 minutes

def get_keycloak_jwks():
    global _jwks_cache, _jwks_last_fetched
    now = time.time()
    if _jwks_cache and (now - _jwks_last_fetched < JWKS_CACHE_TTL):
        return _jwks_cache
        
    try:
        url = f"{settings.KEYCLOAK_URL}/realms/{settings.KEYCLOAK_REALM}/protocol/openid-connect/certs"
        res = requests.get(url, timeout=3.0)
        if res.status_code == 200:
            _jwks_cache = res.json()
            _jwks_last_fetched = now
            return _jwks_cache
    except Exception as e:
        print(f"Auth: Failed to fetch Keycloak JWKS from {settings.KEYCLOAK_URL}: {e}")
    return _jwks_cache or {"keys": []}

def verify_keycloak_jwt(token: str):
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        if not kid:
            return None
            
        jwks = get_keycloak_jwks()
        key_data = None
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                key_data = key
                break
                
        if not key_data:
            return None
            
        public_key = RSAAlgorithm.from_jwk(key_data)
        payload = jwt.decode(
            token, 
            public_key, 
            algorithms=["RS256"], 
            options={"verify_aud": False}
        )
        
        # Determine username
        username = payload.get("preferred_username") or payload.get("sub", "keycloak_user")
        
        # Determine roles
        realm_roles = payload.get("realm_access", {}).get("roles", [])
        client_roles = payload.get("resource_access", {}).get(settings.KEYCLOAK_CLIENT_ID, {}).get("roles", [])
        all_roles = realm_roles + client_roles
        
        role = "admin" if "admin" in all_roles else "user"
        
        return {
            "username": username,
            "role": role,
            "provider": "keycloak"
        }
    except Exception as e:
        # Silently fail for local fallback validation
        return None

def hash_password(password: str, salt: str = "AIOps_Salt_123!") -> str:
    return hashlib.sha256((password + salt).encode('utf-8')).hexdigest()

def verify_admin_role(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token format")
    token = authorization.split("Bearer ")[-1]
    
    # Try Keycloak validation first
    user_ctx = verify_keycloak_jwt(token)
    if user_ctx:
        if user_ctx["role"] != "admin":
            raise HTTPException(status_code=403, detail="Forbidden: Admin privileges required")
        return user_ctx
        
    # Fallback to local session validation
    user_ctx = verify_local_jwt(token)
    if not user_ctx:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    if user_ctx["role"] != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: Admin privileges required")
    return user_ctx

def verify_any_role(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token format")
    token = authorization.split("Bearer ")[-1]
    
    # Try Keycloak validation first
    user_ctx = verify_keycloak_jwt(token)
    if user_ctx:
        return user_ctx
        
    # Fallback to local session validation
    user_ctx = verify_local_jwt(token)
    if not user_ctx:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return user_ctx

class SignupPayload(BaseModel):
    username: str
    password: str
    role: str = "user"  # "admin" | "user"

class LoginPayload(BaseModel):
    username: str
    password: str

@router.post("/signup")
def auth_signup(payload: SignupPayload, request: Request, db: Session = Depends(get_db)):
    if settings.ENV == "production":
        raise HTTPException(status_code=403, detail="Local self-registration is disabled in production. Please use Keycloak SSO.")
        
    user = db.query(User).filter(User.username == payload.username).first()
    if user:
        raise HTTPException(status_code=400, detail="Username already exists")
    if payload.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Invalid role specified")
        
    new_user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role
    )
    db.add(new_user)
    db.commit()
    
    ip = request.client.host if request.client else "unknown"
    log_audit(db, username=payload.username, action="SIGNUP", target=payload.username, details=f"User registered with role: {payload.role}", ip_address=ip)
    
    return {"status": "success", "message": "User registered successfully"}

@router.post("/login")
def auth_login(payload: LoginPayload, request: Request, db: Session = Depends(get_db)):
    if settings.ENV == "production":
        raise HTTPException(status_code=403, detail="Local credentials login is disabled in production. Please use Keycloak SSO.")
        
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or user.password_hash != hash_password(payload.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
        
    token = create_local_jwt(user.username, user.role)
    
    ip = request.client.host if request.client else "unknown"
    log_audit(db, username=user.username, action="LOGIN", target=user.username, details="User successfully logged in via credentials", ip_address=ip)
    
    return {
        "token": token,
        "username": user.username,
        "role": user.role
    }

@router.post("/docker")
def auth_docker(request: Request, db: Session = Depends(get_db)):
    if settings.ENV == "production":
        raise HTTPException(status_code=403, detail="Docker IDP SSO bypass is disabled in production. Please use Keycloak SSO.")
        
    username = "docker_admin"
    user = db.query(User).filter(User.username == username).first()
    if not user:
        user = User(
            username=username,
            password_hash=hash_password("docker_secure_pass_123!"),
            role="admin"
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        
    token = create_local_jwt(username, "admin")
    
    ip = request.client.host if request.client else "unknown"
    log_audit(db, username=username, action="LOGIN", target=username, details="Docker IDP SSO authentication integration initiated", ip_address=ip)
    
    return {
        "token": token,
        "username": username,
        "role": "admin",
        "provider": "Docker IDP"
    }

@router.get("/sso/config")
def get_sso_config():
    return {
        "enabled": True,
        "url": settings.KEYCLOAK_URL,
        "realm": settings.KEYCLOAK_REALM,
        "client_id": settings.KEYCLOAK_CLIENT_ID
    }
