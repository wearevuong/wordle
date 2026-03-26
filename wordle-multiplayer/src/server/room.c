#include "server.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_ROOMS 50

Room* rooms[MAX_ROOMS];
int room_count = 0;
CRITICAL_SECTION room_mgr_lock;
bool room_mgr_init = false;

void init_room_manager() {
    if (!room_mgr_init) {
        InitializeCriticalSection(&room_mgr_lock);
        room_mgr_init = true;
    }
}

// ----------------------------------------------------------------
// Broadcast updated player list to all clients in room
// Format: "PLAYERS:<name1>,<name2>,..."  + host flag "HOST:<name>"
// ----------------------------------------------------------------
void broadcast_players_update(Room* room) {
    // Build PLAYERS message (called while OUTSIDE lock, so we lock here)
    EnterCriticalSection(&room->lock);
    char msg[1024] = "PLAYERS:";
    char host_name[MAX_USERNAME] = "";
    for (int i = 0; i < room->num_clients; i++) {
        if (i > 0) strcat(msg, ",");
        strcat(msg, room->clients[i]->username);
        if (i == room->host_index) {
            strncpy(host_name, room->clients[i]->username, MAX_USERNAME - 1);
        }
    }
    // Append HOST tag
    char host_tag[64];
    sprintf(host_tag, "|HOST:%s", host_name);
    strcat(msg, host_tag);
    LeaveCriticalSection(&room->lock);

    broadcast_to_room(room, msg, NULL);
}

// ----------------------------------------------------------------
// Kick a player from a room (host-only)
// ----------------------------------------------------------------
void kick_from_room(Room* room, const char* target_username, Client* requester) {
    EnterCriticalSection(&room->lock);

    // Check if requester is host
    if (room->num_clients == 0 || room->clients[room->host_index] != requester) {
        LeaveCriticalSection(&room->lock);
        send_msg(requester->sock, "Only the host can kick players.");
        return;
    }

    // Find the target
    int target_idx = -1;
    for (int i = 0; i < room->num_clients; i++) {
        if (_stricmp(room->clients[i]->username, target_username) == 0) {
            target_idx = i;
            break;
        }
    }

    if (target_idx < 0) {
        LeaveCriticalSection(&room->lock);
        send_msg(requester->sock, "Player not found in room.");
        return;
    }

    if (target_idx == room->host_index) {
        LeaveCriticalSection(&room->lock);
        send_msg(requester->sock, "You cannot kick yourself.");
        return;
    }

    Client* kicked = room->clients[target_idx];
    LeaveCriticalSection(&room->lock);

    // Notify kicked player
    send_msg(kicked->sock, "KICKED:You have been kicked from the room by the host.");

    // Remove from room
    leave_room(room, kicked);

    // Notify others
    char notice[128];
    sprintf(notice, "%s was kicked from the room.", target_username);
    broadcast_to_room(room, notice, NULL);

    // Update player list
    broadcast_players_update(room);
}

// ----------------------------------------------------------------
Room* create_room(void) {
    init_room_manager();
    EnterCriticalSection(&room_mgr_lock);
    if (room_count >= MAX_ROOMS) {
        LeaveCriticalSection(&room_mgr_lock);
        return NULL;
    }
    
    Room* r = (Room*)malloc(sizeof(Room));
    r->num_clients = 0;
    r->host_index = 0;
    r->difficulty = DIFFICULTY_EASY;
    InitializeCriticalSection(&r->lock);
    InitializeConditionVariable(&r->guess_cond);
    r->game_in_progress = false;
    r->current_round = 0;
    r->total_rounds = MAX_ATTEMPTS;
    r->guess_count = 0;
    
    const char charset[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for(int i=0; i<ROOM_CODE_LEN; i++){
        r->room_code[i] = charset[rand() % (sizeof(charset)-1)];
    }
    r->room_code[ROOM_CODE_LEN] = '\0';
    
    rooms[room_count++] = r;
    LeaveCriticalSection(&room_mgr_lock);
    return r;
}

// ----------------------------------------------------------------
// FIX: case-insensitive room code lookup (_stricmp instead of strcmp)
// ----------------------------------------------------------------
Room* find_room(const char* code) {
    init_room_manager();
    EnterCriticalSection(&room_mgr_lock);
    for(int i=0; i<room_count; i++) {
        if (_stricmp(rooms[i]->room_code, code) == 0) {
            LeaveCriticalSection(&room_mgr_lock);
            return rooms[i];
        }
    }
    LeaveCriticalSection(&room_mgr_lock);
    return NULL;
}

bool join_room(Room* room, Client* client) {
    EnterCriticalSection(&room->lock);
    if (room->game_in_progress || room->num_clients >= MAX_CLIENTS) {
        LeaveCriticalSection(&room->lock);
        return false;
    }
    room->clients[room->num_clients++] = client;
    LeaveCriticalSection(&room->lock);

    // Broadcast updated player list
    broadcast_players_update(room);
    return true;
}

void leave_room(Room* room, Client* client) {
    EnterCriticalSection(&room->lock);
    int removed_idx = -1;
    for(int i=0; i<room->num_clients; i++) {
        if (room->clients[i] == client) {
            removed_idx = i;
            for(int j=i; j<room->num_clients-1; j++) {
                room->clients[j] = room->clients[j+1];
            }
            room->num_clients--;
            break;
        }
    }

    // Adjust host index if the host left or someone before host was removed
    if (removed_idx >= 0 && room->num_clients > 0) {
        if (removed_idx < room->host_index) {
            room->host_index--;
        } else if (removed_idx == room->host_index) {
            room->host_index = 0; // promote first remaining player as host
        }
    }
    LeaveCriticalSection(&room->lock);

    // Broadcast updated player list (only if room still has players)
    if (room->num_clients > 0) {
        broadcast_players_update(room);
    }
}

void broadcast_to_room(Room* room, const char* message, Client* exclude_client) {
    EnterCriticalSection(&room->lock);
    for(int i=0; i<room->num_clients; i++) {
        if (room->clients[i] != exclude_client && room->clients[i]->is_active) {
            send_msg(room->clients[i]->sock, message);
        }
    }
    LeaveCriticalSection(&room->lock);
}
