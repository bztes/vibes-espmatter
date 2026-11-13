"""
espmatter studio build runner. Runs in the espressif/idf image (its entrypoint sets up ESP-IDF).

Only calls the app, so it may sit behind NAT. It long-polls `POST /api/v1/runners` with its
ESP-IDF version, concurrency and running jobs; the answer holds its next commands. A build command brings
the workspace's files, which are kept per workspace so rebuilds are incremental. The runner posts
the log in batches (an unknown job there means: stop), uploads the artifacts in chunks and posts
the exit code. Every call carries RUNNER_TOKEN, which an admin gets when adding the runner.

Environment: RUNNER_TOKEN, APP_URL, RUNNER_CONCURRENCY (required), RUNNER_DATA.
"""

import base64
import json
import os
import queue
import re
import shutil
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


def required(name):
    value = os.environ.get(name, '').strip()
    if not value:
        raise SystemExit(f'Set {name} in runner/.env.')
    return value


TOKEN = required('RUNNER_TOKEN')
APP_URL = required('APP_URL').rstrip('/')
CONCURRENCY = max(1, min(8, int(required('RUNNER_CONCURRENCY'))))
DATA = os.environ.get('RUNNER_DATA', '/data')
WORKSPACES = os.path.join(DATA, 'workspaces')

# Build caches live in the data volume.
os.environ.setdefault('IDF_CCACHE_ENABLE', '1')
os.environ.setdefault('CCACHE_DIR', os.path.join(DATA, 'cache', 'ccache'))
os.environ.setdefault('IDF_COMPONENT_CACHE_PATH', os.path.join(DATA, 'cache', 'components'))

POLL_TIMEOUT_S = 40  # the app holds a poll for 20 s
RETRY_S = 5
LOG_FLUSH_S = 1
LOG_IDLE_S = 5  # posts even without new lines, so the app knows the build is alive
# Request bodies stay below the app's (512 KB) and proxies' body limits.
CHUNK = 256 * 1024
LOG_BATCH = 500
SAFE_ID = re.compile(r'^[A-Za-z0-9_.-]{1,120}$')

jobs = {}  # job id -> workspace, while running
jobs_lock = threading.Lock()
active = {}  # workspace -> running Popen
workspace_locks = {}


class Gone(Exception):
    """The app doesn't know the job any more (cancelled or failed)."""


def log(msg):
    print(msg, flush=True)


def call(method, path, body=None, raw=None, timeout=30):
    """Calls the app; returns the decoded JSON answer (or None)."""
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {'Authorization': f'Bearer {TOKEN}'}
    if raw is None and body is not None:
        headers['Content-Type'] = 'application/json'
    if raw is not None:
        headers['Content-Type'] = 'application/octet-stream'
    req = urllib.request.Request(APP_URL + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            text = res.read()
    except urllib.error.HTTPError as e:
        if e.code == 410:
            raise Gone() from e
        raise RuntimeError(f'{e.code} {e.read().decode(errors="replace")[:200]}') from e
    return json.loads(text) if text else None


def idf_version():
    out = subprocess.run(['idf.py', '--version'], capture_output=True, text=True).stdout
    m = re.search(r'v\d+\.\d+(\.\d+)?\S*', out)
    return m.group(0) if m else out.strip() or 'unknown'


def safe_join(root, rel):
    if not rel or rel.startswith('/') or '\\' in rel or '..' in rel.split('/'):
        raise ValueError(f'Invalid file name {rel}')
    return os.path.join(root, rel)


def write_if_changed(path, data):
    try:
        with open(path, 'rb') as f:
            if f.read() == data:
                return
    except FileNotFoundError:
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)


def write_workspace(ws, files, emit):
    emit('Reusing workspace.' if os.path.isdir(ws)
         else 'New workspace – the first build downloads esp-matter and takes a while.')
    for name, data in files.items():
        write_if_changed(safe_join(ws, name), data)
    # sdkconfig is derived from sdkconfig.defaults: regenerate when those change.
    sdk, defaults = os.path.join(ws, 'sdkconfig'), os.path.join(ws, 'sdkconfig.defaults')
    if os.path.exists(sdk) and os.path.exists(defaults) and os.path.getmtime(defaults) > os.path.getmtime(sdk):
        os.remove(sdk)
    main = os.path.join(ws, 'main')
    for entry in os.listdir(main) if os.path.isdir(main) else []:
        if f'main/{entry}' not in files:
            path = os.path.join(main, entry)
            shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)


def upload(job, ws):
    """Uploads what the app needs: flasher_args.json and the files it names."""
    build = os.path.join(ws, 'build')
    with open(os.path.join(build, 'flasher_args.json')) as f:
        args = json.load(f)
    for rel in dict.fromkeys(['flasher_args.json', args['app']['file'], *args['flash_files'].values()]):
        with open(safe_join(build, rel), 'rb') as f:
            data = f.read()
        path = f'/api/v1/runners/jobs/{job}/files/{urllib.parse.quote(rel)}'
        for offset in range(0, max(len(data), 1), CHUNK):
            call('PUT', f'{path}?offset={offset}', raw=data[offset:offset + CHUNK], timeout=120)


def kill(proc):
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass


def lock_workspace(name):
    """A build still running in the workspace (one the app gave up on) gives way."""
    with jobs_lock:
        lock = workspace_locks.setdefault(name, threading.Lock())
        if lock.locked() and name in active:
            kill(active[name])
    lock.acquire()
    return lock


class LogSender:
    """Posts log lines in batches; raises Gone when the app dropped the job."""

    def __init__(self, job):
        self.job, self.lines, self.sent = job, [], time.monotonic()

    def add(self, line):
        self.lines.append(line)

    def flush(self, force=False):
        idle = time.monotonic() - self.sent
        if not force and not (self.lines and idle >= LOG_FLUSH_S) and idle < LOG_IDLE_S:
            return
        try:
            while True:
                batch = self.lines[:LOG_BATCH]
                call('POST', f'/api/v1/runners/jobs/{self.job}/log', {'lines': [l[:2000] for l in batch]})
                del self.lines[:len(batch)]
                if not self.lines:
                    break
        except Gone:
            raise
        except Exception as e:  # app briefly unreachable: keep the lines, try again
            if force:
                raise
            log(f'{self.job}: posting the log failed: {e}')
            del self.lines[:-5000]
        self.sent = time.monotonic()


def run_job(job, workspace, files):
    ws = os.path.join(WORKSPACES, workspace)
    out = LogSender(job)
    lock = lock_workspace(workspace)
    proc = None
    try:
        write_workspace(ws, files, out.add)
        out.flush(force=True)
        proc = subprocess.Popen(
            ['idf.py', 'build'], cwd=ws, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, text=True, errors='replace', start_new_session=True)
        with jobs_lock:
            active[workspace] = proc

        lines = queue.Queue()

        def read():
            for line in proc.stdout:
                lines.put(line.rstrip('\n'))
            lines.put(None)
        threading.Thread(target=read, daemon=True).start()

        while True:
            try:
                line = lines.get(timeout=LOG_FLUSH_S)
            except queue.Empty:
                out.flush()
                continue
            if line is None:
                break
            if line.strip():
                out.add(line)
            out.flush()
        code = proc.wait()
        if code == 0:
            out.add('Uploading the images.')
        out.flush(force=True)
        if code == 0:
            upload(job, ws)
        call('POST', f'/api/v1/runners/jobs/{job}/result', {'exit': code})
    except Gone:
        log(f'{job}: dropped by the app, stopping.')
    except Exception as e:
        log(f'{job}: {e}')
        try:
            out.add(f'Runner error: {e}')
            out.flush(force=True)
            call('POST', f'/api/v1/runners/jobs/{job}/result', {'exit': 1})
        except Exception:
            pass
    finally:
        if proc:
            if proc.poll() is None:
                kill(proc)
                proc.wait()
            with jobs_lock:
                active.pop(workspace, None)
        lock.release()
        with jobs_lock:
            jobs.pop(job, None)


def drop_workspace(name):
    lock = lock_workspace(name)
    try:
        shutil.rmtree(os.path.join(WORKSPACES, name), ignore_errors=True)
    finally:
        lock.release()


def handle(cmd):
    kind = cmd.get('type')
    if kind == 'build':
        job, workspace = cmd['id'], cmd['workspace']
        if not SAFE_ID.match(job) or not SAFE_ID.match(workspace):
            raise ValueError('Invalid job or workspace id')
        files = {name: base64.b64decode(data) for name, data in cmd['files'].items()}
        for name in files:
            safe_join(WORKSPACES, name)
        # Registered before the next poll, which reports the running jobs.
        with jobs_lock:
            jobs[job] = workspace
        threading.Thread(target=run_job, args=(job, workspace, files), daemon=True).start()
    elif kind == 'dropWorkspace' and SAFE_ID.match(cmd.get('name', '')):
        threading.Thread(target=drop_workspace, args=(cmd['name'],), daemon=True).start()


def stop(*_):
    with jobs_lock:
        for proc in active.values():
            kill(proc)
    raise SystemExit(0)


def main():
    os.makedirs(WORKSPACES, exist_ok=True)
    signal.signal(signal.SIGTERM, stop)
    version = idf_version()
    log(f'Runner with ESP-IDF {version}, polling {APP_URL}')
    last_error = None
    while True:
        with jobs_lock:
            running = list(jobs)
        report = {'idfVersion': version, 'concurrency': CONCURRENCY, 'jobs': running}
        try:
            answer = call('POST', '/api/v1/runners', report, timeout=POLL_TIMEOUT_S)
            if last_error is not None:
                log(f'Connected to {APP_URL}.')
            last_error = None
        except Exception as e:  # app down, unknown token, ...
            if str(e) != last_error:
                log(f'Polling {APP_URL} failed: {e}')
            last_error = str(e)
            time.sleep(RETRY_S)
            continue
        for cmd in (answer or {}).get('commands', []):
            try:
                handle(cmd)
            except Exception as e:
                log(f'Bad command: {e}')


if __name__ == '__main__':
    main()
