import { socket, user_id as current_user_id } from "/main/persistent.js";
let currentVoiceChannel = -1;
const peerConnections = new Map();
export const userVolumePrefs = JSON.parse(localStorage.getItem("userVolumePrefs") || "{}");
const userAudioElements = new Map();
let localStream; 
let masterVolume = parseFloat(localStorage.getItem("masterVolume") || "1.0");

export function getCurrentVoiceChannel(){
    return currentVoiceChannel;
}

async function createOfferFor(targetUserId) {
    const pc = new RTCPeerConnection();
    peerConnections.set(targetUserId, pc);
    
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    
    pc.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        const savedVolume = userVolumePrefs[targetUserId] ?? 1.0;
        audio.volume = savedVolume * masterVolume;
        audio.play();
        userAudioElements.set(targetUserId, audio);
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
    if (channelId === -1) return; 
    if (currentVoiceChannel != -1){
        leaveChannel();
        if (channelId == currentVoiceChannel) return;
    }
    if (!localStream){
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    socket.send(JSON.stringify({
        "type": "vc_connect",
        "data": {"channel_id": channelId}
    }));
    currentVoiceChannel = channelId;
}

export function leaveChannel() {
    if (currentVoiceChannel == -1) return;
    socket.send(JSON.stringify({
        "type": "vc_disconnect",
        "data": {}
    }));
    
    // Close all peer connections
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    currentVoiceChannel = -1;
    userAudioElements.forEach(audio => audio.pause());
    userAudioElements.clear();
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
    const audio = userAudioElements.get(user_id);
    if (audio) {
        audio.pause();
        userAudioElements.delete(user_id);
    }
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

export function getUserVolume(userId){
    return 
}

export function setUserVolume(userId, volume) {
    const clampedVolume = Math.min(Math.max(volume, 0), 1);
    userVolumePrefs[userId] = clampedVolume;
    const audio = userAudioElements.get(userId);
    if (audio) {
        audio.volume = clampedVolume * userVolumePrefs[current_user_id];
    }
    localStorage.setItem("userVolumePrefs", JSON.stringify(userVolumePrefs));
}