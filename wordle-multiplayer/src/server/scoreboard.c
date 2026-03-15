#include "server.h"
#include <stdio.h>
#include <string.h>
#include <stdbool.h>

#define MAX_SCORES 100

typedef struct {
    char username[MAX_USERNAME];
    int score;
} ScoreEntry;

ScoreEntry scores[MAX_SCORES];
int score_count = 0;
CRITICAL_SECTION score_lock;

void init_scores(void) {
    InitializeCriticalSection(&score_lock);
    FILE* file = fopen("data/scores.dat", "r");
    if (!file) return;
    
    char name[MAX_USERNAME];
    int sc;
    while(fscanf(file, "%s %d", name, &sc) == 2) {
        if (score_count < MAX_SCORES) {
            strcpy(scores[score_count].username, name);
            scores[score_count].score = sc;
            score_count++;
        }
    }
    fclose(file);
}

void save_scores(void) {
    FILE* file = fopen("data/scores.dat", "w");
    if (!file) return;
    for(int i=0; i<score_count; i++){
        fprintf(file, "%s %d\n", scores[i].username, scores[i].score);
    }
    fclose(file);
}

void update_score_file(const char* username, int points) {
    EnterCriticalSection(&score_lock);
    bool found = false;
    for(int i=0; i<score_count; i++){
        if (strcmp(scores[i].username, username) == 0) {
            scores[i].score += points;
            found = true;
            break;
        }
    }
    if (!found && score_count < MAX_SCORES) {
        strcpy(scores[score_count].username, username);
        scores[score_count].score = points;
        score_count++;
    }
    
    // Sort descending
    for (int i=0; i<score_count-1; i++) {
        for (int j=0; j<score_count-1-i; j++) {
            if (scores[j].score < scores[j+1].score) {
                ScoreEntry tmp = scores[j];
                scores[j] = scores[j+1];
                scores[j+1] = tmp;
            }
        }
    }
    
    save_scores();
    LeaveCriticalSection(&score_lock);
}

void get_top_scores(char* output_buffer, int max_len) {
    EnterCriticalSection(&score_lock);
    strcpy(output_buffer, "=== HIGH SCORES ===\n");
    for(int i=0; i < score_count && i < 10; i++){
        char line[128];
        sprintf(line, "%d. %s - %d pts\n", i+1, scores[i].username, scores[i].score);
        strcat(output_buffer, line);
    }
    LeaveCriticalSection(&score_lock);
}
