// espmatter studio – platform API for plugin firmware. Part of every Matter firmware.
#pragma once

#include <stdint.h>
#include <esp_err.h>
#include <cJSON.h>
#include <esp_matter.h>

#include "espm_config.h"

#if ESPM_HTTP
#include <esp_http_server.h>

// ---------------------------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------------------------

typedef esp_err_t (*espm_handler_t)(httpd_req_t *req);

/** Prepare the HTTP server (routes can be added from now on). */
void espm_http_init();
/** Start serving: called last in app_main, after every plugin added its routes. */
void espm_http_start();

/** Who may call a route. */
enum espm_access_t : uint8_t {
    /** Anybody, no token. */
    ESPM_PUBLIC,
    /** The device API token or a web interface session of an admin (on devices without accounts, every session). */
    ESPM_ADMIN,
    /** Any session, admin or not: the handler checks what the caller may see or do (espm_permission). */
    ESPM_ACCOUNT,
};

/**
 * Add a route. Callers authenticate with `Authorization: Bearer <token>`. `uri` may end in `*`
 * (wildcard).
 */
void espm_route(httpd_method_t method, const char *uri, espm_handler_t handler,
                espm_access_t access = ESPM_ADMIN, void *ctx = nullptr);

/**
 * Permissions of accounts (hubs: ESPM_USERS). Resources are names like `n17` (a paired node) with
 * children after a dot (`n17.2`, its endpoint 2); a child without a grant of its own inherits its
 * parent's.
 */
enum espm_perm_t : uint8_t { ESPM_PERM_NONE, ESPM_PERM_READ, ESPM_PERM_WRITE };

/** What the caller of the current request may do with `resource` (admins and the API token: everything). */
espm_perm_t espm_permission(const char *resource);
/** The caller may read `resource` or one of its children (`n17` with a grant on `n17.2` only). */
bool espm_permission_any(const char *resource);
/** The caller of the current request is an admin (or uses the API token). */
bool espm_caller_admin();
/** The account of the current request's session: 0 the built-in admin, -1 the API token or none. */
int espm_caller_user();
/** Drop all grants on `resource` and its children, e.g. of a removed node. */
void espm_permissions_forget(const char *resource);

/** Context passed to espm_route (e.g. the peripheral instance). */
void *espm_route_ctx(httpd_req_t *req);

/** Send JSON and free it. */
esp_err_t espm_send_json(httpd_req_t *req, cJSON *json, int status = 200);
esp_err_t espm_send_error(httpd_req_t *req, int status, const char *message);
esp_err_t espm_send_ok(httpd_req_t *req);

/** Read a JSON body (sends 400 and returns null if it isn't one). Free with cJSON_Delete. */
cJSON *espm_read_json(httpd_req_t *req, size_t max_len = 4096);

/**
 * A new web interface session token of account `user` (0: the built-in admin, whose password
 * hash is the app's ui_hash). Kept in the default NVS partition (survives reboots); up to 16 at a time,
 * the oldest goes first.
 */
const char *espm_session_create(int user);
/** End all sessions (of every account: user < 0). */
void espm_session_clear(int user = -1);
/** `password` matches `stored` (`pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>`), in constant time. */
bool espm_password_check(const char *stored, const char *password);

#if ESPM_USERS
// Accounts (espm_users.cpp), stored in the default NVS partition: configuration updates don't touch them.
/** The account with this name and password, or -1. Not the built-in admin. */
int espm_users_login(const char *name, const char *password);
/** 1 admin, 0 user, -1 no such account (deleted). */
int espm_users_role(int user);
const char *espm_users_name(int user);
/** The account has a generated password it must change (POST /api/v1/auth/password) first. */
bool espm_users_must_change(int user);
espm_perm_t espm_users_permission(int user, const char *resource);
bool espm_users_permission_any(int user, const char *resource);
void espm_users_forget(const char *resource);
#endif

/** Serve a gzipped page at `uri` (the web interface). */
void espm_http_page(const char *uri, const uint8_t *start, const uint8_t *end);
#endif

// ---------------------------------------------------------------------------------------------
// Matter
// ---------------------------------------------------------------------------------------------

/**
 * On a Matter device (ESPM_MATTER_SERVER): creates the root node; plugins add their endpoints
 * afterwards (`init('matter', …)`). A hub is only a controller and has no node.
 */
void espm_matter_init();
void espm_matter_event(const ChipDeviceEvent *event, intptr_t arg);

/** Run `fn` with the Matter stack lock held (re-entrant: fine from the Matter task too). */
template <typename F> auto espm_locked(F fn)
{
    esp_matter::lock::ScopedChipStackLock guard(portMAX_DELAY);
    return fn();
}

#if ESPM_MATTER_SERVER
esp_matter::node_t *espm_node();

/** Called (from the Matter task) when a controller writes an attribute of `endpoint`. */
typedef esp_err_t (*espm_attr_cb_t)(uint16_t endpoint, uint32_t cluster, uint32_t attribute,
                                    esp_matter_attr_val_t *val, void *ctx);
void espm_on_attribute(uint16_t endpoint, espm_attr_cb_t cb, void *ctx);

/** Called when a controller asks an endpoint to identify itself. */
typedef void (*espm_identify_cb_t)(uint16_t endpoint, bool start, void *ctx);
void espm_on_identify(uint16_t endpoint, espm_identify_cb_t cb, void *ctx);

/** Update an attribute from any task (takes the Matter stack lock). */
esp_err_t espm_attr_update(uint16_t endpoint, uint32_t cluster, uint32_t attribute,
                           esp_matter_attr_val_t val);
#endif

/** Defined in the generated app_main.cpp: plugins' code for "the device is online". */
void espm_app_on_network();

/** Start SNTP with `server` (once: later calls are ignored). Call when on the network. */
void espm_time_sync(const char *server);
/** The clock has the real time. */
bool espm_time_valid();
/** Local time for localtime(): a POSIX TZ rule, e.g. `CET-1CEST,M3.5.0,M10.5.0/3`. */
void espm_time_zone(const char *posix);

/** The device's IPv4 address as text, or "". */
const char *espm_ip();
/** Got an IP address (v4 or v6) since boot. */
bool espm_online();

// ---------------------------------------------------------------------------------------------
// Metrics: values peripherals publish – served at /api/v1/metrics, exported by OpenTelemetry if enabled.
// ---------------------------------------------------------------------------------------------

void espm_metrics_init();
/** Set a gauge, e.g. espm_metric_set("temperature", "sensor=k3f9a1", "Cel", 21.4). Any task. */
void espm_metric_set(const char *name, const char *labels, const char *unit, double value);

struct espm_metric_t {
    char name[32];
    char labels[48];
    char unit[12];
    double value;
    int64_t updated_us;
};
/** Copy up to `max` metrics, returns the count. */
int espm_metrics_snapshot(espm_metric_t *out, int max);

/**
 * Metrics of other devices, e.g. the nodes a Matter controller follows. Exporters report each
 * one as a device (resource) of its own.
 */
struct espm_metric_sink_t {
    /** Starts a device; the metrics until the next call belong to it. `id` is globally unique. */
    void (*device)(void *arg, const char *id, const char *name, const char *matter_node_id);
    void (*metric)(void *arg, const char *name, const char *labels, const char *unit, double value);
    void *arg;
};
struct espm_metric_source_t {
    int (*count)();
    /** Report device `index` (< count()): one device() call, then its metric() calls. */
    void (*report)(int index, const espm_metric_sink_t *sink);
};
/** Register a source (static lifetime; up to 4). */
void espm_metrics_add_source(const espm_metric_source_t *source);
/** This device as one device() call, then its own values (uptime, memory, Wi-Fi) and the registry. */
void espm_metrics_own_report(const espm_metric_sink_t *sink);
/** The devices of all sources. */
int espm_metrics_remote_count();
void espm_metrics_remote_report(int index, const espm_metric_sink_t *sink);

// ---------------------------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------------------------

void espm_ota_init();
/** Ask the app for an update now. False: this device doesn't pull (off, or no app URL). */
bool espm_ota_check_now();

#if ESPM_UPDATE_PULL
#include <esp_http_client.h>

/** An update the app has for a slot. */
struct espm_update_t {
    int version;
    char url[256];
    /** Image size and SHA-256 (hex), 0 / "" when the app didn't say. */
    int size;
    char sha256[65];
};
/**
 * Ask the app – or, on a Thread device, a hub's update relay – for an update of another slot of
 * this device (a board the main board flashes), which runs `running` (0: unknown).
 */
bool espm_update_manifest(const char *slot, int running, espm_update_t *out);
/** Start downloading `url` with the device's token: the client past the headers, or nullptr. */
esp_http_client_handle_t espm_update_open(const char *url, int64_t *length);
/** Tell the app what runs on `slot` and how an update goes (`downloading`, `installed`, `failed`, `running`). */
void espm_update_report(const char *slot, const char *state, int version, int running, const char *message);
#endif

// ---------------------------------------------------------------------------------------------
// Boards the main board flashes over a wire (SlotDef.flashOverWire, espm_slotflash.cpp)
// ---------------------------------------------------------------------------------------------

#if ESPM_SLOTFLASH
/**
 * Wait until the main board is done with `slot`'s update check (and update) at boot. A plugin
 * calls this before it uses the wires to the board – the flasher needs them meanwhile.
 */
void espm_slot_wait(const char *slot);
/**
 * A plugin that uses the wires to `slot` lets go of them for an update found while running:
 * `release` stops using them (returns once they're free), `reclaim` takes them back after the
 * board was flashed and restarted. Without these, such an update restarts the main board instead.
 */
void espm_slot_on_update(const char *slot, void (*release)(), void (*reclaim)());
/** Called by the pull check: installs a board's update (or restarts for it, see espm_slot_on_update). */
void espm_slotflash_check();
#else
inline void espm_slot_wait(const char *) {}
inline void espm_slot_on_update(const char *, void (*)(), void (*)()) {}
#endif
