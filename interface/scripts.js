import {joinChannel, leaveChannel, currentChannel, setupVoiceChat} from "./voice.js";
document.addEventListener('DOMContentLoaded', onLoad);
let socket;

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
	const session = localStorage.getItem("session");
	if (session){
		setupConnection();
		document.getElementById('container').style.display = "flex";
		document.getElementById('login').style.display = "none";
	}
	document.getElementById('login-button').addEventListener('click', onLoginButton);
	document.getElementById('send-button').addEventListener('click', sendMessage);
	document.getElementById("user-input").addEventListener("keydown", handle_input_key);
	document.getElementById("add-channel-button").addEventListener('click', addChannelButton);
	document.getElementById("new-invite-button").addEventListener('click', createInviteCode);
	document.getElementById("sidebar-button").addEventListener('click', toggleSidebar);
	document.getElementById("profile-picture-input").addEventListener('change', changeProfilePicture);
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

function toggleSidebar(){
	const sidebarDiv = document.getElementById('sidebar');
	if (sidebarDiv.style.display === "inline-block" || !sidebarDiv.style.display){
		sidebarDiv.style.display = 'none';
	} else {
		sidebarDiv.style.display = 'inline-block';
	}
}

function addChannel(name, id, connected_users){
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

async function setupConnection() {
	socket = new WebSocket('ws://localhost:8000/persistent/ws');
	socket.addEventListener('open', (event) => {
		const session = localStorage.getItem("session");
		socket.send(JSON.stringify({"type":"hello", "data":{"session":session}}));
		console.log('Connected to server');
	});

	socket.addEventListener('message', (event) => {
		console.log(event.data);
		const data = JSON.parse(event.data);
		if (data.msg){
			addMessage(data.channel, data.username, data.msg, data.created_at);
		}
		if (data.channels){
			document.getElementById("channels").innerHTML = "";
			data.channels.forEach(channel => {
				addChannel(channel.name, channel.id, channel.connected_users);
			});
			displayChannel(data.channels[0].id, data.channels[0].name);
		}
		if (data.status){
			localStorage.removeItem("session");
			location.href = "/";
		}
		if (data.type === "channel_users") {
			document.getElementById(`channel-${data.channel_id}-users`).innerHTML = data.users.map(user => `
            	<img src="./images/users/${user}.webp" style="width:25px; margin-right: 2px;" title="${user}">
        	`).join('');
		}
	});
	socket.addEventListener('close', (event) => {
		console.log('Disconnected from server');
		location.href = "/";
	});

	socket.addEventListener('error', (event) => {
		console.error('WebSocket error:', event);
	});
	setupVoiceChat(socket);
}

async function addMessage(channel, username, message, created_at) {
	if (message.trim() === "") return;
	const date = timeIntToString(created_at);
	const messageHTML = `
	<div class="item_row user" style="max-width:90vw;">
		<div class="left_item">
			<div style="display:flex;border-bottom:1px solid var(--color-border);min-width:200px;">
			${username}
				<div style="margin-left:auto">
				${date}
				</div>
			</div>
			<div>
			${message}
			</div>
		</div>
	</div>`;
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

async function sendMessage() {
	const input = document.getElementById("user-input");
	if (input.value.trim() === "") return;
	const channel = localStorage.getItem("channel") || "1";
	socket.send(JSON.stringify({"type":"message", "data":{channel:channel, "msg":input.value}}));
	input.value = "";
}

function handle_input_key(e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		document.getElementById("send-button").click();
	}
}

function generateTOTPQRCode(secret, issuer, accountName) {
	const totpUri = `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}`;
	var qrcode = new QRCode(document.getElementById("qrcode"), {
		text: totpUri,
		width: 256,
		height: 256,
		colorDark : "#000000",
		colorLight : "#ffffff",
		correctLevel : QRCode.CorrectLevel.H
	});
}

async function onLoginButton(){
	const codeDiv = document.getElementById('login-code');
	const usernameDiv = document.getElementById('login-username');
	const code = codeDiv.value;
	const username = usernameDiv.value;
	if (code.length > 6 || (username == "admin" && code.length == 0)){
		signup(username, code);
	} else {
		login(username, code);
	}
	codeDiv.value = "";
}

async function signup(username, invite_code){
	const res = await fetch('/auth/signup', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ "username":username, "invite_code":invite_code })
	});
	if (!res.ok) {
		const { error } = await res.json().catch(() => ({}));
		console.log(error);
        return;
	}
	
	const data = await res.json();
	console.log(data);
	generateTOTPQRCode(data["result"], "Buzz", username);
}

async function login(username, totp_code){
	const res = await fetch('/auth/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ "username":username, "totp_code":totp_code })
	});
	if (!res.ok) {
		const { error } = await res.json().catch(() => ({}));
		console.log(error);
        return;
	}
	
	const data = await res.json();
	console.log(data);
	localStorage.setItem("session", data["result"]);
	if (data["status"] == "success"){
		setupConnection();
		document.getElementById('container').style.display = "flex";
		document.getElementById('login').style.display = "none";
	}
}