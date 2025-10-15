import {joinChannel, leaveChannel, currentChannel, setupVoiceChat} from "/main/voice.js";
import { setupWebSocket } from "/main/persistent.js";
document.addEventListener('DOMContentLoaded', onLoad);
let socket;
let users = {};

function timeIntToString(time){
	const date = new Date(time * 1000);
	const day = date.getDate().toString().padStart(2, '0'); 
	const month = (date.getMonth() + 1).toString().padStart(2, '0'); 
	const year = date.getFullYear();
	const hours = date.getHours().toString().padStart(2, '0');
	const minutes = date.getMinutes().toString().padStart(2, '0');
	return `${hours}:${minutes} ${day}-${month}-${year}`;
}

function onLoad() {
	socket = setupWebSocket('ws://localhost:8000/persistent/ws');
	setupVoiceChat(socket);
	
	document.getElementById('send-button').addEventListener('click', sendMessage);
	document.getElementById("user-input").addEventListener("keydown", handle_input_key);
	document.getElementById("add-channel-button").addEventListener('click', addChannelButton);
	document.getElementById("new-invite-button").addEventListener('click', createInviteCode);
	document.getElementById("sidebar-button").addEventListener('click', toggleSidebar);
	document.getElementById("profile-picture-input").addEventListener('change', changeProfilePicture);
	const chatWindow = document.getElementById('chat-window');
	chatWindow.addEventListener("scroll", () => {
		if (chatWindow.scrollTop < 100) { // user scrolled near top
			loadOlderMessages(chatWindow);
		}
	});
}

function toggleSidebar(){
	const sidebarDiv = document.getElementById('sidebar');
	if (sidebarDiv.style.display === "inline-block" || !sidebarDiv.style.display){
		sidebarDiv.style.display = 'none';
	} else {
		sidebarDiv.style.display = 'inline-block';
	}
}

//Message stuff

export async function addMessage(channel, username, message, created_at, store=true) {
	if (message.trim() === "") return;
	const userDiv = `<div style="display:flex;border-bottom:1px solid var(--color-border);min-width:200px;">
			${username}
				<div style="margin-left:auto">
				${timeIntToString(created_at)}
				</div>
			</div>`;
	const messageHTML = `
	<div class="item_row user" style="max-width:90vw;">
		<div class="left_item">
			${userDiv}
			<div>
			${message}
			</div>
		</div>
	</div>`;
	if (store){
		const channelJSON = localStorage.getItem(`channel-history-${channel}`) || '[""]';
		const channelMessages = JSON.parse(channelJSON);
		channelMessages.push(messageHTML);
		if (channelMessages.length > 50){
			channelMessages.splice(0, 1);
		}
		localStorage.setItem(`channel-history-${channel}`, JSON.stringify(channelMessages));
		const currentChannel = localStorage.getItem("channel") || "1";
		if (channel === currentChannel){
			const chatWindow = document.getElementById("chat-window");
			chatWindow.innerHTML = channelMessages.join("\n");
			chatWindow.scrollTop = chatWindow.scrollHeight;
		}
	} else {
		const chatWindow = document.getElementById('chat-window');
		chatWindow.innerHTML = messageHTML + chatWindow.innerHTML;
	}
}

async function sendMessage() {
	const input = document.getElementById("user-input");
	if (input.value.trim() === "") return;
	const channel = localStorage.getItem("channel") || "1";
	socket.send(JSON.stringify({"type":"message", "data":{channel:channel, "msg":input.value}}));
	input.value = "";
}

let isLoading = false;
let oldestMessage = 50;
let hasMore = true;
async function loadOlderMessages(chatWindow){
  	if (isLoading || !hasMore) return;
  	isLoading = true;

	const oldScrollHeight = chatWindow.scrollHeight;
  	const oldScrollTop = chatWindow.scrollTop;

	const channelId = localStorage.getItem('channel');
	const session = localStorage.getItem("session");

	const res = await fetch('/load_messages', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ "session_key":session, "channel_id":channelId, "from_message": oldestMessage})
	});
	if (!res.ok) {
		const { error } = await res.json().catch(() => ({}));
		console.log(error);
		return;
	}
	
	const data = await res.json();
	console.log(data);

	oldestMessage += 50;
	const newScrollHeight = chatWindow.scrollHeight;
    chatWindow.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);

	if (data.result.length == 0){
		hasMore = false;
		return;
	}

	data.result.forEach(post => {
		addMessage(channelId, users[post.user_id], post.content, post.created_at, false);
	});
	isLoading = false;
}

//Channel stuff

export function addChannel(name, id, connected_users = []){
	const channelsDiv = document.getElementById("channels");
	const channelDiv = document.createElement("div");
	channelDiv.className = "sidebar-item";
    channelDiv.innerHTML = `
		<div style="display:flex">
			<div id="channel-${id}-name" style="margin-top:auto;margin-bottom:auto">${name}</div>
			<div id="channel-${id}-join-button" class="btn join-channel-button" style="margin-left:auto;padding:8px">🎤</div>
		</div>
		<div id="channel-${id}-users" style="display:flex">
			${connected_users.map(user => `
            	<img src="./images/users/${user}.webp" style="width:25px; margin-right: 2px;" title="${user}">
        	`).join('')}
		</div>
		`;
    channelDiv.id = `channel-${id}`;
	channelDiv.addEventListener('click', (event)=>{
		displayChannel(id, name);
	});
	channelsDiv.appendChild(channelDiv);

	const joinButton = document.getElementById(`channel-${id}-join-button`);
	joinButton.addEventListener('click', (event) =>{
		document.querySelectorAll(".join-channel-button").forEach((element)=>{
			element.innerHTML = "🎤";
		});
		if (currentChannel == id){
			leaveChannel();
		} else{
			joinChannel(id);
			joinButton.innerHTML = "✖";
		}
	});
}

function addChannelButton(e){
	const btn = document.getElementById("add-channel-item");
	btn.innerHTML = `
		<input id="channel-name" style="width:100%; margin-right:5px" placeholder="New channel name"></input>
		<button id="add-channel-add-button" class="btn">Add</button>
	`
	document.getElementById("add-channel-add-button").addEventListener('click', requestNewChannel);
}

async function displayChannel(id, name){
	localStorage.setItem("channel", id);
	const chatWindow = document.getElementById("chat-window");
	const string = localStorage.getItem(`channel-history-${id}`) || '[""]';
	const json = JSON.parse(string);
	chatWindow.innerHTML = json.join("\n");
	document.getElementById('chat-header-text').innerText = name;
	chatWindow.scrollTop = chatWindow.scrollHeight;
	document.getElementById('channels').childNodes.forEach((child) =>{
		child.style.background = "var(--color-items)";
	});
	document.getElementById(`channel-${id}`).style.background = "var(--color-button-h)";
}

async function requestNewChannel(){
	const channelName = document.getElementById("channel-name").value;
	const session = localStorage.getItem("session");
	const res = await fetch('/channel', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ "session_key":session, "name":channelName })
	});
	if (!res.ok) {
		const { error } = await res.json().catch(() => ({}));
		console.log(error);
		return;
	}
	
	const data = await res.json();
	console.log(data);
}

//Settings stuff

function handle_input_key(e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		document.getElementById("send-button").click();
	}
}

async function changeProfilePicture(e){
	const session = localStorage.getItem("session");
	const file = e.target.files[0];		
	const extension = file.name.split('.').pop();

	if (!file || !file.type.startsWith('image/')) {
        console.log('Please select a valid image file');
        return;
	}

	const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
    });

	const res = await fetch('/change_profile_picture', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ "session_key":session, "file":base64, "extension":extension })
	});
	if (!res.ok) {
		const { error } = await res.json().catch(() => ({}));
		console.log(error);
		return;
	}
	
	const data = await res.json();
	console.log(data);
	location.href = "/";
}

//Login & Signup stuff

async function createInviteCode(){
	const session = localStorage.getItem("session");
	const res = await fetch('/auth/invite', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ "session_key":session, "uses":"1" })
	});
	if (!res.ok) {
		const { error } = await res.json().catch(() => ({}));
		console.log(error);
        return;
	}
	
	const data = await res.json();
	console.log(data);
	const inviteDiv = document.getElementById("invite-code-item");
	inviteDiv.innerHTML = `Invite code: ${data["result"]}`;
}
