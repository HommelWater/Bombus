import { socket } from "/main/persistent.js";
export let currentChannel = -1;
const peerConnections = new Map();
let localStream;

async function createOfferFor(targetUserId) {
    const pc = new RTCPeerConnection();
    peerConnections.set(targetUserId, pc);
    
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    
    pc.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
    };
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                "type": "vc_candidate",
                "data": {"id":targetUserId, "candidate":event.candidate}
            }));
        }
    };
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket.send(JSON.stringify({
        "type": "vc_offer",
        "data": { "id": targetUserId, "offer": offer }
    }));
}

export async function joinChannel(channelId) {
    if (currentChannel != -1){
        leaveChannel();
        if (channelId == currentChannel) return;
    }
    if (!localStream){
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    socket.send(JSON.stringify({
        "type": "vc_connect",
        "data": {"channel_id": channelId}
    }));
    currentChannel = channelId;
}

export function leaveChannel() {
    socket.send(JSON.stringify({
        "type": "vc_disconnect",
        "data": {"channel_id": currentChannel}
    }));
    
    // Close all peer connections
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    currentChannel = -1;
}

export function onLoadVoice(){
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type in voice_packet_types) voice_packet_types[data.type](data.data);
    }
}

async function connect(data){
    data.users.forEach(userId => {
        if (userId > data.current_user){
            createOfferFor(userId);
        }
    });
}

async function disconnect(data){
    const user_id = data.user_id;
    const pc = peerConnections.get(user_id);
    if (pc) pc.close();
    peerConnections.delete(user_id);
}

async function offer(data) {
    const offer = data.offer;
    const fromUserId = data.user_id;
    const pc = new RTCPeerConnection();
    peerConnections.set(fromUserId, pc);
    
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    
    pc.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
    };
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                "type": "vc_candidate",
                "data": {"id":fromUserId, "candidate":event.candidate}
            }));
        }
    };
    
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.send(JSON.stringify({
        "type": "vc_answer",
        "data": {"id": fromUserId, "answer": answer}
    }));
}

async function answer(data) {
    const answer = data.answer
    const fromUserId = data.user_id;
    const pc = peerConnections.get(fromUserId);
    if (pc) {
        await pc.setRemoteDescription(answer);
    }
}

async function candidate(data) {
    const candidate = data.candidate;
    const fromUserId = data.user_id;
    const pc = peerConnections.get(fromUserId);
    if (pc) {
        await pc.addIceCandidate(candidate);
    }
}

const voice_packet_types = {
    "offer":offer,
    "connect":connect,
    "answer":answer,
    "candidate":candidate,
    "disconnect":disconnect
}