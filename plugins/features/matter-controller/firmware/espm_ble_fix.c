// espmatter studio – workarounds for BLE commissioning with CHIP's NimBLE manager (central side).
//
// On every BLE connect, CHIP's BLEManagerImpl::HandleGAPConnect starts an MTU exchange and treats
// any error as fatal: it logs "Disabling CHIPoBLE service due to error: ac", drops the link and
// pairing over BLE ends in "Discovery timed out". NimBLE returns BLE_HS_EALREADY when the MTU was
// already exchanged on this connection (e.g. the device asked first), which is fine.
//
// Thread devices drop the BLE link as soon as they join the Thread network. A BLE ack that was
// still pending then goes out through BLEManagerImpl::SendWriteRequest, which uses peer_find()'s
// result without a NULL check and crashes. For a gone connection we hand it an empty peer instead:
// it finds no RX characteristic and fails the write cleanly. (Calls inside peer.c aren't wrapped.)
//
// Linked with -Wl,--wrap=ble_gattc_exchange_mtu -Wl,--wrap=peer_find (see the feature's index.ts).
#include <string.h>
#include "blecent.h"
#include "esp_log.h"
#include "host/ble_gatt.h"
#include "host/ble_hs.h"

static const char *TAG = "espm_ble";

int __real_ble_gattc_exchange_mtu(uint16_t conn_handle, ble_gatt_mtu_fn *cb, void *cb_arg);
struct peer *__real_peer_find(uint16_t conn_handle);

int __wrap_ble_gattc_exchange_mtu(uint16_t conn_handle, ble_gatt_mtu_fn *cb, void *cb_arg)
{
    int rc = __real_ble_gattc_exchange_mtu(conn_handle, cb, cb_arg);
    if (rc == BLE_HS_EALREADY) {
        ESP_LOGI(TAG, "MTU already exchanged on connection %u", conn_handle);
        return 0;
    }
    if (rc != 0) ESP_LOGW(TAG, "MTU exchange on connection %u failed: %d", conn_handle, rc);
    return rc;
}

struct peer *__wrap_peer_find(uint16_t conn_handle)
{
    struct peer *peer = __real_peer_find(conn_handle);
    if (peer) return peer;
    static struct peer gone;
    memset(&gone, 0, sizeof(gone));
    gone.conn_handle = conn_handle;
    ESP_LOGW(TAG, "BLE connection %u is gone", conn_handle);
    return &gone;
}
