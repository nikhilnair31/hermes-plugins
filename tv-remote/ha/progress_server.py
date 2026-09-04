#!/usr/bin/env python3
"""Tiny localhost JSON service exposing Fire TV playback progress (read-only).
Used by the HA command_line sensor. Binds 127.0.0.1:8899 only."""
import json
import sys
sys.path.insert(0, "/home/nikhil/.hermes/plugins/tv-remote/dashboard")
import asyncio
from http.server import BaseHTTPRequestHandler, HTTPServer

import importlib.util
spec = importlib.util.spec_from_file_location(
    "tvapi", "/home/nikhil/.hermes/plugins/tv-remote/dashboard/plugin_api.py")
tvapi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tvapi)


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/progress":
            self.send_response(404); self.end_headers(); return
        try:
            data = asyncio.run(tvapi.progress())
        except Exception as e:
            data = {"ok": False, "error": str(e)[:100]}
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


HTTPServer(("127.0.0.1", 8899), H).serve_forever()
