#include "server.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <process.h>
#include <time.h>

#define DEFAULT_PORT 8888

unsigned __stdcall client_handler(void* arg) {
    srand((unsigned int)time(NULL) ^ (unsigned int)GetCurrentThreadId());
    Client* client = (Client*)arg;
    char buffer[MAX_PAYLOAD_SIZE];
    Room* current_room = NULL;
    
    send_msg(client->sock, "Welcome to Multiplayer Wordle!\r\n"
                           "Commands:\r\n"
                           "/username <name>  : Set your username\r\n"
                           "/create           : Create a private room\r\n"
                           "/join <code>      : Join a room\r\n"
                           "/mode easy|hard   : Set difficulty (45s/30s) - host only\r\n"
                           "/kick <username>  : Kick player - host only\r\n"
                           "/start            : Start game\r\n"
                           "/top              : High scores\r\n"
                           "/quit             : Exit");
    
    while (1) {
        int bytes = recv_msg(client->sock, buffer, sizeof(buffer));
        if (bytes <= 0) {
            printf("Client disconnected.\n");
            break;
        }
        
        buffer[strcspn(buffer, "\r\n")] = '\0';
        printf("Received from %s: %s\n", client->username, buffer);
        
        if (strncmp(buffer, "/username ", 10) == 0) {
            strncpy(client->username, buffer + 10, MAX_USERNAME - 1);
            client->username[MAX_USERNAME - 1] = '\0';
            char msg[128];
            sprintf(msg, "Username set to %s", client->username);
            send_msg(client->sock, msg);
        }
        else if (strcmp(buffer, "/create") == 0) {
            if (current_room) leave_room(current_room, client);
            current_room = create_room();
            if (current_room) {
                // Creator is always host (index 0)
                join_room(current_room, client);
                current_room->host_index = 0;
                char msg[256];
                sprintf(msg, "Room created. Room code: %s\nYou are the HOST. Use /mode easy|hard and /kick <name>.", current_room->room_code);
                send_msg(client->sock, msg);
                broadcast_players_update(current_room);
            } else {
                send_msg(client->sock, "Could not create room (server full).");
            }
        }
        else if (strncmp(buffer, "/join ", 6) == 0) {
            char* code = buffer + 6;
            Room* r = find_room(code);
            if (r) {
                if (current_room) leave_room(current_room, client);
                if (join_room(r, client)) {
                    current_room = r;
                    char msg[128];
                    sprintf(msg, "Joined room %s.", current_room->room_code);
                    send_msg(client->sock, msg);
                    
                    sprintf(msg, "%s joined the room.", client->username);
                    broadcast_to_room(current_room, msg, client);
                } else {
                    send_msg(client->sock, "Room is full or game is in progress.");
                }
            } else {
                send_msg(client->sock, "Room not found.");
            }
        }
        else if (strncmp(buffer, "/kick ", 6) == 0) {
            char* target = buffer + 6;
            if (current_room) {
                kick_from_room(current_room, target, client);
            } else {
                send_msg(client->sock, "You must be in a room to kick players.");
            }
        }
        else if (strncmp(buffer, "/mode ", 6) == 0) {
            char* mode_str = buffer + 6;
            if (current_room) {
                // Only host can change mode
                EnterCriticalSection(&current_room->lock);
                bool is_host = (current_room->num_clients > 0 &&
                                current_room->clients[current_room->host_index] == client);
                LeaveCriticalSection(&current_room->lock);

                if (!is_host) {
                    send_msg(client->sock, "Only the host can change game mode.");
                } else if (_stricmp(mode_str, "hard") == 0) {
                    current_room->difficulty = DIFFICULTY_HARD;
                    broadcast_to_room(current_room, "MODE:hard|Game mode set to HARD (30s per round) by host.", NULL);
                } else if (_stricmp(mode_str, "easy") == 0) {
                    current_room->difficulty = DIFFICULTY_EASY;
                    broadcast_to_room(current_room, "MODE:easy|Game mode set to EASY (45s per round) by host.", NULL);
                } else {
                    send_msg(client->sock, "Usage: /mode easy|hard");
                }
            } else {
                send_msg(client->sock, "You must be in a room to change mode.");
            }
        }
        else if (strcmp(buffer, "/start") == 0) {
            if (current_room) {
                start_game(current_room);
            } else {
                send_msg(client->sock, "You must be in a room to start game.");
            }
        }
        else if (strcmp(buffer, "/top") == 0) {
            char top_scores[4096];
            get_top_scores(top_scores, sizeof(top_scores));
            send_msg(client->sock, top_scores);
        }
        else if (strcmp(buffer, "/quit") == 0) {
            break;
        }
        else {
            if (current_room && current_room->game_in_progress) {
                if (strlen(buffer) == WORD_LEN) {
                    EnterCriticalSection(&current_room->lock);
                    if (!client->has_guessed) {
                        for(int i=0; i<WORD_LEN; i++) {
                            client->current_guess[i] = (buffer[i] >= 'a' && buffer[i] <= 'z') ? buffer[i] - 32 : buffer[i];
                        }
                        client->current_guess[WORD_LEN] = '\0';
                        client->has_guessed = true;
                        current_room->guess_count++;
                        WakeAllConditionVariable(&current_room->guess_cond);
                        
                        char hint_msg[128];
                        sprintf(hint_msg, "Guess %s registered. Waiting for others...", client->current_guess);
                        send_msg(client->sock, hint_msg);
                    } else {
                        send_msg(client->sock, "You already guessed in this round.");
                    }
                    LeaveCriticalSection(&current_room->lock);
                } else {
                    send_msg(client->sock, "Guess must be exactly 5 characters.");
                }
            } else {
                char reply[MAX_PAYLOAD_SIZE];
                sprintf(reply, "[Global Chat] %s: %s", client->username, buffer);
                send_msg(client->sock, reply);
            }
        }
    }
    
    if (current_room) {
        char leave_msg[128];
        sprintf(leave_msg, "%s left the room.", client->username);
        broadcast_to_room(current_room, leave_msg, client);
        leave_room(current_room, client);
    }
    
    client->is_active = false;
    closesocket(client->sock);
    free(client);
    return 0;
}

int main(int argc, char* argv[]) {
    int port = DEFAULT_PORT;
    if (argc > 1) {
        port = atoi(argv[1]);
    }
    
    srand((unsigned int)time(NULL) ^ (unsigned int)GetCurrentProcessId());
    
    if (init_winsock() < 0) {
        return 1;
    }
    
    load_words();
    init_scores();
    
    SOCKET server_socket = socket(AF_INET, SOCK_STREAM, 0);
    if (server_socket == INVALID_SOCKET) {
        printf("Could not create socket : %d\n", WSAGetLastError());
        cleanup_winsock();
        system("pause");
        return 1;
    }
    
    // Allow reuse of address
    int opt = 1;
    setsockopt(server_socket, SOL_SOCKET, SO_REUSEADDR, (char*)&opt, sizeof(opt));

    struct sockaddr_in server_addr;
    server_addr.sin_family = AF_INET;
    server_addr.sin_addr.s_addr = INADDR_ANY;
    server_addr.sin_port = htons(port);
    
    if (bind(server_socket, (struct sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        printf("Bind failed with error code : %d\n", WSAGetLastError());
        closesocket(server_socket);
        cleanup_winsock();
        system("pause");
        return 1;
    }
    
    listen(server_socket, 10);
    printf("Wordle Server listening on port %d...\n", port);
    
    struct sockaddr_in client_addr;
    int c = sizeof(struct sockaddr_in);
    
    while (1) {
        SOCKET client_sock = accept(server_socket, (struct sockaddr*)&client_addr, &c);
        if (client_sock == INVALID_SOCKET) {
            printf("Accept failed with error code : %d\n", WSAGetLastError());
            continue;
        }
        
        printf("Connection accepted.\n");
        
        Client* new_client = (Client*)malloc(sizeof(Client));
        new_client->sock = client_sock;
        new_client->is_active = true;
        new_client->score = 0;
        new_client->has_guessed = false;
        strcpy(new_client->username, "Anonymous");
        
        unsigned thread_id;
        _beginthreadex(NULL, 0, client_handler, (void*)new_client, 0, &thread_id);
    }
    
    closesocket(server_socket);
    cleanup_winsock();
    return 0;
}
