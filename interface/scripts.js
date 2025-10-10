document.addEventListener('DOMContentLoaded', onLoad);
let socket;

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
	loadHistory();
}

function addChannel(name, id){
	const sidebarDiv = document.getElementById("sidebar");
	const channelDiv = document.createElement("div");
	channelDiv.className = "sidebar-item";
    channelDiv.textContent = `${id}-${name}`;
    channelDiv.dataset.channelId = `channel-${id}`;
	channelDiv.addEventListener('click', (event)=>{
		localStorage.setItem("channel", id);
	})
	sidebarDiv.appendChild(channelDiv);
}

function addChannelButton(e){
	const btn = document.getElementById("add-channel-item");
	btn.innerHTML = `
		<input id="channel-name" style="width:100%; margin-right:5px" placeholder="New channel name"></input>
		<button id="add-channel-add-button" class="btn">Add</button>
	`
	document.getElementById("add-channel-add-button").addEventListener('click', (event) => {
		const channelName = document.getElementById("channel-name").value;
		const id = document.getElementById("sidebar").children.length;
		addChannel(channelName, id);
		//send a request to add the channel instead.
	});
}

async function createInviteCode(){
	const session = localStorage.getItem("session");
	const res = await fetch('/invite', {
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
	socket = new WebSocket('ws://localhost:8000/ws');
	socket.addEventListener('open', (event) => {
		const session = localStorage.getItem("session");
		socket.send(JSON.stringify({"session":session, "msg": 'Hello Server!'}));
		console.log('Connected to server');
	});

	socket.addEventListener('message', (event) => {
		console.log(event.data);
		data = JSON.parse(event.data);
		addMessage(data.username, data.msg);
	});
	socket.addEventListener('close', (event) => {
		console.log('Disconnected from server');
	});

	socket.addEventListener('error', (event) => {
		console.error('WebSocket error:', event);
	});
}

async function addMessage(username, message) {
	const chat_window = document.getElementById("chat-window");
	if (message.trim() === "") return;

	const message_div = document.createElement("div");
	message_div.className = "item_row user";
	message_div.innerHTML = `<div class="left_item">${username}: ${message}</div>`;
	chat_window.appendChild(message_div);

	chat_window.scrollTop = chat_window.scrollHeight;
	localStorage.setItem("chat_history", chat_window.innerHTML);
}

async function sendMessage() {
	const input = document.getElementById("user-input");
	if (input.value.trim() === "") return;
	const channel = localStorage.getItem("channel", "0");
	socket.send(JSON.stringify({"channel":channel, "msg":input.value}));
	input.value = "";
}

function handle_input_key(e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		document.getElementById("send-button").click();
	}
}

function loadHistory() {
	const chat_window = document.getElementById("chat-window");
	const chat_history = localStorage.getItem("chat_history");
	chat_window.innerHTML = chat_history;
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
	const res = await fetch('/signup', {
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
	const res = await fetch('/login', {
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
		setupConnection(); //still authenticate the user using the session token
		document.getElementById('container').style.display = "flex";
		document.getElementById('login').style.display = "none";
	}
}

