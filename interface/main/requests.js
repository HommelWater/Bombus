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
	
	const out = await res.json();
	console.log(out);
    return out;
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
    location.href = "/";
    return data;
}

export async function requestOlderPosts(channelId, oldestPost){
    return await request("load_old_posts", {"channel_id":channelId, "from_post":oldestPost});
}

export async function requestNewerPosts(channelId, newestPost){
    return await request("load_new_posts", {"channel_id":channelId, "from_post":newestPost});
}

export async function searchRequest(channelId, query){
    return await request("search", {"channel_id":channelId, "query":query})
}

export async function requestPostContext(postId){
    return await request("context", {"post_id":postId});
}

export async function requestToggleBanUser(user_id){
    return await request("ban", {"user_id":user_id})
}

export async function requestToggleAdminUser(user_id){
    return await request("admin", {"user_id":user_id})
}

export async function requestToggleRestrictUser(user_id){
    return await request("restrict", {"user_id":user_id})
}

export async function requestRenameUser(user_id){
    return await request("rename", {"user_id":user_id})
}

export async function requestResetUserPfp(user_id){
    return await request("reset_profile_picture", {"user_id":user_id})
}