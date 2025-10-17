import { onLoadVoice } from "/main/voice.js";
import { requestNewChannel, onLoadRequests } from "/main/requests.js";
import { onLoadPersistent } from "/main/persistent.js";
import { onLoadMessages } from "/main/channels.js";
document.addEventListener('DOMContentLoaded', onLoad);

function onLoad() {
	onLoadPersistent('ws://localhost:8000/persistent/ws');
	onLoadVoice();
	onLoadRequests();
	onLoadMessages();
	
	document.getElementById("user-input").addEventListener("keydown", handle_input_key);
	document.getElementById("add-channel-button").addEventListener('click', addChannelButton);
}

function addChannelButton(e){
	const btn = document.getElementById("add-channel-item");
	btn.innerHTML = `
		<input id="channel-name" style="width:100%; margin-right:5px" placeholder="New channel name"></input>
		<button id="add-channel-add-button" class="btn">Add</button>
	`
	document.getElementById("add-channel-add-button").addEventListener('click', requestNewChannel);
}

function handle_input_key(e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		document.getElementById("send-button").click();
	}
}
