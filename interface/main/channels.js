import { channels, selected_channel, old_message } from "/main/persistent.js";
import { requestOlderMessages } from "/main/requests.js";
import { currentChannel, joinChannel, leaveChannel } from "/main/voice.js";

function timeIntToString(time){
	const date = new Date(time * 1000);
	const day = date.getDate().toString().padStart(2, '0'); 
	const month = (date.getMonth() + 1).toString().padStart(2, '0'); 
	const year = date.getFullYear();
	const hours = date.getHours().toString().padStart(2, '0');
	const minutes = date.getMinutes().toString().padStart(2, '0');
	return `${hours}:${minutes} ${day}-${month}-${year}`;
}

export function onLoadMessages(){
    document.getElementById("sidebar-button").addEventListener('click', toggleSidebar);
    document.getElementById("channels").addEventListener('click', onChannelListClick);
    const chatWindow = document.getElementById('chat-window');
	chatWindow.addEventListener("scroll", () => {
		if (chatWindow.scrollTop < 100) {
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

function onChannelListClick(event){
    const channelItem = event.target.closest('.sidebar-item');
    if (channelItem) {
        const channelId = channelItem.dataset.channelId;
        displayChannel(channels[channelId - 1]);
    }
    
    const joinButton = event.target.closest('.join-channel-button');
    if (joinButton) {
        event.stopPropagation();
        const channelId = joinButton.closest('.sidebar-item').dataset.channelId;
        
        document.querySelectorAll(".join-channel-button").forEach((element) => {
            element.innerHTML = "🎤";
        });
        
        if (currentChannel == channelId) {
            leaveChannel();
        } else {
            joinChannel(channelId);
            joinButton.innerHTML = "✖";
        }
    }
}

function createChannelDiv(channel){
    const id = channel.id;
    const channelHTML = `
    <div id="channel-${id}" data-channel-id="${id}" class="sidebar-item">
        <div style="display: flex;">
            <div id="channel-${id}-name" style="margin-top: auto; margin-bottom: auto;">
                ${channel.name}
            </div>
            <div id="channel-${id}-join-button" class="btn join-channel-button" style="margin-left: auto; padding: 8px;">
                🎤
            </div>
        </div>
        <div id="channel-${id}-users" style="display: flex;">
            ${channel.connected_users.map(user => `
                <img 
                    src="./images/users/${user}.webp" 
                    style="width: 25px; margin-right: 2px;" 
                    title="${user}"
                >
            `).join('')}
        </div>
    </div>`;
    return channelHTML;
}

export function loadChannels(channels){
    const channelList = document.getElementById('channels');
    const channelDivs = channels.map(createChannelDiv);
    channelList.innerHTML = channelDivs.join('');
}

export function displayChannel(channel){
    if(!channel) return;
    localStorage.setItem("channel", channel.id);
    const chatWindow = document.getElementById("chat-window");
    if (!channel.posts) channel.posts = [];
    const messageDivs = channel.posts.map(createPostDiv);
    chatWindow.innerHTML = messageDivs.join("");
    document.getElementById('chat-header-text').innerText = channel.name;
	chatWindow.scrollTop = chatWindow.scrollHeight;
	document.getElementById('channels').childNodes.forEach((child) => {
        if (child.style){
            child.style.background = "var(--color-items)";
        }
    });
    document.getElementById(`channel-${channel.id}`).style.background = "var(--color-button-h)";
	hasMore = true;
}

function createPostDiv(post){
    if (post.content.trim() === "") return;
	const userDiv = `
    <div style="display:flex;border-bottom:1px solid var(--color-border);min-width:200px;">
        ${post.username}
            <div style="margin-left:auto">
            ${timeIntToString(post.created_at)}
            </div>
        </div>`;
	const messageHTML = `
	<div class="item_row user" style="max-width:90vw;">
		<div class="left_item">
			${userDiv}
			<div>
			${post.content}
			</div>
		</div>
	</div>`;
    return messageHTML;
}

let isLoading = false;
let oldestMessage = 50;
let hasMore = true;
async function loadOlderMessages(chatWindow){
    if (isLoading || !hasMore) return;
    isLoading = true;

    const oldScrollHeight = chatWindow.scrollHeight;
    const oldScrollTop = chatWindow.scrollTop;

    const session = localStorage.getItem("session");
    
    const data = await requestOlderMessages(session, selected_channel, oldestMessage);
    oldestMessage += 50;

    if (data.result.length == 0){
        hasMore = false;
        return;
    }

    data.result.forEach(post => old_message(post));
    displayChannel(channels[selected_channel - 1]);
    //chatWindow.innerHTML = postDivs.join("") + chatWindow.innerHTML;

    const newScrollHeight = chatWindow.scrollHeight;
    chatWindow.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
    isLoading = false;
}