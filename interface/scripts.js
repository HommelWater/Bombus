document.addEventListener('DOMContentLoaded', onLoad);
let socket;

function onLoad() {
	setupConnection();
	document.getElementById('send-button').addEventListener('click', sendMessage);
	document.getElementById("user-input").addEventListener("keydown", handle_input_key);
}

async function setupConnection() {
	socket = new WebSocket('ws://localhost:8000/ws');
	socket.addEventListener('open', (event) => {
		console.log('Connected to server');
		socket.send('Hello Server!');
	});

	socket.addEventListener('message', (event) => {
		addMessage(event.data)
	});
	socket.addEventListener('close', (event) => {
		console.log('Disconnected from server');
	});

	socket.addEventListener('error', (event) => {
		console.error('WebSocket error:', event);
	});
}

async function addMessage(message) {
	const chat_window = document.getElementById("chat-window");
	if (message.trim() === "") return;

	const message_div = document.createElement("div");
	message_div.className = "item_row user";
	message_div.innerHTML = `<div class="left_item">${message}</div>`;
	chat_window.appendChild(message_div);

	chat_window.scrollTop = chat_window.scrollHeight;
	localStorage.setItem("chat_history", chat_window.innerHTML);
}

async function sendMessage() {
	const input = document.getElementById("user-input");
	if (input.value.trim() === "") return;
	socket.send(input.value);
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