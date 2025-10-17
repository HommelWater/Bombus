
import { displayChannel, loadChannels } from "/main/channels.js";
export let socket;
export let user_id;
export let users = {};
export let channels = {};
export let selected_channel = 1;
export let latest_post = 0;

const base_packet_types = {
    "hello": hello,
    "message": message,
    "error":error,
    "vc_users":vc_users
}

function hello(data){
    user_id = data.user_id;
    users = data.users;
    channels = data.channels;

    loadChannels(channels);
    data.posts.reverse().forEach(post => message(post));
    displayChannel(channels[selected_channel]);
}

function message(data){
    const channel = channels[data.channel - 1]
    if (!channel.posts) {
        channel.posts = [data];
        return;
    }
    let lastPost = channel.posts[channel.posts.length - 1];
    if (lastPost.username === data.username && lastPost.created_at > (data.created_at - 60)){
        channel.posts[channel.posts.length - 1].content += `<br>${data.content}`;
    } else {
        channel.posts.push(data);
    }
    latest_post = data.id;
    if (selected_channel === data.channel){
        displayChannel(channel);
    }
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
export function onLoadPersistent(ws_url){
	socket = new WebSocket(ws_url);
    socket.addEventListener('open', onOpenSocket);
    socket.addEventListener('message', onMessageSocket);
    socket.addEventListener('close', onCloseSocket);
    socket.addEventListener('error', onErrorSocket);
    document.getElementById('send-button').addEventListener('click', sendMessage);
}

async function sendMessage() {
	const input = document.getElementById("user-input");
	if (input.value.trim() === "") return;
	socket.send(JSON.stringify({"type":"message", "data":{channel:selected_channel, "content":input.value}}));
	input.value = "";
}

function onMessageSocket(e){
    const data = JSON.parse(e.data);
    if (data.type in base_packet_types) base_packet_types[data["type"]](data["data"]); //Call whatever function the type specifies in base_packet_types.
}

function onOpenSocket(e){
    const session = localStorage.getItem("session");
    socket.send(JSON.stringify({"type":"hello", "data":{"session":session, "latest_post_id":latest_post}}));
    console.log('Connected to server');
}

function onCloseSocket(e){
    console.log('Disconnected from server');
	location.href = "/";
}

function onErrorSocket(e){
	console.error('WebSocket error:', e);
}