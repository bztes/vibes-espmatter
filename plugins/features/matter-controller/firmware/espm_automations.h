// espmatter studio – shared by automations and scenes (espm_automations.cpp, espm_scenes.cpp).
#pragma once
#include "espm.h"

#include <stdint.h>

/** `user` (0: the built-in admin) may still do `need` with the endpoint. */
bool espm_auto_allowed(int user, uint64_t node, uint16_t endpoint, espm_perm_t need);
/** The account rules and scenes made in the current request belong to (the API token: the admin). */
int espm_auto_caller();

/** What `user` may do with the scene: write for its owner and admins, else its grant. Stack lock held. */
espm_perm_t espm_scene_access(int user, uint16_t id);
/** `user` may see and run the scene. Stack lock held. */
bool espm_scene_usable(int user, uint16_t id);
/** Activate with `user`'s access: returns the endpoints skipped, -1 no such scene. Stack lock held. */
int espm_scene_run(uint16_t id, int user);
/** Stack lock held. */
void espm_scenes_node_removed(uint64_t node);
void espm_scenes_start();
