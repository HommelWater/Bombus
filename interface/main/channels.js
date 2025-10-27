import { channels, old_message, new_message, setPosts, postRange } from "/main/persistent.js";
import { requestOlderPosts, requestNewerPosts, requestPostContext, searchRequest } from "/main/requests.js";
import { currentVoiceChannel, joinChannel, leaveChannel } from "/main/voice.js";
export let selected_channel = 1;

function timeIntToString(time){
	const date = new Date(time * 1000);
	const day = date.getDate().toString().padStart(2, '0'); 
	const month = (date.getMonth() + 1).toString().padStart(2, '0'); 
	const year = date.getFullYear();
	const hours = date.getHours().toString().padStart(2, '0');
	const minutes = date.getMinutes().toString().padStart(2, '0');
	return `${hours}:${minutes} ${day}-${month}-${year}`;
}

export function onLoadChannels(){
    document.getElementById("sidebar-button").addEventListener('click', toggleSidebar);
    document.getElementById("channels").addEventListener('click', onChannelListClick);
    const chatWindow = document.getElementById('chat-window');
	chatWindow.addEventListener("scroll", () => {
		if (chatWindow.scrollTop < 50) {
			loadOlderPosts(chatWindow);
		}
        const scrollBottom = chatWindow.scrollHeight - chatWindow.scrollTop - chatWindow.clientHeight;
        if (scrollBottom < 50) {
            loadNewerPosts(chatWindow);
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
        displayChannel(channels[channelId], -1);
    }
    
    const joinButton = event.target.closest('.join-channel-button');
    if (joinButton) {
        event.stopPropagation();
        const channelId = joinButton.closest('.sidebar-item').dataset.channelId;
        joinChannelVC(channelId);
    }
}

export function joinChannelVC(channelId){
    const joinButton = document.getElementById(`channel-${channelId}-join-button`);
    document.querySelectorAll(".join-channel-button").forEach((element) => {
        element.innerHTML = "🎤";
    });
    if (currentVoiceChannel == channelId) {
        leaveChannel();
    } else {
        joinChannel(channelId);
        joinButton.innerHTML = "✖";
    }
}

export function createVoiceChannelUserDiv(user, channel){
    const html = `
    <div class="vc-user" style="display:flex;">
        <img src="./images/users/${user}.webp" style="width:25px;height:25px; margin-right: 2px;" title="${user}">
        <input type="range" min="1" max="100" value="100" class="slider volume-${channel}" id="volume-${user}">
    </div>
    `;
    return html
}

function createChannelDiv(channel){
    const id = channel.id;
    const channelHTML = `
    <div id="channel-${id}" data-channel-id="${id}" class="sidebar-item" ${channel.id == -1 ? `style="display:none"`:``}>
        <div style="display: flex;">
            <div id="channel-${id}-name" style="margin-top: auto; margin-bottom: auto;">
                ${channel.name}
            </div>
            <div id="channel-${id}-join-button" class="btn join-channel-button left" style="margin-left: auto; padding: 8px;">
                🎤
            </div>
        </div>
        <div id="channel-${id}-users" style="display:flex;">
            ${channel.connected_users.map(user=>createVoiceChannelUserDiv(user, channel.id)).join('')}
        </div>
    </div>`;
    return channelHTML;
}

export function loadChannels(channels){
    const channelList = document.getElementById('channels');
    const channelDivs = Object.values(channels).map(createChannelDiv);
    channelList.innerHTML = channelDivs.join('');
}

export function displayChannel(channel, highlighted_post){
    if(!channel) return;
    selected_channel = channel.id;
    const chatWindow = document.getElementById("chat-window");
    if (!channel.posts) channel.posts = [];
    const messageDivs = channel.posts.map(createPostDiv);
    chatWindow.innerHTML = messageDivs.join("");
    document.getElementById('chat-header-text').innerText = channel.name;
	document.getElementById('channels').childNodes.forEach((child) => {
        if (child.style){
            child.style.background = "var(--color-items)";
        }
    });
    document.getElementById(`channel-${channel.id}`).style.background = "var(--color-button-h)";
    hasMoreNew = true;
    hasMoreOld = true;
    if (highlighted_post && highlighted_post != -1) {
        const target = document.getElementById(`post-${highlighted_post}`);
        if (target) {
            setTimeout(() => {chatWindow.scrollTop = target.offsetTop - chatWindow.clientHeight / 2;}, 20);
        }
    } else if (highlighted_post == -1){
        setTimeout(() => {chatWindow.scrollTop = chatWindow.scrollHeight;}, 20);
    }
}

export async function search(){
    const query = document.getElementById('search-bar').value;
	const res = await searchRequest(selected_channel, query);
    if(!res || res.status !== "success") return;
    const posts = res.result;
    const chatWindow = document.getElementById("chat-window");
    const postDivs = posts.map(post =>{
        const div = createPostDiv(post);
        return `<div class=search-post style="display:flex">${div}<button id="go-to-${post.id}" data-id="${post.id}" class="btn go-to-button">📄</button></div>`;
    });
    chatWindow.innerHTML = postDivs.join("");
    document.querySelectorAll('.go-to-button').forEach(d =>{
        d.addEventListener('click', e => displayPost(e.currentTarget.dataset.id));
    });
}

async function displayPost(post_id){
    const result = await requestPostContext(post_id);
    if(!result || result.status !== "success") return;
    const posts = result.result;
    setPosts(-1, posts);
    displayChannel(channels[-1], post_id);
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
	<div id="post-${post.id}" class="item_row user" style="max-width:90vw;">
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
let hasMoreOld = true;
async function loadOlderPosts(chatWindow){
    if (isLoading || !hasMoreOld) return;
    isLoading = true;

    const oldScrollHeight = chatWindow.scrollHeight;
    const oldScrollTop = chatWindow.scrollTop;

    const session = localStorage.getItem("session");
    const data = await requestOlderPosts(session, selected_channel, postRange.oldest);

    if (data.result.length == 0){
        hasMoreOld = false;
        return;
    }

    data.result.forEach(post => old_message(post));
    displayChannel(channels[selected_channel]);
    const newScrollHeight = chatWindow.scrollHeight;
    chatWindow.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
    isLoading = false;
}

let hasMoreNew = true;
async function loadNewerPosts(chatWindow) {
    if (isLoading || !hasMoreNew) return;
    isLoading = true;

    const session = localStorage.getItem("session");
    const data = await requestNewerPosts(session, selected_channel, postRange.latest);
    if (!data.result || data.result.length === 0) {
        hasMoreNew = false;
        isLoading = false;
        return;
    }

    data.result.forEach(post => new_message(post));
    displayChannel(channels[selected_channel], -1);

    const nearBottom = chatWindow.scrollHeight - chatWindow.scrollTop - chatWindow.clientHeight < 50;
    if (nearBottom) {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    isLoading = false;
}

function createChannelSettingsDiv(){
    const settingsHTML = `
        <div id="post-${post.id}-settings">
            <div id="rename-channel" class="setting"></div>
            <div id="delete-channel" class="setting"></div>
        </div>
    `;
    return settingsHTML;
}


function createPostSettingsDiv(post){
    const settingsHTML = `
        <div id="post-${post.id}-settings">
            <div id="delete-post" class="setting"></div>
            <div id="edit-post" class="setting"></div>
        </div>
    `;
    return settingsHTML;
}