# /// script
# requires-python = ">=3.10"
# dependencies = ["pyjwt[crypto]>=2.10"]
# ///
"""
The same API in Python, with PyJWT and the standard library's HTTP server.
Nothing from Gatecrypt is installed: a visitor's token is an ordinary ES256
JWT. What to check:

    signature   against the keys at <service>/v1/jwks.json
    iss         the service
    aud         your project ID
    exp         not passed (the library does this)

    GATECRYPT_PROJECT_ID=... uv run server.py
"""
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import jwt

SERVICE = os.environ.get("GATECRYPT_SERVICE_URL", "https://api.gatecrypt.dev")
PROJECT_ID = os.environ["GATECRYPT_PROJECT_ID"]

# Fetched on first use and kept; fetched again when a token names a key that is new.
keys = jwt.PyJWKClient(f"{SERVICE}/v1/jwks.json", cache_keys=True, lifespan=3600)

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "600",
}


def visitor(authorization):
    """The claims of the visitor's token. Raises jwt.PyJWTError if there is no good one."""
    match = re.fullmatch(r"Bearer +(\S+)", authorization or "", re.IGNORECASE)
    if not match:
        raise jwt.InvalidTokenError("missing")
    token = match.group(1)
    claims = jwt.decode(
        token,
        keys.get_signing_key_from_jwt(token).key,
        # Never let the token choose how it is checked.
        algorithms=["ES256"],
        issuer=SERVICE,
        audience=PROJECT_ID,
        options={"require": ["exp", "iat", "iss", "aud", "email", "origin"]},
    )
    # A token for several projects at once is not one the service makes.
    if not isinstance(claims["aud"], str):
        raise jwt.InvalidAudienceError("several audiences")
    return claims


class Handler(BaseHTTPRequestHandler):
    def send(self, status, body=None):
        self.send_response(status)
        for name, value in CORS.items():
            self.send_header(name, value)
        self.send_header("Cache-Control", "no-store")
        data = b"" if body is None else json.dumps(body).encode()
        if body is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send(204)

    def do_GET(self):
        if self.path.split("?")[0] != "/api/me":
            return self.send(404, {"error": "not_found"})
        try:
            claims = visitor(self.headers.get("Authorization"))
        except jwt.PyJWKClientConnectionError:
            # The keys could not be fetched: our problem, not the visitor's.
            return self.send(503, {"error": "keys_unavailable"})
        except jwt.ExpiredSignatureError:
            return self.send(401, {"error": "expired"})
        except jwt.PyJWTError:
            return self.send(401, {"error": "invalid"})
        # From here on the request is from claims["email"], who was on the access list minutes ago at most.
        self.send(200, {"email": claims["email"], "origin": claims["origin"], "expiresAt": claims["exp"]})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("localhost", int(os.environ.get("PORT", "8080"))), Handler)
    print(f"API listening on http://localhost:{server.server_port}", flush=True)
    server.serve_forever()
