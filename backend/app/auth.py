"""Email and password logins with JWTs.

The access token (15 minutes) carries the user id in `sub` and is sent in the
Authorization header; checking it never touches the database. The refresh token
(30 days) lives in an HttpOnly cookie sent only to /api/auth. Its id is stored,
so each refresh can swap it for a new one, and logging out revokes it.
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session, col, delete, select

from app import config
from app.models import RefreshToken, User

REFRESH_COOKIE = "plink_refresh"
_hasher = PasswordHasher()
# Checked when no user has the email, so a wrong email takes as long as a wrong password.
_NO_USER = _hasher.hash("no user has this email")
_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def authenticate(db: Session, email: str, password: str) -> User | None:
    user = db.exec(select(User).where(User.email == email)).first()
    try:
        _hasher.verify(user.password_hash if user else _NO_USER, password)
    except VerificationError:
        return None
    return user


def _encode(claims: dict[str, Any], lifetime: timedelta) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({**claims, "iat": now, "exp": now + lifetime}, config.JWT_SECRET, algorithm="HS256")


def _decode(token: str, kind: str) -> dict[str, Any]:
    try:
        claims = jwt.decode(token, config.JWT_SECRET, algorithms=["HS256"], options={"require": ["exp", "sub", "type"]})
    except jwt.InvalidTokenError as e:
        raise HTTPException(401, "Log in again", headers={"WWW-Authenticate": "Bearer"}) from e
    # One secret signs both kinds, so neither may pass for the other.
    if claims["type"] != kind:
        raise HTTPException(401, "Log in again", headers={"WWW-Authenticate": "Bearer"})
    return claims


def _https(request: Request) -> bool:
    # Render ends HTTPS at its proxy, so the app itself sees plain HTTP.
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"


def _new_refresh_token(db: Session, user_id: int, request: Request, response: Response) -> None:
    jti = secrets.token_urlsafe(16)
    lifetime = timedelta(days=config.REFRESH_TOKEN_DAYS)
    now = datetime.now(timezone.utc)
    db.exec(delete(RefreshToken).where(col(RefreshToken.expires_at) <= now))
    db.add(RefreshToken(jti=jti, user_id=user_id, expires_at=now + lifetime))
    token = _encode({"sub": str(user_id), "type": "refresh", "jti": jti}, lifetime)
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=int(lifetime.total_seconds()),
        path="/api/auth",
        httponly=True,
        samesite="strict",
        secure=_https(request),
    )


def _access_reply(user: User) -> dict[str, Any]:
    lifetime = timedelta(minutes=config.ACCESS_TOKEN_MINUTES)
    return {
        "access_token": _encode({"sub": str(user.id), "type": "access"}, lifetime),
        "token_type": "bearer",
        "expires_in": int(lifetime.total_seconds()),
        "email": user.email,
        "display_name": user.display_name,
    }


def log_in(db: Session, user: User, request: Request, response: Response) -> dict[str, Any]:
    _new_refresh_token(db, user.id, request, response)
    db.commit()
    return _access_reply(user)


def refresh(db: Session, request: Request, response: Response) -> dict[str, Any]:
    """A new access token for the refresh cookie, which is swapped for a new one on first use."""
    claims = _decode(request.cookies.get(REFRESH_COOKIE, ""), "refresh")
    now = datetime.now(timezone.utc)
    # Locked, so two refreshes racing on Postgres rotate it once (SQLite already takes turns).
    row = db.exec(
        select(RefreshToken)
        .where(
            RefreshToken.jti == claims.get("jti"),
            RefreshToken.user_id == int(claims["sub"]),
            col(RefreshToken.expires_at) > now,
        )
        .with_for_update()
    ).first()
    user = db.get(User, row.user_id) if row else None
    if row is None or user is None:
        raise HTTPException(401, "Log in again")
    # Already rotated means another tab refreshed with this same cookie a moment ago: the
    # browser holds its successor, so only a new access token goes back.
    if row.rotated_at is None:
        row.rotated_at = now
        row.expires_at = now + timedelta(seconds=config.REFRESH_REUSE_SECONDS)
        db.add(row)
        _new_refresh_token(db, user.id, request, response)
        db.commit()
    return _access_reply(user)


def log_out(db: Session, request: Request, response: Response) -> None:
    try:
        jti = _decode(request.cookies.get(REFRESH_COOKIE, ""), "refresh").get("jti")
    except HTTPException:
        jti = None
    if jti:
        db.exec(delete(RefreshToken).where(col(RefreshToken.jti) == jti))
        db.commit()
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth", httponly=True, samesite="strict", secure=_https(request))


def current_user_id(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]) -> int:
    """The user id from a valid access token: every data route scopes its rows to it."""
    if credentials is None:
        raise HTTPException(401, "Log in first", headers={"WWW-Authenticate": "Bearer"})
    return int(_decode(credentials.credentials, "access")["sub"])


UserId = Annotated[int, Depends(current_user_id)]
