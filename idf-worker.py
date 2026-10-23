"""
Runs idf.py for the app (see src/lib/server/builder/idf.ts) in the `idf` compose service.

The official espressif/idf image's entrypoint sources ESP-IDF's export.sh before starting this, so
idf.py is on PATH. Only the standard library is used. Workspaces live on the volume both containers
share, so the app writes the sources and reads the firmware itself; this only runs the compiler.

  POST /run    {"id", "cwd", "args"} -> idf.py's output, then a last line "\x1eexit <code>"
  POST /cancel {"id"}                -> stops that run

Usage: python3 idf-worker.py --workspaces /data/workspaces [--port 3001]
"""

import argparse
import json
import os
import signal
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = ""  # set from --workspaces

running: dict[str, subprocess.Popen] = {}


def stop(proc: subprocess.Popen):
    # idf.py starts cmake/ninja/compilers: stop the whole process group.
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self.send_error(400, "Invalid JSON")
        if self.path == "/run":
            self.run(body)
        elif self.path == "/cancel":
            proc = running.get(str(body.get("id")))
            if proc:
                stop(proc)
            self.send_response(204)
            self.end_headers()
        else:
            self.send_error(404)

    def run(self, body):
        run_id = str(body.get("id"))
        cwd = os.path.realpath(str(body.get("cwd")))
        args = body.get("args")
        if not cwd.startswith(ROOT + os.sep) or not os.path.isdir(cwd):
            return self.send_error(400, f"cwd must be a workspace in {ROOT}")
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            return self.send_error(400, "args must be a list of strings")

        env = {**os.environ, "IDF_CCACHE_ENABLE": "1", "FORCE_COLOR": "0"}
        proc = subprocess.Popen(
            ["idf.py", *args],
            cwd=cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        running[run_id] = proc
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        try:
            while chunk := proc.stdout.read1(65536):
                self.wfile.write(chunk)
                self.wfile.flush()
            code = proc.wait()
            self.wfile.write(f"\n\x1eexit {code}\n".encode())
        except (BrokenPipeError, ConnectionResetError):
            # The app went away: don't leave the build running.
            stop(proc)
            proc.wait()
        finally:
            running.pop(run_id, None)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Runs idf.py for the app's build workspaces.")
    parser.add_argument(
        "--workspaces", default="/data/workspaces", help="directory the app keeps its workspaces in"
    )
    parser.add_argument("--port", type=int, default=3001, help="port to listen on")
    opts = parser.parse_args()
    ROOT = os.path.realpath(opts.workspaces)
    print(f"idf-worker: listening on :{opts.port}, workspaces in {ROOT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", opts.port), Handler).serve_forever()
