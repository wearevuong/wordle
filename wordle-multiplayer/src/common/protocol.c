#include "protocol.h"
#include <stdio.h>
#include <string.h>

int init_winsock(void) {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2,2), &wsa) != 0) {
        printf("Failed to initialize Winsock. Error Code: %d\n", WSAGetLastError());
        return -1;
    }
    return 0;
}

void cleanup_winsock(void) {
    WSACleanup();
}

int send_msg(SOCKET sock, const char* payload) {
    uint32_t len = strlen(payload);
    uint32_t net_len = htonl(len);
    
    // Send 4-byte length prefix
    int sent = send(sock, (const char*)&net_len, sizeof(net_len), 0);
    if (sent != sizeof(net_len)) {
        return -1;
    }
    
    // Send payload
    if (len > 0) {
        uint32_t total_sent = 0;
        uint32_t bytes_left = len;
        
        while (total_sent < len) {
            int n = send(sock, payload + total_sent, bytes_left, 0);
            if (n <= 0) break;
            total_sent += n;
            bytes_left -= n;
        }
        
        if (total_sent != len) return -1;
    }
    
    return len;
}

int recv_msg(SOCKET sock, char* payload_out, int max_len) {
    uint32_t net_len;
    // Receive 4-byte length
    int recvd = 0;
    int bytes_left = sizeof(net_len);
    char *len_buf = (char*)&net_len;
    
    while (recvd < sizeof(net_len)) {
        int n = recv(sock, len_buf + recvd, bytes_left, 0);
        if (n <= 0) return -1; // Connection closed or error
        recvd += n;
        bytes_left -= n;
    }
    
    uint32_t len = ntohl(net_len);
    if (len > (uint32_t)max_len - 1) { // -1 to leave space for null terminator
        printf("Payload too large: %u\n", len);
        return -1;
    }
    
    // Receive payload
    recvd = 0;
    bytes_left = len;
    
    while (recvd < len) {
        int n = recv(sock, payload_out + recvd, bytes_left, 0);
        if (n <= 0) return -1;
        recvd += n;
        bytes_left -= n;
    }
    
    payload_out[len] = '\0'; // Null-terminate string
    return len;
}
