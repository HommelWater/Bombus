import { addMessage, addChannel, displayChannel } from "/main/scripts.js";
let socket;
export let users = {};

const base_packet_types = {
    "hello": hello,
    "message": message,
    "error":error,
    "vc_users":vc_users
}

function hello(data){
    localStorage.setItem('user_id', data.user_id);
    users = data.users;

    document.getElementById("channels").innerHTML = "";
    data.channels.forEach(channel => 
        addChannel(channel.name, channel.id, channel.connected_users));
    data.posts.reverse().forEach(post => 
        addMessage(post.channel, users[post.user_id], post.content, post.created_at));
    displayChannel(data.channels[0].id, data.channels[0].name);
}

function message(data){
    addMessage(data.channel, users[data.user_id], data.content, data.created_at);
	localStorage.setItem('latestPostId', data.id);
}

function error(data){
    console.log(data["error_message"]);
    if (data["reset"]) {
        localStorage.setItem("session", "");
        location.href = "/login";
    }
}

function vc_users(data){
    document.getElementById(`channel-${data.channel_id}-users`).innerHTML = data.users.map(user => `
        <img src="./images/users/${user}.webp" style="width:25px; margin-right: 2px;" title="${user}">
    `).join('');
}


//Websocket setup.
export function setupWebSocket(ws_url){
	socket = new WebSocket(ws_url);
    socket.addEventListener('open', onOpenSocket);
    socket.addEventListener('message', onMessageSocket);
    socket.addEventListener('close', onCloseSocket);
    socket.addEventListener('error', onErrorSocket);
    return socket;
}

function onMessageSocket(e){
    const data = JSON.parse(e.data);
    if (data.type in base_packet_types) base_packet_types[data["type"]](data["data"]); //Call whatever function the type specifies in base_packet_types.
}

function onOpenSocket(e){
    const session = localStorage.getItem("session");
    const latestPostId = localStorage.getItem('latestPostId') || '0';
    socket.send(JSON.stringify({"type":"hello", "data":{"session":session, "latest_post_id":latestPostId}}));
    console.log('Connected to server');
}

function onCloseSocket(e){
    console.log('Disconnected from server');
	location.href = "/";
}

function onErrorSocket(e){
	console.error('WebSocket error:', e);
}