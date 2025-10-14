let socket = null;
export let currentChannel = -1;
const peerConnections = new Map();
let localStream = null;

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

async function createOfferForUser(targetUserId) {
    const pc = new RTCPeerConnection();
    peerConnections.set(targetUserId, pc);
    
    // Add local stream
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    
    // Handle incoming stream
    pc.ontrack = (event) => {
        // Add remote audio to UI
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                "type": "vc_candidate",
                "data": {"id":targetUserId, "candidate":event.candidate}
            }));
        }
    };
    
    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket.send(JSON.stringify({
        "type": "vc_offer",
        "data": { "id": targetUserId, "offer": offer }
    }));
}

async function handleOffer(offer, fromUserId) {
    const pc = new RTCPeerConnection();
    peerConnections.set(fromUserId, pc);
    
    // Add local stream
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    
    pc.ontrack = (event) => {
        // Add remote audio
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                "type": "vc_candidate",
                "data": {"id":fromUserId, "candidate":event.candidate}
            }));
        }
    };
    
    // Set remote offer and create answer
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.send(JSON.stringify({
        "type": "vc_answer",
        "data": {"id": fromUserId, "answer": answer}
    }));
}

async function handleAnswer(answer, fromUserId) {
    const pc = peerConnections.get(fromUserId);
    if (pc) {
        await pc.setRemoteDescription(answer);
    }
}

async function handleCandidate(candidate, fromUserId) {
    const pc = peerConnections.get(fromUserId);
    if (pc) {
        await pc.addIceCandidate(candidate);
    }
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

export function setupVoiceChat(ws){
    socket = ws;
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch(data.type) {
            case "connect":
                // For each user in data.users, create offers
                data.users.forEach(userId => {
                    if (userId > data.current_user){
                        createOfferForUser(userId);
                        console.log(userId);
                    }
                });
                break;
            case "offer":
                handleOffer(data.offer, data.user_id);
                break;
            case "answer":
                handleAnswer(data.answer, data.user_id);
                break;
            case "candidate":
                handleCandidate(data.candidate, data.user_id);
                break;
            case "disconnect":
                // Close connection to disconnected user
                const pc = peerConnections.get(data.user[0]);
                if (pc) pc.close();
                peerConnections.delete(data.user[0]);
                break;
        }
    };
}

