document.addEventListener('DOMContentLoaded', load);
const userVolumePrefs = JSON.parse(localStorage.getItem("userVolumePrefs") || "{}");
let masterVolume = parseFloat(localStorage.getItem("masterVolume") || "1.0");
let socket;
let localStream;
const state = {
    self_user: null,
    users: {},
    channels: {},
    vc_channel_users: {},
    vc_peers: {},
    vc_peer_audio:{},
    posts: [],
    posts_exhausted: false,
};
let current_text_channel = -1;
let current_voice_channel = -1;


//Helper
function isVisible(elem) {
    if (!elem) return false;
    const style = window.getComputedStyle(elem);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

//Is this solid enough? Am I gonna accidentally get people to add new channels when typing in the wrong box? :')
function handle_input_key(e) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();

        let el = e.target;
        console.log(el)
        while (el && el !== document.body) {
            const button = el.querySelector(
                "#send-button, #search-button, #add-channel-add-button, #rename-user-button"
            );
            if (button) {
                button.click();
                return;
            }
            el = el.parentElement;
        }
    }
}

function toggleSidebarDiv(){
	toggleDiv('sidebar-l', 'inline-block');
    toggleDiv('sidebar-r', 'inline-block');
}

function toggleDiv(id){
	const div = document.getElementById(id, type="block");
	if (isVisible(div)){
		div.style.display = 'none';
	} else {
		div.style.display = type;
	}
}

function search(){
    const query = document.getElementById("search-bar").value;
    setTextChannel(-1);
    socket.send(JSON.stringify({"type":"get_posts", "data":{"query":query}}));
}

function sendPost() {
	const input = document.getElementById("user-input");
	if (input.value.trim() === "") return;
	socket.send(JSON.stringify({"type":"send_post", "data":{"channel_id":current_text_channel, "content":input.value}}));
	input.value = "";
}

const MAX_BUFFERED_AMOUNT = 16 * 1024 * 1024;
async function sendChunk(socket, chunkData) {
    socket.send(JSON.stringify(chunkData));

    while (socket.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

async function hashFile(file) {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

const CHUNK_SIZE = 1024 * 1024;
async function uploadFiles() {
    const files = document.getElementById('files-input').files;

    for (const file of files) {
        const hash = await hashFile(file);

        await sendChunk(socket, {
            type: "file_upload",
            data: { name: file.name, size: file.size, hash }
        });

        const reader = new FileReader();
        let offset = 0;

        await new Promise((resolve, reject) => {
            reader.onerror = () => reject(reader.error);

            reader.onload = async function(event) {
                const chunk = event.target.result;

                await sendChunk(socket, {
                    type: "file_upload",
                    data: { hash, offset, chunk: Array.from(new Uint8Array(chunk)) }
                });

                offset += chunk.byteLength;

                if (offset < file.size) {
                    readNextChunk();
                } else {
                    resolve();
                }
            };

            function readNextChunk() {
                const slice = file.slice(offset, offset + CHUNK_SIZE);
                reader.readAsArrayBuffer(slice);
            }

            readNextChunk();
        });
    }
}

function changeProfilePicture(e, target_user_id) {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith('image/')) {
        console.log('Please select a valid image file');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        socket.send(JSON.stringify({"type":"set_pfp", "data":{"target_user_id":target_user_id, "file_base64":base64}}))
        //Maybe specific images only by reseting the src and adding a cache buster or broadcast the pfp change.
    };
    reader.onerror = error => console.error('File read error:', error);
    reader.readAsDataURL(file);
}

function toggleInviteCodeDiv(){
    const button = document.getElementById("new-invite-button");
    const codeDiv = document.getElementById("invite-code-subitem");
    if (!isVisible(codeDiv)){
        socket.send(JSON.stringify({"type":"get_invite", "data":{}}));
        codeDiv.style.display = "flex";
        button.style.display = "none";
    } else {
        codeDiv.style.display = "none";
        button.style.display = "block";
    }
}

function toggleCreateChannelDiv(){
    const button = document.getElementById("add-channel-button");
    const subitem = document.getElementById("add-channel-subitem");
    if (!isVisible(subitem)){
        subitem.style.display = "flex";
        button.style.display = "none";
    } else {
        const name = document.getElementById("channel-name").value;
        socket.send(JSON.stringify({"type":"create_channel", "data":{"name":name}}));
        subitem.style.display = "none";
        button.style.display = "block";
    }
}

function toggleDeleteChannelDiv(){
    const button = document.getElementById("delete-channel-button");
    const subitem = document.getElementById("delete-channel-subitem");
    if (!isVisible(subitem)){
        const select = document.getElementById('delete-channel-name');
        select.innerHTML = "";
        for (const [id, channel] of Object.entries(state.channels)) {
            const opt = document.createElement("option");
            opt.value = id;
            opt.textContent = channel.name;
            select.appendChild(opt);
        }
        subitem.style.display = "flex";
        button.style.display = "none";
    } else {
        const channel_id = document.getElementById("delete-channel-name").value;
        socket.send(JSON.stringify({"type":"delete_channel", "data":{"channel_id":channel_id}}));
        subitem.style.display = "none";
        button.style.display = "block";
    }
}

function toggleRenameUserDiv(e, user_id){
    e.stopPropagation();
    const button = document.getElementById("rename-user");
    const subitem = document.getElementById("rename-user-subitem");
    if (!isVisible(subitem)){
        subitem.style.display = "flex";
        button.style.display = "none";
    } else {
        const name = document.getElementById("rename-username").value;
        socket.send(JSON.stringify({"type":"set_username", "data":{"target_user_id":user_id, "username":name}}));
        subitem.style.display = "none";
        button.style.display = "block";
    }
}

function setChannelList(channels){
    const channelDivs = channels.map(channel =>{
        return `
            <div id="channel-${channel.id}" class="channel" data-id="${channel.id}">
                <div class="channel-main" style="display: flex;">
                    <div class="channel-name">
                        ${channel.name}
                    </div>
                    <div class="btn left channel-join-button">
                        🎤
                    </div>
                </div>
                <div class="channel-users"></div>
            </div>`
    });
    document.getElementById("channels").innerHTML = channelDivs.join("");
    const channelElements = document.querySelectorAll(".channel");
    channelElements.forEach(e => {
        e.addEventListener("click", ()=>setTextChannel(e.dataset.id));
        e.querySelector('.channel-join-button').addEventListener('click', (a)=>{
            setVoiceChannel(e.dataset.id);
            a.target.innerText = a.target.innerText == "🎤" ? "✖" : "🎤";
        });
    });
}

//Volume and user stuff seems convoluted.
function setVCUsers(){
    const channelElements = document.querySelectorAll(".channel");
    channelElements.forEach(e=>{
        const vcUsers = state.vc_channel_users[e.dataset.id];
        if (!vcUsers) return;
        const vcUserDivs = vcUsers.map((u_id)=>{
            return `
                <div id="vc-user-${u_id}" data-id="${u_id}" class="vc-user" style="display:flex;">
                    <img src="./images/users/1.webp" class="vc-user-icon">
                    <div class="vc-user-info">
                        <div class="vc-user-username">${state.users[u_id].username}</div>
                        ${vcUsers.includes(state.self_user) ? `<input type="range" min="1" max="100" value="${(userVolumePrefs[u_id] ?? 1.0) * 100}" class="volume-slider">` : ``}
                    </div>
                </div>`
        });
        const channelUsers = e.querySelector(`.channel-users`)
        channelUsers.innerHTML = vcUserDivs.join("");
        channelUsers.querySelectorAll(`.vc-user`).forEach(ue=>{
            const slider = ue.querySelector('.volume-slider');
            if (slider) slider.addEventListener('change', (slider)=>{
                setUserVolume(ue.dataset.id, slider.target.value / 100);
            });
        });
    });
}

function setUserVolume(userId, volume) {
    const clampedVolume = Math.min(Math.max(volume, 0), 1);
    userVolumePrefs[userId] = clampedVolume;
    const audio = state.vc_peer_audio[userId];
    if (audio) {
        audio.volume = clampedVolume * userVolumePrefs[state.self_user];
    }
    //if user == self, recalculate all the existing ones:
    if (userId == state.self_user){
        Object.entries(state.vc_peer_audio).forEach(([id, audio]) =>{
            audio.volume = userVolumePrefs[id] * userVolumePrefs[state.self_user];
        });
    }
    localStorage.setItem("userVolumePrefs", JSON.stringify(userVolumePrefs));
}

function setUserList(users){
    const userDivs = users.map((user)=>{
        return `<div id="user-${user.id}" data-id="${user.id}" class="sidebar-item user">
                    <div class="user-info-row" style="display: flex;">
                        <img class="user-icon" src="/images/users/${user.id}.webp">
                        <div style="margin-top: auto; margin-bottom: auto;">
                            ${user.username}
                        </div>
                        <div class="user-activity" style="margin-left: auto; padding: 8px;">
                            ${(user.last_activity && 
                                (Date.now() - user.last_activity < 5 * 60 * 1000))
                                ? "🟢" 
                                : "🔴"}
                        </div>
                    </div>
                </div>`
    });
    document.getElementById("user-list").innerHTML = userDivs.join("");
    const userElements = document.querySelectorAll(".user");
    userElements.forEach(e => e.addEventListener("click", ()=>toggleUserSettings(e.dataset.id)));
}

function toggleUserSettings(user_id){
    const selfUser = state.users[state.self_user];
    const user = state.users[user_id];
    const div = document.getElementById(`user-${user.id}`);

    //Close/delete settings if its already opened.
    const settingsDiv = div.querySelector(".user-settings");
    if (settingsDiv){
        settingsDiv.remove();
        return;
    }
    //Close all other user-settings.
    const existingUserSettings = document.querySelectorAll(".user-settings");
    if (existingUserSettings) existingUserSettings.forEach(d => d.remove());

    //Add the settings for the clicked user.
    if(selfUser.admin && !user.admin){
        const banText = user.banned ? 'Unban' : 'Ban';
        const restrictText = user.restricted ? 'Unrestrict' : 'Restrict';
        const adminText = 'Make Admin';
        
        const settingsHTML = `
            <div class="user-settings">
                <div id="ban-user" class="user-setting btn right">${banText}</div>
                <div id="restrict-user" class="user-setting btn right">${restrictText}</div>
                <div id="admin-user" class="user-setting btn right">${adminText}</div>
                <div id="rename-user" class="user-setting btn right">Rename</div>
                <div id="rename-user-subitem" style="display:none;margin:5px">
                    <input id="rename-username" placeholder="New username...">
                    <button id="rename-user-button" class="btn right">Set</button>
                </div>
                <div class="user-setting btn right change-pfp-user">
                    <label id="profile-picture-user-label" class="right" for="profile-picture-user">Change Profile Picture</label>
                    <input id="profile-picture-user" type="file" style="display:none">
                </div>
            </div>`;
        div.insertAdjacentHTML("beforeend", settingsHTML);
        document.getElementById("ban-user").addEventListener('click', (e)=>{
            socket.send(JSON.stringify({type: "update_user", data:{"target_user_id": user.id, "banned": !user.banned}}));
        });
        document.getElementById("restrict-user").addEventListener('click', (e)=>{
            socket.send(JSON.stringify({type: "update_user", data:{"target_user_id": user.id, "restricted": !user.restricted}}));
        });
        document.getElementById("admin-user").addEventListener('click', (e)=>{
            socket.send(JSON.stringify({type: "update_user", data:{"target_user_id": user.id, "admin": !user.admin}}));
        });
        document.getElementById("rename-user").addEventListener('click', (e)=>toggleRenameUserDiv(e, user.id));
        document.getElementById("rename-user-button").addEventListener('click', (e)=>toggleRenameUserDiv(e, user.id));
        document.getElementById("profile-picture-user").addEventListener('change', (e)=>changeProfilePicture(e, user.id));
    } else 
    if (user.id == selfUser.id || (selfUser.admin && user.admin)){
        const settingsHTML = `
            <div class="user-settings">
                <div id="rename-user" class="user-setting btn right">Rename</div>
                <div id="rename-user-subitem" style="display:none;margin:5px">
                        <input id="rename-username" placeholder="New username..."></input>
		                <button id="rename-user-button" class="btn right">Set</button>
                </div>
                <div class="user-setting btn right change-pfp-user">
                    <label id="profile-picture-user-label" class="right" for="profile-picture-user">Change Profile Picture</label>
                    <input id="profile-picture-user" type="file" style="display:none">
                </div>
            </div>`;
        div.insertAdjacentHTML("beforeend", settingsHTML);
        document.getElementById("rename-user").addEventListener('click', (e)=>toggleRenameUserDiv(e, user.id));
        document.getElementById("rename-user-button").addEventListener('click', (e)=>toggleRenameUserDiv(e, user.id));
        document.getElementById("profile-picture-user").addEventListener('change', (e)=>changeProfilePicture(e, user.id));
    }
    //This is not ideal.
    div.querySelectorAll('.user-settings button, .user-settings input, .user-settings label').forEach(el => {
        el.addEventListener('click', e => e.stopPropagation());
    });
}

//TODO:Connecting/disconnecting and other inputs might cause race conditions, make sure the server code adds the user to the list of connections only when the client is ready.
//Should probably move that stuff to the setVoiceChannel function anyways.

function setVoiceChannel(channel_id){
    if (current_voice_channel != -1) {
        socket.send(JSON.stringify({"type": "vc_disconnect","data": {}}));
    }
    if (channel_id != -1 && current_voice_channel != channel_id){
        socket.send(JSON.stringify({"type": "vc_connect","data": {"channel_id": channel_id}}));
    }
    current_voice_channel = current_voice_channel == channel_id ? -1 : channel_id;
}

//Resets the channel and requests latest posts from the server for the newly selected channel.
function setTextChannel(channel_id){
    if (current_text_channel == channel_id) return;
    current_text_channel = channel_id;
    state.posts = [];
    state.posts_exhausted = false;
    document.querySelector('#chat-window').innerHTML = "";
    document.querySelectorAll('.channel').forEach(e => e.style.background=null);
    document.getElementById(`chat-header-text`).innerText = channel_id == -1 ? "Search" : state.channels[channel_id].name;
    if (channel_id == -1) return; //For blanking or search, set the channel to -1.
    socket.send(JSON.stringify({"type":"get_posts", "data":{"channel_id":channel_id}}));
    document.getElementById(`channel-${channel_id}`).style.background = "var(--color-button-h)";
}

//Handle new posts kinda efficiently. 
//Track an post id list in state, keep it sorted, add new elements to the DOM based on index.
function addPosts(posts) {
    posts = posts.filter(p => p.channel == current_text_channel || current_text_channel == -1);
    const container = document.querySelector('#chat-window');
    const wasAtBottom = Math.abs(container.scrollHeight - container.scrollTop - container.clientHeight) < 10;

    if (!posts || posts.length == 0) return;
    for (const post of posts) {
        //Find insertion index in state.posts (sorted array of IDs)
        let insertedIndex = -1;
        if (state.posts.length === 0) {
            state.posts.push(post.id);
            insertedIndex = 0;
        } else if (post.id > state.posts[state.posts.length - 1]) {
            state.posts.push(post.id);
            insertedIndex = state.posts.length - 1;
        } else if (post.id < state.posts[0]) {
            state.posts.unshift(post.id);
            insertedIndex = 0;
        } else {
            for (let i = state.posts.length - 1; i >= 0; i--) {//Could do a binary search but this is faster for small lengths.
                if (post.id > state.posts[i]) {
                    state.posts.splice(i + 1, 0, post.id);
                    insertedIndex = i + 1;
                    break;
                } else if (post.id === state.posts[i]) {
                    insertedIndex = -1;
                    break;
                }
            }
        }

        if (insertedIndex === -1) continue;

        //Get neighbor posts
        const prevPostId = state.posts[insertedIndex - 1];
        const nextPostId = state.posts[insertedIndex + 1];
        const prevPost = prevPostId ? document.getElementById(`post-${prevPostId}`) : false;
        const nextPost = nextPostId ? document.getElementById(`post-${nextPostId}`) : false;

        const currentTime = post.created_at;
        const prevTime = prevPost ? prevPost.dataset.created : 0;
        const nextTime = nextPost ? nextPost.dataset.created : 0;

        const fromPrevUser = prevPost && post.user_id == prevPost.dataset.author;
        const fromNextUser = nextPost && post.user_id == nextPost.dataset.author;
        const tooOldFromPrev = !prevPost || Math.abs(currentTime - prevTime) > 30;
        const tooOldFromNext = !nextPost || Math.abs(nextTime - currentTime) > 30;
        
        //Add new post to dom
        const newPost = document.createElement('div');
        newPost.className = 'post-content';
        newPost.id = `post-${post.id}`;
        newPost.dataset.author = post.user_id;
        newPost.dataset.created = post.created_at;
        newPost.textContent = post.content;

        if (fromPrevUser && !tooOldFromPrev){
            prevPost.insertAdjacentElement('afterend', newPost);
            continue;
        }
        if (fromNextUser && !tooOldFromNext){
            nextPost.insertAdjacentElement('beforebegin', newPost);
            continue;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'chat-post';
        wrapper.dataset.channel = post.channel;

        const usernameDiv = document.createElement('div');
        usernameDiv.className = 'post-username';

        const userImg = document.createElement('img');
        userImg.className = 'post-user-icon';
        userImg.src = `/images/users/${post.user_id}.webp`;

        const userName = document.createTextNode(state.users[post.user_id]?.username || 'Unknown');

        const dateDiv = document.createElement('div');
        dateDiv.className = 'post-date';
        dateDiv.textContent = timeIntToString(post.created_at);

        usernameDiv.append(userImg, userName, dateDiv);

        const groupDiv = document.createElement('div');
        groupDiv.className = 'post-content-group';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'post-content';
        contentDiv.id = `post-${post.id}`;
        contentDiv.dataset.author = post.user_id;
        contentDiv.dataset.created = post.created_at;
        contentDiv.textContent = post.content;

        groupDiv.append(contentDiv);
        wrapper.append(usernameDiv, groupDiv);
        if (prevPost) {
            prevPost.parentNode.parentNode.insertAdjacentElement('afterend', wrapper);
        } else {
            container.insertBefore(wrapper, container.firstChild);
        }
    }
    //Set scrollheight to bottom to display new messages.
    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

async function message(e){
    const resp = JSON.parse(e.data);
    console.log(e.data);
    const type = resp.type;
    const data = resp.data;
    if (type == "failure" || type == "success"){
        console.log(data.notification);  //Make this into a nicer in-page notification later.
    } else
    if (type == "session_expired"){
        localStorage.setItem("session", "");
        location.href = "/auth";
    } else 
    if (type == "session_login"){
        setTextChannel(1);
    } else
    if (type == "invite"){
        document.getElementById('invite-code').value = data.invite_code;
    } else 
    if (type == "channels"){
        state.channels = data.channels;
        state.channels = data.channels.reduce((acc, channel) => {
            acc[channel.id] = channel;
            return acc;
        }, {});
        setChannelList(data.channels);
    } else 
    if (type == "posts"){
        if (data.posts.length == 0){
            state.posts_exhausted = true;
        } else {
            state.posts_exhausted = false;
        }
        addPosts(data.posts);
    } else 
    if (type == "users"){
        state.users = data.users.reduce((acc, user) => {
            acc[user.id] = user;
            return acc;
        }, {});
        setUserList(data.users);
    } else 
    if (type == "self"){
        state.self_user = data.user_id;        
    } else 
    if (type == "activity"){
        user = state.users[data.user_id];
        if (user){
            user.last_activity = Date.now();
            document.getElementById(`user-${data.user_id}`).querySelector(`.user-activity`).innerHTML = "🟢";
            setTimeout(()=>{
                document.getElementById(`user-${data.user_id}`).querySelector(`.user-activity`).innerHTML = (user.last_activity && 
                                (Date.now() - state.users[data.user_id].last_activity < 5 * 60 * 1000)) ? "🟢" : "🔴"
            }, 5 * 60 * 1000);
            //TODO: set a timer to set it to orange/red after some time based on the last_activity value.
        }
    } else 
    if (type == "vc_channel_users"){
        state.vc_channel_users = data.channel_users;
        setVCUsers();
    }
    if (type == "connect"){
        //Create offer for all users connected to the same voice channel.
        await vc_connect(data.channel_id, data.user_id);
        setVCUsers();
    } else 
    if (type == "disconnect"){
        vc_disconnect(data.channel_id, data.user_id);
        setVCUsers();
    } else 
    if (type == "offer"){
        offer(data.sender_user_id, data.data)
    } else 
    if (type == "answer"){
        answer(data.sender_user_id, data.data)
    } else 
    if (type == "candidate"){
        candidate(data.sender_user_id, data.data)
    }
}

function open(){
    const session = localStorage.getItem("session");
    if (!session) location.href = "/auth";
    socket.send(JSON.stringify({"type":"authenticate", "data":{"key":session}}))
}

function load(){
    socket = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}/ws`);
    socket.addEventListener('open', open);
    socket.addEventListener('message', message);
    document.getElementById("add-channel-button").addEventListener('click', toggleCreateChannelDiv);
    document.getElementById("add-channel-add-button").addEventListener("click", toggleCreateChannelDiv);
    document.getElementById("delete-channel-button").addEventListener('click', toggleDeleteChannelDiv);
    document.getElementById("delete-channel-delete-button").addEventListener("click", toggleDeleteChannelDiv);
    document.getElementById('send-button').addEventListener('click', sendPost);
    document.getElementById('search-button').addEventListener('click', search);
    document.addEventListener("keydown", handle_input_key);
    document.getElementById("new-invite-button").addEventListener('click', toggleInviteCodeDiv);
    document.getElementById("invite-code-close-button").addEventListener('click', toggleInviteCodeDiv);
    document.getElementById("profile-picture-input").addEventListener('change', (e)=>changeProfilePicture(e, state.self_user));
    document.getElementById("sidebar-button").addEventListener('click', toggleSidebarDiv);
    document.getElementById("settings-header").addEventListener('click', ()=>{toggleDiv('settings-content')})
    document.getElementById("users-header").addEventListener('click', ()=>{toggleDiv('user-list')})
    document.getElementById("channels-header").addEventListener('click', ()=>{toggleDiv('channels')})
    document.getElementById("files-input").addEventListener('change', uploadFiles);

    const chatWindow = document.getElementById("chat-window");
    chatWindow.addEventListener('scroll', () => {
        if (chatWindow.scrollTop < 100 && !state.posts_exhausted) {
            socket.send(JSON.stringify({"type":"get_posts", "data":{"channel_id":current_text_channel, "direction":"up", "from_id":state.posts[0]}}));
            state.posts_exhausted = true;//Set this to true, uppon loading the new posts if there are any it'll be set to false again.
        }
    });
}

function timeIntToString(time){
	const date = new Date(time * 1000);
	const day = date.getDate().toString().padStart(2, '0'); 
	const month = (date.getMonth() + 1).toString().padStart(2, '0'); 
	const year = date.getFullYear();
	const hours = date.getHours().toString().padStart(2, '0');
	const minutes = date.getMinutes().toString().padStart(2, '0');
	return `${hours}:${minutes} ${day}-${month}-${year}`;
}

async function vc_connect(channel_id, new_user_id){
    if (!state.vc_channel_users[channel_id]) state.vc_channel_users[channel_id] = [];
    state.vc_channel_users[channel_id].push(new_user_id);
    if (state.self_user != new_user_id) return;

    if (!localStream) localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.vc_channel_users[channel_id].forEach(async (user_id) => {
        const pc = new RTCPeerConnection();
        state.vc_peers[user_id] =  pc;
        
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        
        pc.ontrack = (event) => {
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            const savedVolume = userVolumePrefs[user_id] ?? 1.0;
            audio.volume = savedVolume * masterVolume;
            audio.play();
            state.vc_peer_audio[user_id] = audio;
        };
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.send(JSON.stringify({
                    "type": "vc_candidate",
                    "data": {"target_user_id":user_id, "candidate":event.candidate}
                }));
            }
        };
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.send(JSON.stringify({
            "type": "vc_offer",
            "data": { "target_user_id": user_id, "offer": offer }
        }));
    });
}

function vc_disconnect(channel_id, user_id){
    state.vc_channel_users[channel_id].pop(user_id);
    if (user_id == state.self_user) {
        Object.values(state.vc_peers).forEach(pc => pc.close());
        state.vc_peers = {};
        Object.values(state.vc_peer_audio).forEach(audio => audio.pause());
        state.vc_peer_audio = {};
        return;
    }
    const pc = state.vc_peers[user_id];
    if (pc) pc.close();
    delete state.vc_peers[user_id];
    const audio = state.vc_peer_audio[user_id];
    if (audio) {
        audio.pause();
        delete state.vc_peer_audio[user_id];
    }
}

async function offer(from_user_id, offer){
    const pc = new RTCPeerConnection();
    state.vc_peers[from_user_id] = pc;
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        const savedVolume = userVolumePrefs[from_user_id] ?? 1.0;
        audio.volume = savedVolume * masterVolume;
        audio.play();
        state.vc_peer_audio[from_user_id] = audio;
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                "type": "vc_candidate",
                "data": {"target_user_id":from_user_id, "candidate":event.candidate}
            }));
        }
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.send(JSON.stringify({
        "type": "vc_answer",
        "data": {"target_user_id": from_user_id, "answer": answer}
    }));
}

async function answer(from_user_id, answer){
    if (from_user_id == state.self_user) return;
    const pc = state.vc_peers[from_user_id];
    if (pc) {
        await pc.setRemoteDescription(answer);
    }
}

async function candidate(from_user_id, candidate){
    if (from_user_id == state.self_user) return;
    const pc = state.vc_peers[from_user_id];
    if (pc) {
        await pc.addIceCandidate(candidate);
    }
}