
import { selected_channel, displayChannel, loadChannels, createVoiceChannelUserDiv, joinChannelVC } from "/main/channels.js";
import { currentVoiceChannel } from "/main/voice.js";
import { loadUsers, setActivity } from "/main/users.js";
export let socket;
export let user_id;
export let users = {};
export let channels = {};
export let latest_post = 0;
export let oldest_post = 0;

const base_packet_types = {
    "hello": hello,
    "message": message,
    "activity":activity,
    "error":error,
    "vc_users":vc_users
}

function activity(data){
    setActivity(data.user_id, data.active);
}

function hello(data){
    user_id = data.user_id;
    data.users.forEach(user=>{
        users[user.id] = user;
    });
    loadUsers(data.users);
    data.channels.forEach(channel => {
        channels[channel.id] = channel;
    });
    channels[-1] = {"connected_users":[], "id":"search", "name":"Search", "posts":[]};
    loadChannels(channels);
    data.posts.reverse().forEach(post => message(post));
    displayChannel(channels[selected_channel]);
    Object.values(channels).forEach(channel=>{
        channel.connected_users.forEach(user=>{
            if (user === user_id){
                joinChannelVC(channel.id);
            }
        })
    })
}

export function setPosts(channel_id, posts){
    channels[channel_id].posts = posts;
}

function message(data){
    new_message(data)
    if (selected_channel === data.channel){
        displayChannel(channels[data.channel]);
    }
}

export function new_message(data){
    const channel = channels[data.channel];
    data.username = users[data.user_id].username;
    if (!channel.posts) {
        channel.posts = [data];
        return;
    }
    const lastPost = channel.posts[channel.posts.length - 1];
    if (lastPost.username === data.username && lastPost.created_at > (data.created_at - 60)){
        lastPost.content += `<br>${data.content}`;
    } else {
        channel.posts.push(data);
    }
    latest_post = data.id;
}

export function old_message(data){
    const channel = channels[data.channel];
    data.username = users[data.user_id].username;
    if (!channel.posts) {
        channel.posts = [data];
        return;
    }
    let firstPost = channel.posts[0];
    if (firstPost.username === data.username && data.created_at > (firstPost.created_at - 60)){
        firstPost.content = `${data.content}<br>${firstPost.content}`;
    } else {
        channel.posts.unshift(data);
    }
    oldest_post = data.id;
}

function error(data){
    console.log(data["error_message"]);
    if (data["reset"]) {
        localStorage.setItem("session", "");
        location.href = "/login";
    }
}

function vc_users(data){
    const channelDiv = document.getElementById(`channel-${data.channel_id}-users`)
    channelDiv.innerHTML = data.users.map(user=>createVoiceChannelUserDiv(user, data.channel_id)).join('');
    channelDiv.style =`${data.channel_id === currentVoiceChannel ? `` : `display:flex;`}`
    document.querySelectorAll(`.slider`).forEach(d=>d.style.display = "none");
    if (data.channel_id === currentVoiceChannel){
        document.querySelectorAll(`.volume-${data.channel_id}`).forEach(d=>d.style.display = "inline-block");
    }
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
    console.log(data);
    if (data.type in base_packet_types) base_packet_types[data["type"]](data["data"]); //Call whatever function the type specifies in base_packet_types.
}

function onOpenSocket(e){
    const session = localStorage.getItem("session");
    socket.send(JSON.stringify({"type":"hello", "data":{"session":session, "latest_post_id":latest_post}}));
    console.log('Connected to server');
}

function onCloseSocket(e){
    console.log('Disconnected from server');
    socket.send(JSON.stringify({"type":"activity", "data":{"active":false}}))
}

function onErrorSocket(e){
	console.error('WebSocket error:', e);
}