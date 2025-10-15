document.getElementById('login-button').addEventListener('click', onLoginButton);

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
    document.getElementById('qrcode-label').innerHTML = "Scan the QR code with your authenticator app and use the TOTP code to log in.";
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
	const res = await fetch('/auth/signup', {
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
	const res = await fetch('/auth/login', {
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
		setupConnection();
		document.getElementById('container').style.display = "flex";
		document.getElementById('login').style.display = "none";
	}
}