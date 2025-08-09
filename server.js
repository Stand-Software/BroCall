const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 80;

// Dicionário para gerenciar as salas e seus clientes
const rooms = {};
const clientToRoom = {};

// Serve o arquivo HTML do cliente
app.use(express.static(path.join(__dirname, '')));

wss.on('connection', ws => {
    const clientId = uuidv4();
    console.log(`Novo cliente conectado: ${clientId}`);

    // Adicionando um objeto para armazenar dados do cliente, como o nickname
    ws.clientId = clientId;
    ws.nickname = null;
    ws.roomId = null;

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            const currentRoomId = ws.roomId;

            switch (data.type) {
                case 'create_room':
                    const roomId = uuidv4().substring(0, 6).toUpperCase();
                    ws.roomId = roomId;
                    ws.nickname = data.nickname;
                    rooms[roomId] = { [clientId]: ws };
                    clientToRoom[clientId] = roomId;
                    ws.send(JSON.stringify({ type: 'room_created', roomId: roomId, clientId: clientId }));
                    console.log(`Sala criada: ${roomId} por ${ws.nickname} (${clientId})`);
                    break;
                
                case 'join_room':
                    const joinRoomId = data.roomId;
                    if (rooms[joinRoomId]) {
                        ws.roomId = joinRoomId;
                        ws.nickname = data.nickname;
                        
                        const existingClients = {};
                        Object.keys(rooms[joinRoomId]).forEach(existingClientId => {
                            const existingClientWs = rooms[joinRoomId][existingClientId];
                            
                            // Avisa os clientes existentes que um novo colega está chegando
                            existingClientWs.send(JSON.stringify({
                                type: 'new_peer',
                                newPeerId: clientId,
                                nickname: ws.nickname,
                            }));
                            
                            // Adiciona o nickname do cliente existente para o novo cliente
                            existingClients[existingClientId] = { nickname: existingClientWs.nickname };
                        });

                        rooms[joinRoomId][clientId] = ws;
                        clientToRoom[clientId] = joinRoomId;
                        ws.send(JSON.stringify({ type: 'join_success', roomId: joinRoomId, clientId: clientId, peers: existingClients }));
                        console.log(`Cliente ${ws.nickname} (${clientId}) entrou na sala ${joinRoomId}`);
                    } else {
                        ws.send(JSON.stringify({ type: 'join_error', message: 'Sala não encontrada.' }));
                        console.log(`Cliente ${clientId} tentou entrar em sala inexistente: ${joinRoomId}`);
                    }
                    break;

                // Adicionado: Novos tipos de mensagens para estado da mídia
                case 'toggle_video':
                case 'toggle_audio':
                case 'share_screen':
                case 'stop_share_screen':
                // Comandos de sinalização WebRTC para retransmissão
                case 'offer':
                case 'answer':
                case 'ice_candidate':
                    const targetClientId = data.targetId;
                    const targetWs = rooms[currentRoomId] && rooms[currentRoomId][targetClientId];
                    if (targetWs) {
                        data.senderId = clientId;
                        // O nickname é passado para a outra ponta
                        data.nickname = ws.nickname;
                        targetWs.send(JSON.stringify(data));
                    }
                    break;
            }
        } catch (error) {
            console.error(`Erro ao processar a mensagem do cliente ${clientId}:`, error);
        }
    });

    ws.on('close', () => {
        const clientId = ws.clientId;
        const currentRoomId = ws.roomId;
        if (currentRoomId && rooms[currentRoomId]) {
            const remainingClients = Object.keys(rooms[currentRoomId]).filter(id => id !== clientId);
            remainingClients.forEach(remainingClient => {
                const remainingWs = rooms[currentRoomId][remainingClient];
                remainingWs.send(JSON.stringify({ type: 'peer_disconnected', peerId: clientId }));
            });

            delete rooms[currentRoomId][clientId];
            delete clientToRoom[clientId];
            console.log(`Cliente ${ws.nickname} (${clientId}) saiu da sala ${currentRoomId}`);
            if (Object.keys(rooms[currentRoomId]).length === 0) {
                delete rooms[currentRoomId];
                console.log(`Sala ${currentRoomId} fechada por estar vazia.`);
            }
        }
        console.log(`Cliente desconectado: ${clientId}`);
    });
});

server.listen(PORT, () => {
    console.log(`Servidor do BroCall rodando na porta: ${PORT}`);
});
