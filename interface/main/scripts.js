import { onLoadVoice } from "/main/voice.js";
import { requestNewChannel, onLoadRequests, searchRequest } from "/main/requests.js";
import { onLoadPersistent } from "/main/persistent.js";
import { onLoadChannels, search } from "/main/channels.js";
document.addEventListener('DOMContentLoaded', onLoad);

function onLoad() {
	onLoadPersistent('ws://localhost:8000/persistent/ws');
	onLoadVoice();
	onLoadRequests();
	onLoadChannels();
	
	document.getElementById("user-input").addEventListener("keydown", handle_input_key);
	document.getElementById("add-channel-button").addEventListener('click', addChannelButton);
	document.getElementById("search-button").addEventListener('click', search);
	document.getElementById("main-image").addEventListener('click', e => {location.href = "/"});
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
