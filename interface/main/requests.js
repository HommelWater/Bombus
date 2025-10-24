export async function onLoadRequests(){
    document.getElementById("new-invite-button").addEventListener('click', setInviteCode);
    document.getElementById("profile-picture-input").addEventListener('change', changeProfilePicture);
}

async function request(type, data){
    const session = localStorage.getItem("session");
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ "session_key":session, "type":type, "data":data })
	});
	if (!res.ok) {
		const { error } = await res.json().catch(() => ({}));
		console.log(error);
        return;
	}
	
	const data = await res.json();
	console.log(data);
    return data;
}

async function setInviteCode(){
	const data = await request("invite", {"uses":1});
	const inviteDiv = document.getElementById("invite-code-item");
	inviteDiv.innerHTML = `Invite code: ${data["result"]}`;
}

async function changeProfilePicture(e){
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
	const data = await request("profile_picture", {"file":base64, "extension":extension});
	location.href = "/";
    return data;
}

export async function addNewChannel(){
	const channelName = document.getElementById("channel-name").value;
	const data = await request("channel", {"name":channelName});
	console.log(data);
    location.href = "/";
}

export async function requestOlderMessages(session, channelId, oldestMessage){
    const res = await fetch('/load_messages_old', {
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
    return data;
}

export async function requestNewerMessages(session, channelId, newestMessage){
    const res = await fetch('/load_messages_new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ "session_key":session, "channel_id":channelId, "from_message": newestMessage})
    });
    if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        console.log(error);
        return;
    }
    
    const data = await res.json();
    return data;
}

export async function searchRequest(channelId, query){
	const session = localStorage.getItem("session");
    const res = await fetch('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ "session_key":session, "channel_id":channelId, "query":query})
    });
    if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        console.log(error);
        return;
    }
    
    const data = await res.json();
    return data;
}

export async function requestPostContext(post_id){
	const session = localStorage.getItem("session");
    const res = await fetch('/post_context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ "session_key":session, "post_id":post_id})
    });
    if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        console.log(error);
        return;
    }
    
    const data = await res.json();
    return data;
}

export async function requestToggleBanUser(user_id){
	const session = localStorage.getItem("session");
    const res = await fetch('/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ "session_key":session, "user_id":user_id})
    });
    if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        console.log(error);
        return;
    }
    
    const data = await res.json();
    return data;
}