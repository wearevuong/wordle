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

Room* create_room(void) {
    init_room_manager();
    EnterCriticalSection(&room_mgr_lock);
    if (room_count >= MAX_ROOMS) {
        LeaveCriticalSection(&room_mgr_lock);
        return NULL;
    }
    
    Room* r = (Room*)malloc(sizeof(Room));
    r->num_clients = 0;
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

Room* find_room(const char* code) {
    init_room_manager();
    EnterCriticalSection(&room_mgr_lock);
    for(int i=0; i<room_count; i++) {
        if (strcmp(rooms[i]->room_code, code) == 0) {
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
    return true;
}

void leave_room(Room* room, Client* client) {
    EnterCriticalSection(&room->lock);
    for(int i=0; i<room->num_clients; i++) {
        if (room->clients[i] == client) {
            for(int j=i; j<room->num_clients-1; j++) {
                room->clients[j] = room->clients[j+1];
            }
            room->num_clients--;
            break;
        }
    }
    LeaveCriticalSection(&room->lock);
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
