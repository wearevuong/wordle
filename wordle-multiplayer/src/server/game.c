#include "server.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <process.h>

char word_list[5000][WORD_LEN + 1];
int word_count = 0;

void load_words(void) {
    FILE* file = fopen("data/words.txt", "r");
    if (!file) {
        printf("Could not open data/words.txt. Creating it...\n");
        file = fopen("data/words.txt", "w");
        if(file) {
            fprintf(file, "APPLE\nGRACE\nCRANE\nBRAVE\nTRAIN\nSMART\nMONEY\nHOUSE\nCLOCK\nWATER\n");
            fclose(file);
            file = fopen("data/words.txt", "r");
        }
    }
    
    if (file) {
        char buffer[256];
        while (fgets(buffer, sizeof(buffer), file)) {
            buffer[strcspn(buffer, "\r\n")] = '\0';
            if (strlen(buffer) == WORD_LEN) {
                for(int i = 0; buffer[i]; i++){
                    if(buffer[i] >= 'a' && buffer[i] <= 'z') buffer[i] -= 32;
                }
                strcpy(word_list[word_count], buffer);
                word_count++;
                if (word_count >= 5000) break;
            }
        }
        fclose(file);
        printf("Loaded %d words.\n", word_count);
    } else {
        strcpy(word_list[0], "APPLE");
        word_count = 1;
    }
}

char* get_random_word(void) {
    if (word_count == 0) return "APPLE";
    int idx = rand() % word_count;
    return word_list[idx];
}

void evaluate_guess(const char* secret, const char* guess, char* result) {
    int secret_counts[256] = {0};
    bool matched[WORD_LEN] = {false};
    
    for (int i = 0; i < WORD_LEN; i++) {
        secret_counts[(int)secret[i]]++;
        result[i] = 'x';
    }
    result[WORD_LEN] = '\0';
    
    // Exact matches
    for (int i = 0; i < WORD_LEN; i++) {
        if (guess[i] == secret[i]) {
            result[i] = 'v';
            secret_counts[(int)guess[i]]--;
            matched[i] = true;
        }
    }
    
    // Partial matches
    for (int i = 0; i < WORD_LEN; i++) {
        if (!matched[i] && secret_counts[(int)guess[i]] > 0) {
            result[i] = '~';
            secret_counts[(int)guess[i]]--;
        }
    }
}

unsigned __stdcall game_thread(void* arg) {
    srand((unsigned int)time(NULL) ^ (unsigned int)GetCurrentThreadId());
    Room* room = (Room*)arg;
    
    // Determine timeout from difficulty
    DWORD timeout_ms = (room->difficulty == DIFFICULTY_HARD) ? 30000 : 45000;
    int timeout_sec  = (room->difficulty == DIFFICULTY_HARD) ? 30 : 45;

    char msg[1024];
    sprintf(msg, "\n--- Game starting! Word length: %d. %d attempts. Mode: %s ---\n",
            WORD_LEN, room->total_rounds,
            room->difficulty == DIFFICULTY_HARD ? "HARD (30s)" : "EASY (45s)");
    broadcast_to_room(room, msg, NULL);
    
    strcpy(room->secret_word, get_random_word());
    printf("Room %s secret word: %s\n", room->room_code, room->secret_word);
    
    room->current_round = 1;
    bool game_won = false;
    
    while (room->current_round <= room->total_rounds && room->game_in_progress) {
        sprintf(msg, "--- Round %d starts! ---", room->current_round);
        broadcast_to_room(room, msg, NULL);

        // Broadcast countdown so frontend can start timer
        char countdown_msg[64];
        sprintf(countdown_msg, "COUNTDOWN:%d", timeout_sec);
        broadcast_to_room(room, countdown_msg, NULL);
        
        // Reset guesses
        EnterCriticalSection(&room->lock);
        room->guess_count = 0;
        for(int i=0; i<room->num_clients; i++) {
            room->clients[i]->has_guessed = false;
        }
        LeaveCriticalSection(&room->lock);
        
        // Wait for all clients to guess or timeout
        EnterCriticalSection(&room->lock);
        while (room->guess_count < room->num_clients && room->num_clients > 0) {
            BOOL res = SleepConditionVariableCS(&room->guess_cond, &room->lock, timeout_ms);
            if (!res) {
                // Timeout
                break;
            }
        }
        LeaveCriticalSection(&room->lock);
        
        // Evaluate and broadcast
        bool someone_won = false;
        char round_result[4096];
        sprintf(round_result, "\n=== Round %d Result ===\n", room->current_round);
        
        EnterCriticalSection(&room->lock);
        for(int i=0; i<room->num_clients; i++) {
            Client* c = room->clients[i];
            if (c->has_guessed) {
                char hint[WORD_LEN + 1];
                evaluate_guess(room->secret_word, c->current_guess, hint);
                char line[128];
                sprintf(line, "%s: %s -> %s\n", c->username, c->current_guess, hint);
                strcat(round_result, line);
                
                if (strcmp(hint, "vvvvv") == 0) {
                    someone_won = true;
                    c->score += 50;
                    update_score_file(c->username, 50);
                }
            } else {
                char line[128];
                sprintf(line, "%s: Did not guess.\n", c->username);
                strcat(round_result, line);
            }
        }
        LeaveCriticalSection(&room->lock);
        
        broadcast_to_room(room, round_result, NULL);
        
        if (someone_won) {
            game_won = true;
            sprintf(msg, "\nSomeone guessed the word! Game Over.\n");
            broadcast_to_room(room, msg, NULL);
            break;
        }
        
        room->current_round++;
    }
    
    if (!game_won) {
        sprintf(msg, "\nOut of attempts! The word was %s. Game Over.\n", room->secret_word);
        broadcast_to_room(room, msg, NULL);
    }
    
    // Broadcast Room Leaderboard
    char lb[4096] = "\n--- Room Leaderboard ---\n";
    EnterCriticalSection(&room->lock);
    for(int i=0; i<room->num_clients; i++){
        char line[128];
        sprintf(line, "%s: %d pts\n", room->clients[i]->username, room->clients[i]->score);
        strcat(lb, line);
    }
    LeaveCriticalSection(&room->lock);
    broadcast_to_room(room, lb, NULL);
    
    room->game_in_progress = false;
    return 0;
}

void start_game(Room* room) {
    if (room->game_in_progress) return;
    room->game_in_progress = true;
    _beginthreadex(NULL, 0, game_thread, (void*)room, 0, NULL);
}
