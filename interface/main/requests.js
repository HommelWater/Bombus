export async function onLoadRequests(){
    document.getElementById("new-invite-button").addEventListener('click', requestNewInviteCode);
    document.getElementById("profile-picture-input").addEventListener('change', requestProfilePictureChange);
}

async function requestNewInviteCode(){
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

async function requestProfilePictureChange(e){
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

export async function requestNewChannel(){
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